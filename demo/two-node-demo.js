// Junior Network live demo: two full nodes, real P2P over TCP.
//   Node A mines, Node B syncs; A pays B 12.5 JrBTC; both agree on everything.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JrbtcNode } from '../src/node.js';
import { newKeyPair, addressFromPub } from '../src/keys.js';
import { buildTx } from '../src/wallet.js';
import { parseAmount, formatAmount } from '../src/util.js';
import { NETWORK, COIN } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.join(here, '.demo-data');
fs.rmSync(dataRoot, { recursive: true, force: true });

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const fmt = v => `${formatAmount(v)} ${NETWORK.coinName}`;

async function waitFor(desc, fn, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for: ${desc}`);
}

const mkWallet = () => {
  const { privPem, pubHex } = newKeyPair();
  return { privPem, pubHex, address: addressFromPub(pubHex) };
};

console.log(`${'='.repeat(64)}\n  ${NETWORK.coinName} — ${NETWORK.name} two-node demo\n${'='.repeat(64)}`);

step(1, 'Starting two full nodes (real TCP p2p on localhost)…');
const nodeA = await new JrbtcNode({
  label: 'node-A', datadir: path.join(dataRoot, 'A'), p2pPort: 9401, apiPort: 9402
}).start();
const nodeB = await new JrbtcNode({
  label: 'node-B', datadir: path.join(dataRoot, 'B'), p2pPort: 9403, apiPort: 9404,
  peers: ['127.0.0.1:9401']
}).start();
await waitFor('p2p handshake', () => nodeA.p2p.peerCount === 1 && nodeB.p2p.peerCount === 1);
console.log('    Nodes connected. Identical genesis:', nodeA.chain.tipHash === nodeB.chain.tipHash);

const alice = mkWallet();
const bob = mkWallet();
console.log(`    Alice (mines on node A): ${alice.address}`);
console.log(`    Bob   (watches node B) : ${bob.address}`);

step(2, 'Node A mines 25 blocks (proof-of-work, 50 JrBTC subsidy each)…');
const t0 = Date.now();
await nodeA.miner.mineBlocks(25, alice.address);
console.log(`    Mined 25 blocks in ${((Date.now() - t0) / 1000).toFixed(1)}s. Height A: ${nodeA.chain.height}`);

step(3, 'Node B syncs the chain over the network…');
await waitFor('node B at height 25', () => nodeB.chain.height === 25);
console.log(`    Height B: ${nodeB.chain.height}, tips match: ${nodeA.chain.tipHash === nodeB.chain.tipHash}`);
console.log(`    Supply on both nodes: ${fmt(nodeA.chain.supply)} / ${fmt(nodeB.chain.supply)}`);

const balA = nodeA.chain.getBalance(alice.address);
console.log(`    Alice: ${fmt(balA.confirmed)} spendable, ${fmt(balA.immature)} immature (20-block maturity)`);

step(4, 'Alice sends Bob 12.5 JrBTC (signed locally, broadcast on the network)…');
const tx = buildTx(alice, nodeA.chain.getUtxos(alice.address), bob.address, parseAmount('12.5'), 10_000);
const submit = nodeA.submitTx(tx);
console.log(`    txid ${submit.id} accepted, fee ${fmt(submit.fee)}`);
await waitFor('tx gossiped to node B', () => nodeB.mempool.size === 1);
console.log('    Transaction relayed to node B via inv/getdata gossip.');

step(5, 'Node A mines the next block to confirm the payment…');
await nodeA.miner.mineBlocks(1, alice.address);
await waitFor('node B at height 26', () => nodeB.chain.height === 26);
const bobOnB = nodeB.chain.getBalance(bob.address);
console.log(`    Bob's balance as seen by HIS node: ${fmt(bobOnB.confirmed)}`);
console.log(`    Node B mempool cleared: ${nodeB.mempool.size === 0}`);

step(6, 'Bob mines 2 blocks on node B — sync must work in both directions…');
await nodeB.miner.mineBlocks(2, bob.address);
await waitFor('node A at height 28', () => nodeA.chain.height === 28);
console.log(`    Height A: ${nodeA.chain.height}, tips match: ${nodeA.chain.tipHash === nodeB.chain.tipHash}`);

step(7, 'Final consensus check…');
const ok =
  nodeA.chain.tipHash === nodeB.chain.tipHash &&
  nodeA.chain.supply === nodeB.chain.supply &&
  nodeB.chain.getBalance(bob.address).confirmed === parseAmount('12.5');
console.log(`    height ${nodeA.chain.height} | supply ${fmt(nodeA.chain.supply)} | tip ${nodeA.chain.tipHash.slice(0, 24)}…`);
console.log(`    miner subsidy at tip era: ${formatAmount(50 * COIN)} ${NETWORK.coinName}/block, hard cap 21,000,000`);

await nodeA.stop();
await nodeB.stop();

if (ok) {
  console.log(`\n${NETWORK.name} demo PASSED — two independent nodes reached full consensus.`);
  process.exit(0);
} else {
  console.error('\nDemo FAILED — nodes disagree.');
  process.exit(1);
}
