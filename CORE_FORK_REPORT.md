# JrBTC Core — Fork Report

**Base:** Bitcoin Core **v31.1** (shallow clone of the official tag from github.com/bitcoin/bitcoin)
**Fork location:** `C:\jrbtc-core`
**Stack:** C++20 · libsecp256k1 · LevelDB · Bitcoin Script (SegWit + Taproot) · Bitcoin P2P protocol · getblocktemplate mining · MSVC (VS 2022 Build Tools) · CMake · vcpkg — i.e., the modern equivalent of every layer in the original Satoshi stack, inherited rather than reimplemented.

## Why this is the right "exactly like BTC" claim

JrBTC Core does not re-implement Bitcoin's mining or validation — it **runs** them.
SHA-256d proof-of-work, the 2016-block/14-day retarget, the 50-coin halving subsidy under a
21M cap, UTXO validation, Script/SegWit/Taproot, mempool policy, headers-first sync,
compact blocks, and the JSON-RPC surface (`getblocktemplate`, `getblockchaininfo`,
`sendrawtransaction`, descriptor wallets…) are Bitcoin Core's own code, untouched.
Miners point standard SHA-256 mining software at it; exchanges integrate it like
any Bitcoin-family coin.

## The complete divergence from Bitcoin (kept deliberately tiny and auditable)

### `src/kernel/chainparams.cpp` — `CMainParams` only
| Change | Bitcoin | JrBTC |
|---|---|---|
| Genesis block | 03/Jan/2009, nonce 2083236893 | **22/Jul/2026**, nTime 1784700467, nonce 1316746, nBits 0x1e0ffff0 |
| Genesis hash | `000000000019d668…` | `000000a9896e6f1c0d6962f5850ac81c8149ecd7323989c3ed685ff47b392573` |
| Genesis merkle root | `4a5e1e4b…` | `9330e6dd782eb7c9351966a4e7f3f46172eb401c98d4c3e9e82994f8d6ee5b64` |
| Coinbase message | Chancellor bailout headline | "22/Jul/2026 New PM Andy Burnham enters Downing Street; everyone starts somewhere" |
| Message start (magic) | `F9 BE B4 D9` | `FA 4A 52 DA` (contains "JR") |
| P2P / RPC ports | 8333 / 8332 | **9333 / 9332** (RPC port in `src/chainparamsbase.cpp`) |
| powLimit | `00000000ffff…` | `00000fffff…` (young-network floor; Litecoin-style) |
| Soft-fork history | activation heights 2012–2021 | BIP34/65/66/CSV/SegWit at height 1, Taproot ALWAYS_ACTIVE — everything on from genesis |
| Script-flag exceptions | 2 historical blocks | none (fresh chain) |
| nMinimumChainWork / assumevalid | set to recent BTC tip | **zero** — every block fully validated |
| DNS + fixed seeds | 8 seeders + hardcoded list | none yet (bootstrap via `-addnode`) |
| assumeUTXO snapshots | 4 snapshots | none |
| base58 prefixes | 0 / 5 / 128 | **43 ('J…') / 44 / 171** |
| bech32 HRP | `bc` | **`jr`** → native addresses read `jr1q…` / `jr1p…` |
| chainTxData | BTC stats | genesis-only |

### Monetary-policy divergence (`src/validation.cpp`, `src/consensus/params.h`)
`GetBlockSubsidy` gains one rule: **block 1 pays the disclosed 2,000,000 JrBTC Founder
Reserve** (`Consensus::Params::nFounderReserveAmount`, mainnet-only; 0 for every other
chain). To keep the total under `MAX_MONEY` = 21,000,000, the halving interval is 190,000
blocks: ~18,999,950 minable + 2,000,000 reserve ≈ 20,999,950 ceiling. The reserve is a
consensus rule every node enforces and can audit at block 1 — not a hidden allocation.

**Not changed anywhere else:** consensus validation, PoW algorithm, retarget algorithm,
block/tx serialization, Script interpreter, P2P message semantics, wallet, RPC.
Testnet/signet/regtest parameter sets remain vanilla upstream (regtest still works for
local development and CI).

## Genesis provenance (`tools/genesis-grind.mjs`)

The genesis block was ground by a purpose-built tool that serializes blocks in Core's
exact binary format. As proof of byte-exactness, the tool first **reconstructs Bitcoin's
real genesis block from Satoshi's parameters and reproduces the canonical hash**
`000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f` before grinding ours
(including Core's quirk of hardcoding `486604799` in the coinbase scriptSig regardless of
header nBits, and `OP_PUSHDATA1` encoding for coinbase messages longer than 75 bytes —
JrBTC's 81-byte headline needs it, Satoshi's 69-byte one didn't). Parameters are archived
in `tools/genesis-params.json`. The genesis output
key was generated and discarded; like Bitcoin's, the genesis coinbase is unspendable.
The founder allocation happens transparently at block 1 under the consensus rule above,
paid to the dedicated "owner" wallet.

## Build & run

```powershell
# one-time build (after VS Build Tools + CMake + vcpkg are installed)
powershell -File C:\jrbtc-core\build-jrbtc.ps1

# start the JrBTC mainnet node
C:\jrbtc-core\build\bin\Release\bitcoind.exe -datadir=C:\jrbtc-data -daemon=0

# in a second terminal: create a wallet and mine
$cli = 'C:\jrbtc-core\build\bin\Release\bitcoin-cli.exe'
& $cli -datadir=C:\jrbtc-data createwallet main
$addr = & $cli -datadir=C:\jrbtc-data getnewaddress          # jr1q…
& $cli -datadir=C:\jrbtc-data generatetoaddress 1 $addr      # CPU-mine at launch difficulty
& $cli -datadir=C:\jrbtc-data getblockchaininfo
```

Real mining software connects via `getblocktemplate` exactly as it would to Bitcoin
(solo) or through standard stratum pool software.

## Follow-up hardening before public launch
1. Change testnet4/signet/regtest magics + ports (currently upstream values) so test networks can't cross-connect with Bitcoin's.
2. Stand up 2+ seed nodes and add them to `vSeeds`; regenerate `vFixedSeeds`.
3. Cosmetic rebrand of binary names/strings (`bitcoind` → `jrbtcd`) — zero consensus impact, so deferred.
4. Track upstream Bitcoin Core security releases and rebase the (tiny) patch forever.
5. Independent audit of this diff before exchange conversations (see LIQUIDITY_AND_LISTING.md).
