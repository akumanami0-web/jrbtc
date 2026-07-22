// Grind a byte-exact Bitcoin-Core-format genesis block for JrBTC Core.
//
// Serialization follows Bitcoin's wire format exactly (80-byte header,
// CScript coinbase, varints, little-endian). As a self-test, this script
// first reconstructs Bitcoin's actual genesis block from Satoshi's
// parameters and asserts the famous hash — proving the serializer is
// byte-perfect — before grinding ours.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const sha256 = b => createHash('sha256').update(b).digest();
const dsha = b => sha256(sha256(b));
const display = buf => Buffer.from(buf).reverse().toString('hex'); // RPC byte order

const le32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const le64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const varint = n => { if (n < 0xfd) return Buffer.from([n]); throw new Error('varint>252 not needed'); };
// CScript::operator<< push encoding: direct length byte up to 75 bytes,
// OP_PUSHDATA1 (0x4c) + length for 76..255 bytes.
const push = buf => {
  if (buf.length < 0x4c) return Buffer.concat([Buffer.from([buf.length]), buf]);
  if (buf.length <= 0xff) return Buffer.concat([Buffer.from([0x4c, buf.length]), buf]);
  throw new Error('push too large');
};

// CScriptNum serialization (positive integers)
function scriptNum(n) {
  const bytes = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.push(x % 256);
  if (bytes.length && bytes[bytes.length - 1] & 0x80) bytes.push(0);
  return Buffer.from(bytes);
}

function genesisCoinbaseTx(pszTimestamp, pubkeyHex, rewardSats) {
  // Core's CreateGenesisBlock hardcodes 486604799 (0x1d00ffff) in the
  // scriptSig for every chain, independent of the header's nBits. Match it.
  const scriptSig = Buffer.concat([
    push(scriptNum(486604799)),
    push(scriptNum(4)),
    push(Buffer.from(pszTimestamp, 'latin1'))
  ]);
  const pubkey = Buffer.from(pubkeyHex, 'hex');
  const scriptPubKey = Buffer.concat([push(pubkey), Buffer.from([0xac])]); // <pubkey> OP_CHECKSIG
  return Buffer.concat([
    le32(1),                                   // tx version
    varint(1),                                 // one input
    Buffer.alloc(32), le32(0xffffffff),        // null prevout
    varint(scriptSig.length), scriptSig,
    le32(0xffffffff),                          // sequence
    varint(1),                                 // one output
    le64(rewardSats),
    varint(scriptPubKey.length), scriptPubKey,
    le32(0)                                    // locktime
  ]);
}

const header = (ver, prev, merkle, time, bits, nonce) =>
  Buffer.concat([le32(ver), prev, merkle, le32(time), le32(bits), le32(nonce)]);

function compactToTarget(bits) {
  const exp = bits >>> 24, mant = BigInt(bits & 0x007fffff);
  return mant * (1n << (8n * (BigInt(exp) - 3n)));
}

// ---------------------------------------------------------------- self-test
{
  const tx = genesisCoinbaseTx(
    'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks',
    '04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb6' +
    '49f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f',
    50_0000_0000
  );
  const txid = dsha(tx);
  const hash = dsha(header(1, Buffer.alloc(32), txid, 1231006505, 0x1d00ffff, 2083236893));
  const okMerkle = display(txid) === '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
  const okHash = display(hash) === '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
  if (!okMerkle || !okHash) {
    console.error('SELF-TEST FAILED', { merkle: display(txid), hash: display(hash) });
    process.exit(1);
  }
  console.log('Self-test: reproduced Bitcoin\'s real genesis block byte-for-byte  ✓');
  console.log(`  ${display(hash)}\n`);
}

// ------------------------------------------------------------- JrBTC genesis
const PSZ = '22/Jul/2026 New PM Andy Burnham enters Downing Street; everyone starts somewhere';
const BITS = 0x1e0ffff0;      // same SHA-256d PoW; achievable starting difficulty
const REWARD = 50_0000_0000;  // 50 JrBTC
const TIME = Math.floor(Date.now() / 1000);

// Fresh uncompressed pubkey for the genesis output. Like Bitcoin's genesis,
// this output is unspendable (Core never adds the genesis coinbase to the
// UTXO set) — the key is generated and immediately discarded.
const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
const spki = publicKey.export({ type: 'spki', format: 'der' });
const PUBKEY = spki.subarray(spki.length - 65).toString('hex');
if (!PUBKEY.startsWith('04')) throw new Error('unexpected pubkey encoding');

const tx = genesisCoinbaseTx(PSZ, PUBKEY, REWARD);
const txid = dsha(tx);
const target = compactToTarget(BITS);

console.log(`Grinding JrBTC genesis (bits 0x${BITS.toString(16)})…`);
const t0 = Date.now();
let nonce = 0, hash;
for (;;) {
  hash = dsha(header(1, Buffer.alloc(32), txid, TIME, BITS, nonce));
  if (BigInt('0x' + display(hash)) <= target) break;
  nonce++;
  if (nonce % 500_000 === 0) console.log(`  …${nonce.toLocaleString('en-US')} hashes`);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const result = {
  pszTimestamp: PSZ,
  genesisPubkey: PUBKEY,
  nTime: TIME,
  nBits: '0x' + BITS.toString(16),
  nNonce: nonce,
  nVersion: 1,
  reward: '50 JrBTC',
  genesisHash: display(hash),
  merkleRoot: display(txid)
};
console.log(`\nFound in ${secs}s after ${nonce.toLocaleString('en-US')} hashes:\n`);
console.log(JSON.stringify(result, null, 2));
writeFileSync(new URL('./genesis-params.json', import.meta.url), JSON.stringify(result, null, 2));
console.log('\nSaved to tools/genesis-params.json');
