import { dsha256, merkleRoot, hashMeetsTarget } from './util.js';
import { txId } from './transaction.js';

// Block: { header: {version, prevHash, merkleRoot, time, target, nonce}, txs }

export function headerString(h) {
  return [h.version, h.prevHash, h.merkleRoot, h.time, h.target, h.nonce].join('|');
}

export function blockHash(block) {
  return dsha256(headerString(block.header));
}

export function computeMerkle(block) {
  return merkleRoot(block.txs.map(txId));
}

export function powValid(block) {
  return hashMeetsTarget(blockHash(block), block.header.target);
}

export function makeBlock(prevHash, target, txs, time = Date.now()) {
  const block = {
    header: {
      version: 1,
      prevHash,
      merkleRoot: merkleRoot(txs.map(txId)),
      time,
      target,
      nonce: 0
    },
    txs
  };
  return block;
}

/**
 * Synchronous bounded mining: try up to `maxTries` nonces starting at
 * header.nonce. Returns true when the header now satisfies its target.
 */
export function tryMine(block, maxTries) {
  const h = block.header;
  for (let i = 0; i < maxTries; i++) {
    if (hashMeetsTarget(dsha256(headerString(h)), h.target)) return true;
    h.nonce++;
  }
  return false;
}
