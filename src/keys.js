import {
  generateKeyPairSync, createSign, createVerify,
  createPublicKey, createPrivateKey
} from 'node:crypto';
import { NETWORK } from './config.js';
import { hash160, base58Check, base58CheckDecode } from './util.js';

/** New secp256k1 keypair. Public key travels as SPKI-DER hex on the wire. */
export function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return {
    privPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pubHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex')
  };
}

export function pubKeyFromPriv(privPem) {
  const pub = createPublicKey(createPrivateKey(privPem));
  return pub.export({ type: 'spki', format: 'der' }).toString('hex');
}

/** ECDSA/SHA-256 signature over a utf8 message, DER hex out. */
export function sign(privPem, message) {
  const s = createSign('SHA256');
  s.update(message);
  return s.sign(privPem).toString('hex');
}

export function verify(pubHex, message, sigHex) {
  try {
    const key = createPublicKey({
      key: Buffer.from(pubHex, 'hex'), format: 'der', type: 'spki'
    });
    const v = createVerify('SHA256');
    v.update(message);
    return v.verify(key, Buffer.from(sigHex, 'hex'));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ addresses
export function addressFromPub(pubHex) {
  const payload = Buffer.concat([
    Buffer.from([NETWORK.addressVersion]),
    hash160(Buffer.from(pubHex, 'hex'))
  ]);
  return NETWORK.addressPrefix + base58Check(payload);
}

export function isValidAddress(addr) {
  try {
    return decodeAddress(addr).length === 20;
  } catch {
    return false;
  }
}

/** Returns the 20-byte pubkey-hash Buffer committed to by the address. */
export function decodeAddress(addr) {
  if (typeof addr !== 'string' || !addr.startsWith(NETWORK.addressPrefix)) {
    throw new Error('bad address prefix');
  }
  const payload = base58CheckDecode(addr.slice(NETWORK.addressPrefix.length));
  if (payload.length !== 21 || payload[0] !== NETWORK.addressVersion) {
    throw new Error('bad address payload');
  }
  return payload.subarray(1);
}

/** Provably unspendable address (20 zero bytes — no known preimage). */
export function burnAddress() {
  const payload = Buffer.concat([Buffer.from([NETWORK.addressVersion]), Buffer.alloc(20)]);
  return NETWORK.addressPrefix + base58Check(payload);
}
