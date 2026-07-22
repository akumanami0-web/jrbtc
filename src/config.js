// Junior Network — consensus and network parameters.
// Naming is config-driven: if the brand ever needs to change (e.g. to
// "Junior" / "JR"), edit NETWORK below and nothing else.

export const NETWORK = {
  name: 'Junior Network',
  coinName: 'JrBTC',
  ticker: 'JRBTC',
  unitName: 'junior',        // smallest indivisible unit (like the satoshi)
  magic: 'JRNW/1',           // wire magic — peers on other networks are rejected
  protocolVersion: 1,
  defaultP2pPort: 9333,
  defaultApiPort: 9332,
  addressPrefix: 'jr1',
  addressVersion: 0x4a
};

// Monetary policy (all amounts in juniors, the base unit)
export const COIN = 100_000_000;                    // 1 JrBTC = 100,000,000 juniors
export const MAX_SUPPLY = 21_000_000 * COIN;        // hard cap: 21,000,000 JrBTC
export const INITIAL_REWARD = 50 * COIN;            // block subsidy at era 0
export const HALVING_INTERVAL = 210_000;            // blocks per era

// Proof-of-work
export const TARGET_BLOCK_TIME_MS = 120_000;        // 2-minute blocks
export const RETARGET_INTERVAL = 720;               // retarget ~ once a day
export const MAX_TARGET =
  '0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'.slice(0, 64);
export const MAX_TIME_DRIFT_MS = 2 * 3600 * 1000;   // future-block tolerance

// Transaction / block limits
export const COINBASE_MATURITY = 20;                // blocks before a subsidy is spendable
export const MAX_BLOCK_TXS = 4000;
export const MAX_MSG_BYTES = 32 * 1024 * 1024;      // p2p frame cap

// Genesis
export const GENESIS_TIME = 1753142400000;          // 2026-07-22T00:00:00Z
export const GENESIS_TAG = 'junior-network-genesis/everyone-starts-somewhere';

/** Block subsidy at a given height, in juniors. Height 0 (genesis) pays nothing. */
export function blockSubsidy(height) {
  if (height <= 0) return 0;
  const era = Math.floor((height - 1) / HALVING_INTERVAL);
  if (era >= 64) return 0;
  // Bit-shift on integers ≤ 50e8 is safe; use division to stay in Number range.
  return Math.floor(INITIAL_REWARD / 2 ** era);
}
