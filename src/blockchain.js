import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_TARGET, RETARGET_INTERVAL, TARGET_BLOCK_TIME_MS, MAX_TIME_DRIFT_MS,
  MAX_BLOCK_TXS, COINBASE_MATURITY, GENESIS_TIME, GENESIS_TAG, blockSubsidy
} from './config.js';
import { targetToWork, hashMeetsTarget } from './util.js';
import { blockHash, computeMerkle, tryMine } from './block.js';
import {
  txId, isCoinbase, validateTx, checkCoinbaseShape
} from './transaction.js';
import { burnAddress } from './keys.js';

// ------------------------------------------------------------------- genesis
// The genesis block is mined deterministically (nonce search from 0 over a
// fixed header), so every node computes the identical block at startup.
// Its coinbase pays 0 to a provably unspendable address: the full 21M cap
// is left for the miners of the Junior Network.
let GENESIS = null;
export function genesisBlock() {
  if (GENESIS) return GENESIS;
  const coinbase = {
    time: GENESIS_TIME,
    inputs: [{ coinbase: `0:${GENESIS_TAG}` }],
    outputs: [{ address: burnAddress(), value: 0 }]
  };
  const block = {
    header: {
      version: 1,
      prevHash: '0'.repeat(64),
      merkleRoot: '',
      time: GENESIS_TIME,
      target: MAX_TARGET,
      nonce: 0
    },
    txs: [coinbase]
  };
  block.header.merkleRoot = computeMerkle(block);
  while (!tryMine(block, 1_000_000)) { /* deterministic, ~65k tries expected */ }
  GENESIS = block;
  return block;
}

// A UTXO view lets a block be validated atomically: reads fall through to the
// base set, spends/creates are staged and only committed if the whole block
// is valid.
class UtxoView {
  constructor(base) {
    this.base = base;
    this.spent = new Set();
    this.added = new Map();
  }
  get(txid, vout) {
    const key = `${txid}:${vout}`;
    if (this.spent.has(key)) return undefined;
    return this.added.get(key) ?? this.base.get(key);
  }
  spend(txid, vout) {
    const key = `${txid}:${vout}`;
    if (this.added.delete(key)) return;
    this.spent.add(key);
  }
  add(txid, vout, entry) {
    this.added.set(`${txid}:${vout}`, entry);
  }
  commitTo(base) {
    for (const key of this.spent) base.delete(key);
    for (const [key, entry] of this.added) base.set(key, entry);
  }
}

/**
 * Validate a block's transactions against a UTXO view and stage the changes.
 * Returns the amount of new coin emitted. Throws on any consensus violation.
 */
function connectTransactions(block, view, height) {
  let fees = 0;
  checkCoinbaseShape(block.txs[0], height);

  for (let i = 1; i < block.txs.length; i++) {
    const tx = block.txs[i];
    if (isCoinbase(tx)) throw new Error('coinbase not at index 0');
    fees += validateTx(tx, (t, v) => view.get(t, v), height);
    const id = txId(tx);
    for (const inp of tx.inputs) view.spend(inp.txid, inp.vout);
    tx.outputs.forEach((out, vout) =>
      view.add(id, vout, { address: out.address, value: out.value, height, coinbase: false }));
  }

  const coinbase = block.txs[0];
  const coinbaseOut = coinbase.outputs.reduce((s, o) => s + o.value, 0);
  const allowed = blockSubsidy(height) + fees;
  if (coinbaseOut > allowed) {
    throw new Error(`coinbase pays ${coinbaseOut}, allowed ${allowed}`);
  }
  const cbId = txId(coinbase);
  coinbase.outputs.forEach((out, vout) =>
    view.add(cbId, vout, { address: out.address, value: out.value, height, coinbase: true }));

  return coinbaseOut - fees; // newly emitted coin
}

export class Blockchain {
  constructor(datadir = null) {
    this.datadir = datadir;
    this.index = new Map();      // hash -> {block, hash, height, work: BigInt}
    this.orphans = new Map();    // prevHash -> block[]
    this.utxo = new Map();       // "txid:vout" -> {address, value, height, coinbase}
    this.supply = 0;             // emitted juniors on the main chain
    this.mainChain = [];         // hashes by height
    this.mainSet = new Set();
    this._saveTimer = null;

    const g = genesisBlock();
    const gh = blockHash(g);
    this.index.set(gh, { block: g, hash: gh, height: 0, work: targetToWork(g.header.target) });
    this.mainChain.push(gh);
    this.mainSet.add(gh);

    if (datadir) this._load();
  }

  get tipHash() { return this.mainChain[this.mainChain.length - 1]; }
  get tip() { return this.index.get(this.tipHash); }
  get height() { return this.mainChain.length - 1; }

  entryAtHeight(h) {
    const hash = this.mainChain[h];
    return hash ? this.index.get(hash) : undefined;
  }

  /** Walk a (possibly side) branch down to the entry at `height`. */
  _branchEntryAt(fromEntry, height) {
    let e = fromEntry;
    while (e && e.height > height) e = this.index.get(e.block.header.prevHash);
    return e;
  }

  _medianTimePast(parentEntry) {
    const times = [];
    let e = parentEntry;
    for (let i = 0; i < 11 && e; i++) {
      times.push(e.block.header.time);
      e = this.index.get(e.block.header.prevHash);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  }

  /** Consensus target for the block after `parentEntry` (branch-aware). */
  nextTarget(parentEntry = this.tip) {
    const height = parentEntry.height + 1;
    const prevTarget = parentEntry.block.header.target;
    if (height % RETARGET_INTERVAL !== 0) return prevTarget;

    const first = this._branchEntryAt(parentEntry, height - RETARGET_INTERVAL);
    const expected = RETARGET_INTERVAL * TARGET_BLOCK_TIME_MS;
    let actual = parentEntry.block.header.time - first.block.header.time;
    actual = Math.max(expected / 4, Math.min(expected * 4, actual));

    let t = BigInt('0x' + prevTarget) * BigInt(Math.round(actual)) / BigInt(expected);
    const max = BigInt('0x' + MAX_TARGET);
    if (t > max) t = max;
    if (t < 1n) t = 1n;
    return t.toString(16).padStart(64, '0');
  }

  /**
   * Add a block. Returns {added, isNewTip, orphan, reason}.
   * Blocks extending the tip are fully validated and connected. Side-branch
   * blocks are structurally validated and stored; if a side branch overtakes
   * the main chain in cumulative work, the whole branch is replayed from
   * genesis and adopted only if every block is valid.
   */
  addBlock(block) {
    const hash = blockHash(block);
    if (this.index.has(hash)) return { added: false, reason: 'duplicate' };

    // Context-free structural checks
    const h = block.header;
    if (!Array.isArray(block.txs) || block.txs.length === 0 || block.txs.length > MAX_BLOCK_TXS) {
      return { added: false, reason: 'bad tx count' };
    }
    if (h.merkleRoot !== computeMerkle(block)) return { added: false, reason: 'bad merkle root' };
    if (!hashMeetsTarget(hash, h.target)) return { added: false, reason: 'insufficient pow' };

    const parent = this.index.get(h.prevHash);
    if (!parent) {
      const list = this.orphans.get(h.prevHash) ?? [];
      if (list.length < 64) list.push(block);
      this.orphans.set(h.prevHash, list);
      return { added: false, orphan: true, reason: 'orphan (parent unknown)' };
    }

    const height = parent.height + 1;
    if (h.target !== this.nextTarget(parent)) return { added: false, reason: 'wrong difficulty target' };
    if (h.time <= this._medianTimePast(parent)) return { added: false, reason: 'time too old' };
    if (h.time > Date.now() + MAX_TIME_DRIFT_MS) return { added: false, reason: 'time too far in future' };
    try {
      checkCoinbaseShape(block.txs[0], height);
    } catch (e) {
      return { added: false, reason: e.message };
    }

    const work = parent.work + targetToWork(h.target);
    const entry = { block, hash, height, work };

    let isNewTip = false;
    if (h.prevHash === this.tipHash) {
      // Fast path: extend the main chain
      const view = new UtxoView(this.utxo);
      let emitted;
      try {
        emitted = connectTransactions(block, view, height);
      } catch (e) {
        return { added: false, reason: e.message };
      }
      view.commitTo(this.utxo);
      this.supply += emitted;
      this.index.set(hash, entry);
      this.mainChain.push(hash);
      this.mainSet.add(hash);
      isNewTip = true;
    } else {
      this.index.set(hash, entry);
      if (work > this.tip.work) {
        if (!this._reorgTo(entry)) {
          this.index.delete(hash);
          return { added: false, reason: 'invalid branch on reorg' };
        }
        isNewTip = true;
      }
    }

    // Any orphans waiting for this block can now be connected.
    const waiting = this.orphans.get(hash);
    if (waiting) {
      this.orphans.delete(hash);
      for (const child of waiting) {
        const r = this.addBlock(child);
        if (r.isNewTip) isNewTip = true;
      }
    }

    this._scheduleSave();
    return { added: true, isNewTip };
  }

  /** Replay the branch ending at `newTip` from genesis; adopt it if valid. */
  _reorgTo(newTip) {
    const chain = [];
    for (let e = newTip; e; e = this.index.get(e.block.header.prevHash)) {
      chain.unshift(e);
      if (e.height === 0) break;
    }
    if (chain[0].height !== 0) return false; // disconnected branch

    const utxo = new Map();
    let supply = 0;
    for (let i = 1; i < chain.length; i++) {
      const view = new UtxoView(utxo);
      try {
        supply += connectTransactions(chain[i].block, view, chain[i].height);
      } catch {
        return false;
      }
      view.commitTo(utxo);
    }

    this.utxo = utxo;
    this.supply = supply;
    this.mainChain = chain.map(e => e.hash);
    this.mainSet = new Set(this.mainChain);
    return true;
  }

  // -------------------------------------------------------------- queries
  getBalance(address) {
    let confirmed = 0, immature = 0;
    for (const u of this.utxo.values()) {
      if (u.address !== address) continue;
      if (u.coinbase && this.height - u.height < COINBASE_MATURITY) immature += u.value;
      else confirmed += u.value;
    }
    return { confirmed, immature };
  }

  getUtxos(address, { spendableOnly = true } = {}) {
    const out = [];
    for (const [key, u] of this.utxo) {
      if (u.address !== address) continue;
      if (spendableOnly && u.coinbase && this.height - u.height < COINBASE_MATURITY) continue;
      const [txid, vout] = key.split(':');
      out.push({ txid, vout: Number(vout), ...u });
    }
    return out;
  }

  /** Exponentially spaced hashes from the tip back to genesis. */
  locator() {
    const hashes = [];
    let step = 1, h = this.height;
    while (h > 0) {
      hashes.push(this.mainChain[h]);
      if (hashes.length >= 10) step *= 2;
      h -= step;
    }
    hashes.push(this.mainChain[0]);
    return hashes;
  }

  /** Main-chain blocks after the first locator hash we recognize. */
  getBlocksAfter(locator, max = 500) {
    let startHeight = 0;
    for (const hash of locator) {
      if (this.mainSet.has(hash)) {
        startHeight = this.index.get(hash).height;
        break;
      }
    }
    const blocks = [];
    for (let h = startHeight + 1; h <= this.height && blocks.length < max; h++) {
      blocks.push(this.entryAtHeight(h).block);
    }
    return { blocks, more: startHeight + 1 + blocks.length <= this.height };
  }

  // ---------------------------------------------------------- persistence
  _blocksFile() { return path.join(this.datadir, 'blocks.json'); }

  _scheduleSave() {
    if (!this.datadir) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 500);
    this._saveTimer.unref?.();
  }

  save() {
    if (!this.datadir) return;
    fs.mkdirSync(this.datadir, { recursive: true });
    const blocks = [...this.index.values()]
      .filter(e => e.height > 0)
      .sort((a, b) => a.height - b.height)
      .map(e => e.block);
    const tmp = this._blocksFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ blocks }));
    fs.renameSync(tmp, this._blocksFile());
  }

  _load() {
    try {
      if (!fs.existsSync(this._blocksFile())) return;
      const { blocks } = JSON.parse(fs.readFileSync(this._blocksFile(), 'utf8'));
      for (const b of blocks) this.addBlock(b);
      clearTimeout(this._saveTimer);
    } catch (e) {
      console.error(`[chain] could not load ${this._blocksFile()}: ${e.message}`);
    }
  }
}
