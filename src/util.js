import { createHash } from 'node:crypto';

export function sha256(data) {
  return createHash('sha256').update(data).digest();
}

/** Double SHA-256, hex out. Accepts Buffer or utf8 string. */
export function dsha256(data) {
  return sha256(sha256(data)).toString('hex');
}

/** 20-byte hash used for addresses (double SHA-256, truncated). */
export function hash160(data) {
  return sha256(sha256(data)).subarray(0, 20);
}

// ---------------------------------------------------------------- base58check
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(buf) {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of buf) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}

export function base58Decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('invalid base58 character');
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let buf = Buffer.from(hex === '0' ? '' : hex, 'hex');
  let leading = 0;
  for (const c of str) {
    if (c !== '1') break;
    leading++;
  }
  return Buffer.concat([Buffer.alloc(leading), buf]);
}

export function base58Check(payload) {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

export function base58CheckDecode(str) {
  const raw = base58Decode(str);
  if (raw.length < 5) throw new Error('too short');
  const payload = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  const expect = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.equals(expect)) throw new Error('bad checksum');
  return payload;
}

// ------------------------------------------------------------- canonical JSON
/** Deterministic JSON: object keys sorted recursively, arrays in order. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// ------------------------------------------------------------------- merkle
export function merkleRoot(txids) {
  if (txids.length === 0) return dsha256('');
  let level = txids.slice();
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]);
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(dsha256(level[i] + level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

// ------------------------------------------------------------- work / target
const TWO_256 = 1n << 256n;

export function hashMeetsTarget(hashHex, targetHex) {
  return BigInt('0x' + hashHex) <= BigInt('0x' + targetHex);
}

/** Expected work to find a block at this target (Bitcoin's formula). */
export function targetToWork(targetHex) {
  return TWO_256 / (BigInt('0x' + targetHex) + 1n);
}

export function bigIntToHex64(n) {
  let h = n.toString(16);
  if (h.length > 64) h = 'f'.repeat(64);
  return h.padStart(64, '0');
}

// ------------------------------------------------------------------ amounts
import { COIN } from './config.js';

/** Parse a decimal JrBTC string ("12.5") into integer juniors, exactly. */
export function parseAmount(str) {
  const m = String(str).trim().match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) throw new Error(`invalid amount: ${str}`);
  const whole = BigInt(m[1]) * BigInt(COIN);
  const frac = BigInt((m[2] || '').padEnd(8, '0') || '0');
  const total = whole + frac;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount too large');
  return Number(total);
}

/** Format integer juniors as a decimal JrBTC string. */
export function formatAmount(juniors) {
  const sign = juniors < 0 ? '-' : '';
  const n = Math.abs(juniors);
  const whole = Math.floor(n / COIN);
  const frac = String(n % COIN).padStart(8, '0').replace(/0+$/, '');
  return sign + whole + (frac ? '.' + frac : '');
}
