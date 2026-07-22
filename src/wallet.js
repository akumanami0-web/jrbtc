import fs from 'node:fs';
import path from 'node:path';
import { newKeyPair, pubKeyFromPriv, addressFromPub, sign, isValidAddress } from './keys.js';
import { txId } from './transaction.js';

export function createWallet(file) {
  const { privPem, pubHex } = newKeyPair();
  const wallet = { version: 1, privPem, pubHex, address: addressFromPub(pubHex) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) throw new Error(`refusing to overwrite existing wallet at ${file}`);
  fs.writeFileSync(file, JSON.stringify(wallet, null, 2), { mode: 0o600 });
  return wallet;
}

export function loadWallet(file) {
  const wallet = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Re-derive to catch corrupted files early.
  const pubHex = pubKeyFromPriv(wallet.privPem);
  const address = addressFromPub(pubHex);
  if (wallet.address !== address) throw new Error('wallet file corrupt: address mismatch');
  return { ...wallet, pubHex, address };
}

/**
 * Build and sign a transaction spending this wallet's UTXOs.
 * `utxos`: [{txid, vout, value}], greedily selected largest-first.
 * Change (minus fee) returns to the wallet address.
 */
export function buildTx(wallet, utxos, toAddress, amount, fee) {
  if (!isValidAddress(toAddress)) throw new Error('invalid destination address');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('invalid amount');
  if (!Number.isInteger(fee) || fee < 0) throw new Error('invalid fee');

  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const picked = [];
  let inSum = 0;
  for (const u of sorted) {
    picked.push(u);
    inSum += u.value;
    if (inSum >= amount + fee) break;
  }
  if (inSum < amount + fee) {
    throw new Error(`insufficient funds: need ${amount + fee}, have ${inSum} spendable`);
  }

  const outputs = [{ address: toAddress, value: amount }];
  const change = inSum - amount - fee;
  if (change > 0) outputs.push({ address: wallet.address, value: change });

  const tx = {
    time: Date.now(),
    inputs: picked.map(u => ({ txid: u.txid, vout: u.vout, pubkey: wallet.pubHex, signature: '' })),
    outputs
  };
  const id = txId(tx); // txid excludes signatures, so sign after assembly
  for (const inp of tx.inputs) inp.signature = sign(wallet.privPem, id);
  return tx;
}
