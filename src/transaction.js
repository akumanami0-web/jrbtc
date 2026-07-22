import { dsha256, stableStringify, hash160 } from './util.js';
import { verify, decodeAddress, isValidAddress } from './keys.js';
import { MAX_SUPPLY, COINBASE_MATURITY } from './config.js';

// A transaction:
//   { time, inputs: [...], outputs: [{address, value}] }
// Regular input:  { txid, vout, pubkey, signature }
// Coinbase input: { coinbase: "<height>:<tag>" }  (exactly one, first tx only)
//
// txid commits to outpoints + outputs + time, NOT signatures, so the id is
// stable before and after signing. Each signature signs the txid, which
// therefore commits to everything that matters (what is spent, where it goes).

export function txId(tx) {
  return dsha256(stableStringify({
    time: tx.time,
    inputs: tx.inputs.map(i =>
      i.coinbase !== undefined ? { coinbase: i.coinbase } : { txid: i.txid, vout: i.vout }
    ),
    outputs: tx.outputs
  }));
}

export function isCoinbase(tx) {
  return tx.inputs.length === 1 && tx.inputs[0].coinbase !== undefined;
}

export function coinbaseHeight(tx) {
  const h = parseInt(String(tx.inputs[0].coinbase).split(':')[0], 10);
  return Number.isInteger(h) ? h : -1;
}

export function makeCoinbase(height, address, value, tag) {
  return {
    time: Date.now(),
    inputs: [{ coinbase: `${height}:${tag}` }],
    outputs: [{ address, value }]
  };
}

function checkOutputs(tx) {
  if (!Array.isArray(tx.outputs) || tx.outputs.length === 0) throw new Error('no outputs');
  let sum = 0;
  for (const out of tx.outputs) {
    if (!Number.isInteger(out.value) || out.value < 0 || out.value > MAX_SUPPLY) {
      throw new Error('output value out of range');
    }
    if (!isValidAddress(out.address)) throw new Error('invalid output address');
    sum += out.value;
    if (sum > MAX_SUPPLY) throw new Error('output sum out of range');
  }
  return sum;
}

/**
 * Validate a non-coinbase transaction against a UTXO view.
 * getUtxo(txid, vout) -> { address, value, height, coinbase } | undefined
 * Returns the fee in juniors; throws on any rule violation.
 */
export function validateTx(tx, getUtxo, chainHeight) {
  if (isCoinbase(tx)) throw new Error('unexpected coinbase');
  if (!Array.isArray(tx.inputs) || tx.inputs.length === 0) throw new Error('no inputs');
  if (!Number.isInteger(tx.time)) throw new Error('bad tx time');

  const outSum = checkOutputs(tx);
  const id = txId(tx);
  const seen = new Set();
  let inSum = 0;

  for (const inp of tx.inputs) {
    const key = `${inp.txid}:${inp.vout}`;
    if (seen.has(key)) throw new Error('duplicate input');
    seen.add(key);

    const utxo = getUtxo(inp.txid, inp.vout);
    if (!utxo) throw new Error(`missing or spent input ${key}`);
    if (utxo.coinbase && chainHeight - utxo.height < COINBASE_MATURITY) {
      throw new Error('coinbase not yet mature');
    }
    // Ownership: pubkey must hash to the address the output paid, and the
    // signature over the txid must verify under that pubkey.
    const expected = decodeAddress(utxo.address);
    const actual = hash160(Buffer.from(inp.pubkey, 'hex'));
    if (!expected.equals(actual)) throw new Error('pubkey does not match output address');
    if (!verify(inp.pubkey, id, inp.signature)) throw new Error('bad signature');

    inSum += utxo.value;
  }

  if (inSum < outSum) throw new Error('inputs < outputs');
  return inSum - outSum; // fee
}

/** Structural check for a coinbase; value rules are enforced per-block. */
export function checkCoinbaseShape(tx, height) {
  if (!isCoinbase(tx)) throw new Error('first tx must be coinbase');
  if (coinbaseHeight(tx) !== height) throw new Error('coinbase height mismatch');
  checkOutputs(tx);
}
