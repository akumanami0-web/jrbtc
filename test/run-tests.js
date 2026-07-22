// JrBTC test suite — consensus, crypto, wallet, and monetary policy.
import assert from 'node:assert/strict';
import { COIN, MAX_SUPPLY, HALVING_INTERVAL, blockSubsidy } from '../src/config.js';
import {
  base58Check, base58CheckDecode, parseAmount, formatAmount, hash160
} from '../src/util.js';
import { newKeyPair, sign, verify, addressFromPub, isValidAddress, decodeAddress } from '../src/keys.js';
import { Blockchain, genesisBlock } from '../src/blockchain.js';
import { Mempool } from '../src/mempool.js';
import { Miner } from '../src/miner.js';
import { buildTx } from '../src/wallet.js';
import { makeBlock, tryMine, blockHash } from '../src/block.js';
import { makeCoinbase, txId } from '../src/transaction.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

const mkWallet = () => {
  const { privPem, pubHex } = newKeyPair();
  return { privPem, pubHex, address: addressFromPub(pubHex) };
};

console.log('JrBTC test suite\n');

await test('base58check round-trips and rejects tampering', () => {
  const payload = Buffer.from('4a00112233445566778899aabbccddeeff001122', 'hex');
  const enc = base58Check(payload);
  assert.deepEqual(base58CheckDecode(enc), payload);
  assert.throws(() => base58CheckDecode(enc.slice(0, -1) + (enc.at(-1) === '1' ? '2' : '1')));
});

await test('ECDSA sign/verify works; wrong key and tampered msg fail', () => {
  const a = newKeyPair(), b = newKeyPair();
  const sig = sign(a.privPem, 'hello junior network');
  assert.equal(verify(a.pubHex, 'hello junior network', sig), true);
  assert.equal(verify(a.pubHex, 'hello junior networK', sig), false);
  assert.equal(verify(b.pubHex, 'hello junior network', sig), false);
});

await test('addresses validate and commit to the key hash', () => {
  const { pubHex } = newKeyPair();
  const addr = addressFromPub(pubHex);
  assert.equal(isValidAddress(addr), true);
  assert.equal(isValidAddress(addr.slice(0, -1)), false);
  assert.deepEqual(decodeAddress(addr), hash160(Buffer.from(pubHex, 'hex')));
});

await test('amount parsing is exact (no float error)', () => {
  assert.equal(parseAmount('12.5'), 1_250_000_000);
  assert.equal(parseAmount('0.00000001'), 1);
  assert.equal(parseAmount('21000000'), MAX_SUPPLY);
  assert.equal(formatAmount(1_250_000_000), '12.5');
  assert.equal(formatAmount(1), '0.00000001');
  assert.throws(() => parseAmount('1.234567890')); // >8 decimals
});

await test('emission schedule sums below the 21,000,000 hard cap', () => {
  let total = 0;
  for (let era = 0; ; era++) {
    const subsidy = blockSubsidy(era * HALVING_INTERVAL + 1);
    if (subsidy === 0) break;
    total += subsidy * HALVING_INTERVAL;
  }
  assert.equal(total, 2_099_999_997_690_000); // 20,999,999.9769 JrBTC
  assert.ok(total < MAX_SUPPLY);
  assert.equal(blockSubsidy(1), 50 * COIN);
  assert.equal(blockSubsidy(HALVING_INTERVAL), 50 * COIN);      // last block of era 0
  assert.equal(blockSubsidy(HALVING_INTERVAL + 1), 25 * COIN);  // first block of era 1
});

await test('genesis block is deterministic and carries zero spendable value', () => {
  const g1 = genesisBlock();
  const chainA = new Blockchain();
  const chainB = new Blockchain();
  assert.equal(chainA.tipHash, chainB.tipHash);
  assert.equal(chainA.tipHash, blockHash(g1));
  assert.equal(chainA.supply, 0);
  assert.equal(g1.txs[0].outputs[0].value, 0);
});

// Shared fixture: a chain with 25 blocks mined to wallet A.
const chain = new Blockchain();
const mempool = new Mempool(chain);
// Mirror JrbtcNode._onBlockMined: connect the block, then purge confirmed txs.
const miner = new Miner(chain, mempool, b => { chain.addBlock(b); mempool.refresh(); });
const A = mkWallet(), B = mkWallet();

await test('mining 25 blocks emits exactly 25 × 50 JrBTC', async () => {
  await miner.mineBlocks(25, A.address);
  assert.equal(chain.height, 25);
  assert.equal(chain.supply, 25 * 50 * COIN);
});

await test('coinbase maturity: only rewards ≥20 blocks deep are spendable', () => {
  const bal = chain.getBalance(A.address);
  assert.equal(bal.confirmed, 5 * 50 * COIN);   // heights 1..5 mature at height 25
  assert.equal(bal.immature, 20 * 50 * COIN);
});

await test('a signed transaction is accepted, confirmed, and pays out', async () => {
  const tx = buildTx(A, chain.getUtxos(A.address), B.address, parseAmount('12.5'), 10_000);
  const r = mempool.accept(tx);
  assert.equal(r.accepted, true);
  assert.equal(r.fee, 10_000);
  await miner.mineBlocks(1, A.address);
  assert.equal(chain.getBalance(B.address).confirmed, parseAmount('12.5'));
  assert.equal(mempool.size, 0); // confirmed tx left the mempool
  // Miner collected subsidy + fee at height 26
  const cb = chain.entryAtHeight(26).block.txs[0];
  assert.equal(cb.outputs[0].value, 50 * COIN + 10_000);
});

await test('double-spends are rejected by the mempool', () => {
  const utxos = chain.getUtxos(A.address);
  const one = [utxos[0]];
  const tx1 = buildTx(A, one, B.address, 1 * COIN, 10_000);
  const tx2 = buildTx(A, one, B.address, 2 * COIN, 10_000);
  mempool.accept(tx1);
  assert.throws(() => mempool.accept(tx2), /conflict/);
  mempool.refresh();
  mempool.txs.clear(); mempool.spentKeys.clear(); // reset fixture
});

await test('forged signatures and overspends are rejected', () => {
  const utxos = chain.getUtxos(A.address);
  // B tries to spend A's coins with B's key
  const theft = buildTx({ ...B }, utxos.slice(0, 1), B.address, 1 * COIN, 0);
  assert.throws(() => mempool.accept(theft), /pubkey does not match|bad signature/);
  // Overspend: outputs exceed inputs
  const tx = buildTx(A, utxos.slice(0, 1), B.address, 1 * COIN, 0);
  tx.outputs[0].value = 100 * 50 * COIN;
  assert.throws(() => mempool.accept(tx));
});

await test('blocks with wrong difficulty target are rejected', () => {
  const cb = makeCoinbase(chain.height + 1, A.address, 50 * COIN, 'x');
  const bad = makeBlock(chain.tipHash, 'ff'.repeat(32), [cb]); // trivial target
  tryMine(bad, 1_000_000);
  const r = chain.addBlock(bad);
  assert.equal(r.added, false);
  assert.match(r.reason, /difficulty/);
});

await test('coinbase inflation above subsidy+fees is rejected', () => {
  const cb = makeCoinbase(chain.height + 1, A.address, 51 * COIN, 'greedy');
  const bad = makeBlock(chain.tipHash, chain.nextTarget(), [cb]);
  while (!tryMine(bad, 2_000_000)) { /* keep hashing */ }
  const r = chain.addBlock(bad);
  assert.equal(r.added, false);
  assert.match(r.reason, /coinbase pays/);
});

await test('tampering with a mined block breaks its merkle root', () => {
  const entry = chain.entryAtHeight(26);
  const copy = JSON.parse(JSON.stringify(entry.block));
  copy.txs[0].outputs[0].address = B.address; // steal the coinbase
  const r = new Blockchain().addBlock(copy);
  assert.equal(r.added, false);
});

await test('nodes converge on the most-work chain (reorg)', async () => {
  // Build a competing chain that is longer, then feed it to a lagging node.
  const lagging = new Blockchain();
  for (let h = 1; h <= 3; h++) lagging.addBlock(chain.entryAtHeight(h).block);
  assert.equal(lagging.height, 3);
  const localMiner = new Miner(lagging, new Mempool(lagging), b => lagging.addBlock(b));
  await localMiner.mineBlocks(1, B.address); // lagging forks off at height 4
  assert.notEqual(lagging.entryAtHeight(4).hash, chain.entryAtHeight(4).hash);
  // Now the heavier main chain arrives out of band
  for (let h = 4; h <= chain.height; h++) lagging.addBlock(chain.entryAtHeight(h).block);
  assert.equal(lagging.tipHash, chain.tipHash); // adopted the most-work chain
  assert.equal(lagging.supply, chain.supply);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
