# JrBTC — the Junior Network

A proof-of-work cryptocurrency with its own peer-to-peer network. Not a token — a sovereign chain with a 21,000,000 hard cap: a disclosed 2,000,000 Founder Reserve at block 1, and ~19,000,000 publicly mineable at 50/block, halving every 190,000 blocks under Bitcoin's SHA-256d rules.

**Two implementations:**

1. **JrBTC Core** (`C:\jrbtc-core`) — the production mainnet node: a fork of **Bitcoin Core v31.1** (C++, libsecp256k1, LevelDB, full Bitcoin Script with SegWit + Taproot, Bitcoin P2P protocol, getblocktemplate mining, Core-compatible JSON-RPC). Diverges from Bitcoin only in chain parameters. See [CORE_FORK_REPORT.md](CORE_FORK_REPORT.md).
2. **This repo's JavaScript node** — the educational reference: the entire design in ~2,000 dependency-free lines of Node.js, running its own practice network. Read it to understand every moving part.

- 📄 [WHITEPAPER.md](WHITEPAPER.md) — full protocol specification
- 🚀 [GROWTH_PLAN.md](GROWTH_PLAN.md) — the Trend-of-the-Year launch strategy
- 💧 [LIQUIDITY_AND_LISTING.md](LIQUIDITY_AND_LISTING.md) — how liquidity, listings, and trader safety actually work
- 🔧 [CORE_FORK_REPORT.md](CORE_FORK_REPORT.md) — exact diff of JrBTC Core vs Bitcoin Core

## Quickstart (Node.js ≥ 18)

```
# 1. Prove the consensus rules to yourself
node test/run-tests.js

# 2. Watch two real nodes reach consensus over TCP
node demo/two-node-demo.js

# 3. Create your wallet
node cli.js init-wallet

# 4. Start your node (add --mine to mine to your wallet)
node cli.js start-node --mine

# In a second terminal:
node cli.js status
node cli.js balance
node cli.js send <jr1address> 12.5
node cli.js mine 5
node cli.js supply-schedule
```

Join someone else's network: `node cli.js start-node --connect <host>:9333`

## Layout

| File | Purpose |
|---|---|
| `src/config.js` | Consensus + network parameters (rename the coin here if ever needed) |
| `src/util.js` | Hashing, base58check, merkle trees, target/work math, exact amounts |
| `src/keys.js` | secp256k1 keypairs, signatures, `jr1…` addresses |
| `src/transaction.js` | UTXO transactions, coinbase rules, full validation |
| `src/block.js` | Headers, block hashing, proof-of-work |
| `src/blockchain.js` | Chain state, UTXO set, difficulty retarget, reorgs, persistence, deterministic genesis |
| `src/mempool.js` | Pending transactions, double-spend rejection |
| `src/miner.js` | Block templates + non-blocking mining loop |
| `src/p2p.js` | Junior Network wire protocol (TCP gossip + sync) |
| `src/httpapi.js` | Local node control API (127.0.0.1 only) |
| `src/node.js` | Full node wiring |
| `src/wallet.js` | Key storage + transaction building/signing (keys never touch the node) |
| `cli.js` | `jrbtc` command-line interface |

## Consensus parameters

**Mainnet (JrBTC Core):** 21,000,000 cap · 2,000,000 Founder Reserve at block 1 (consensus rule, disclosed) · 50 JrBTC subsidy halving every 190,000 blocks · 10-min blocks, 2016-block retarget · 100-block coinbase maturity · magic `FA 4A 52 DA` · ports 9333 (p2p) / 9332 (rpc).
**Educational JS network:** 120 s blocks · retarget every 720 blocks · 20-block maturity · magic `JRNW/1` — a separate practice chain with simplified parameters.

## License

MIT. Software provided as-is, without warranty. Nothing here is investment advice.
