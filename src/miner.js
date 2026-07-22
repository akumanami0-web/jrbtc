import { randomBytes } from 'node:crypto';
import { MAX_BLOCK_TXS, blockSubsidy } from './config.js';
import { makeBlock, tryMine, blockHash } from './block.js';
import { makeCoinbase } from './transaction.js';

const BATCH = 30_000; // nonces per event-loop turn — keeps p2p/api responsive

const yieldLoop = () => new Promise(r => setImmediate(r));

export class Miner {
  constructor(chain, mempool, onBlockMined) {
    this.chain = chain;
    this.mempool = mempool;
    this.onBlockMined = onBlockMined; // (block) => void  (connect + broadcast)
    this.running = false;
    this.address = null;
    this.blocksMined = 0;
  }

  _buildCandidate(address) {
    const parent = this.chain.tip;
    const height = parent.height + 1;
    const selected = [...this.mempool.txs.values()]
      .sort((a, b) => b.fee - a.fee)
      .slice(0, MAX_BLOCK_TXS - 1);
    const txs = selected.map(e => e.tx);
    const fees = selected.reduce((s, e) => s + e.fee, 0);
    const coinbase = makeCoinbase(
      height, address, blockSubsidy(height) + fees, randomBytes(8).toString('hex')
    );
    const time = Math.max(Date.now(), this.chain._medianTimePast(parent) + 1);
    return {
      block: makeBlock(parent.hash, this.chain.nextTarget(parent), [coinbase, ...txs], time),
      parentHash: parent.hash,
      mempoolVersion: this.mempool.version
    };
  }

  /** Mine exactly `n` blocks to `address` (used by the API/CLI/demo). */
  async mineBlocks(n, address) {
    const mined = [];
    for (let i = 0; i < n; i++) {
      let cand = this._buildCandidate(address);
      for (;;) {
        if (tryMine(cand.block, BATCH)) break;
        await yieldLoop();
        if (cand.parentHash !== this.chain.tipHash) cand = this._buildCandidate(address);
      }
      this.onBlockMined(cand.block);
      this.blocksMined++;
      mined.push(blockHash(cand.block));
      await yieldLoop();
    }
    return mined;
  }

  /** Continuous mining until stop(). Restarts on new tip / new mempool txs. */
  async start(address) {
    if (this.running) return;
    this.running = true;
    this.address = address;
    while (this.running) {
      let cand = this._buildCandidate(address);
      while (this.running) {
        if (tryMine(cand.block, BATCH)) {
          this.onBlockMined(cand.block);
          this.blocksMined++;
          break;
        }
        await yieldLoop();
        if (cand.parentHash !== this.chain.tipHash ||
            cand.mempoolVersion !== this.mempool.version) {
          cand = this._buildCandidate(address);
        }
      }
      await yieldLoop();
    }
  }

  stop() { this.running = false; }
}
