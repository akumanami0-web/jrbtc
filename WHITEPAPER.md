# JrBTC: A Peer-to-Peer Digital Currency on the Junior Network

**Version 1.0 — July 2026**

---

## Abstract

JrBTC is a proof-of-work digital currency with a fixed supply of 21,000,000 coins, issued and settled on its own purpose-built peer-to-peer network, the **Junior Network**. It is not a token on another chain: every JrBTC that will ever exist is created by miners securing the Junior Network itself, under consensus rules every node independently enforces. The design deliberately follows the sound-money architecture pioneered by Bitcoin — UTXO accounting, ECDSA ownership, SHA-256 proof-of-work, halving-based emission — while choosing parameters suited to a young network. The genesis block pays zero coins to anyone; block 1 pays a one-time, **publicly disclosed Founder Reserve of 2,000,000 JrBTC** (9.52% of the cap) to the founder's on-chain wallet, and the remaining ~19,000,000 JrBTC can only ever be mined publicly under proof-of-work. There are no hidden allocations and no privileged keys: the reserve is a consensus rule every node verifies, visible in block 1 forever. Everyone starts somewhere; on the Junior Network, the founder's share is the part everyone can audit.

---

## 1. Introduction

Most new "coins" today are tokens: entries in a smart contract on someone else's chain, created in full at deployment and distributed by their issuer. That model concentrates initial ownership and inherits the security, fees, and politics of the host chain.

JrBTC takes the older, harder road: a sovereign chain. A currency's credibility rests on the neutrality of its issuance, and the only issuance schedule that is credibly neutral is one enforced by proof-of-work consensus from block one — where the *only* way to obtain newly created coins, for founders and strangers alike, is to contribute work to the network.

The name is worn honestly. JrBTC is the *junior* of Bitcoin: same monetary constitution, smaller and younger network, and built so that its code can be read, run, and understood end-to-end by a single person. That legibility is a feature, not an apology — the Junior Network is designed to be the chain people *learn* on and grow with.

## 2. System overview

JrBTC ships two implementations. **JrBTC Core** — the production mainnet node — is a direct fork of Bitcoin Core v31.1 (C++, libsecp256k1, LevelDB, full Bitcoin Script with SegWit and Taproot active from genesis), diverging from Bitcoin only in chain parameters: genesis block, network magic, ports, address prefixes, and starting difficulty. Everything below the parameter layer is Bitcoin's own battle-tested validation engine, wire protocol, and mining interface (`getblocktemplate`), which also makes JrBTC drop-in compatible with existing exchange, pool, and explorer infrastructure. Alongside it, a dependency-free JavaScript full node (the original reference prototype) survives as the *educational* implementation — small enough to read in a sitting, running its own separate practice network.

A Junior Network node consists of five cooperating components:

1. **Blockchain** — an append-only sequence of blocks, selected by cumulative proof-of-work.
2. **UTXO set** — the current ownership state: every unspent transaction output, derived deterministically from the chain.
3. **Mempool** — validated transactions awaiting confirmation.
4. **Miner** — assembles candidate blocks from the mempool and searches for a header hash below the network target.
5. **P2P layer** — a gossip protocol over TCP that relays blocks and transactions and synchronizes new nodes.

Wallets are deliberately *not* part of the node. Keys live with the user; transactions are signed locally and submitted to any node. A node never holds, and never needs, a private key.

## 3. Consensus

### 3.1 Proof-of-work

Each block header commits to `(version, previous block hash, merkle root, timestamp, target, nonce)`. A block is valid only if the double-SHA-256 hash of its header, interpreted as a 256-bit integer, is at or below the header's target — and only if that target equals the target the consensus rules prescribe for that height. Work is therefore unforgeable: a valid chain of N blocks *is* the receipt for the energy spent building it.

Nodes always follow the chain with the greatest **cumulative work** (Σ 2²⁵⁶ / (target + 1)), not the greatest length. Competing branches are stored, and if a branch overtakes the active chain in work, the node replays it in full from genesis and adopts it only if every block and every transaction is valid. Invalid work is discarded no matter how much energy it represents.

### 3.2 Difficulty adjustment

Mainnet difficulty rules are **exactly Bitcoin's**: a target block interval of **10 minutes**, retargeted every **2016 blocks** (two weeks) from the actual time the window took, clamped to a factor of 4 per adjustment in either direction. Block timestamps must exceed the median of the previous 11 blocks and may not lead network-adjusted time by more than two hours. The only difference from Bitcoin is the *starting* difficulty (proof-of-work limit `0x1e0ffff0`-class rather than `0x1d00ffff`-class — the same choice Litecoin made), so that a young network's modest hashpower can actually produce blocks; the retarget algorithm then tracks real hashrate from there.

### 3.3 Transactions

JrBTC uses the UTXO model with Bitcoin's full transaction machinery: Bitcoin Script, pay-to-witness (SegWit v0), and Taproot (schnorr/BIP340) are active from genesis — there is no activation history to relitigate. Ownership is proven with secp256k1 signatures; native addresses are bech32/bech32m with the human-readable prefix `jr1…` (legacy base58 addresses begin with `J`). Inputs must cover outputs; the difference is the fee, claimable by the miner who confirms the transaction.

Coinbase outputs (mining rewards) may not be spent for **100 blocks** — Bitcoin's coinbase-maturity rule — insulating commerce from short reorganizations.

## 4. Monetary policy

JrBTC's monetary constitution is four numbers, hard-coded and enforced by every node:

| Parameter | Value |
|---|---|
| Maximum supply | **21,000,000 JrBTC** |
| Founder Reserve | **2,000,000 JrBTC**, paid once at block 1 — a consensus rule, disclosed here and auditable on-chain |
| Publicly mineable | ~19,000,000 JrBTC |
| Block subsidy | 50 JrBTC |
| Halving interval | 190,000 blocks (≈ 3.6 years at target rate) |
| Smallest unit | 1 junior = 10⁻⁸ JrBTC |

The subsidy halves every 190,000 blocks through 33 eras, after which it reaches zero and miners are compensated by fees alone. The geometric sum of all mining subsidies is ~**18,999,950 JrBTC** (block 1 pays the reserve *instead of* a 50-coin subsidy); adding the one-time 2,000,000 Founder Reserve gives ~20,999,950 — permanently below the 21,000,000 cap. A block whose coinbase pays even one junior more than its allowed subsidy-plus-fees is invalid, and any chain containing such a block is rejected in its entirety, regardless of the work behind it.

**Launch disclosure:** the genesis block's coinbase pays 0 JrBTC to a provably unspendable address. Block 1 pays the 2,000,000 JrBTC Founder Reserve to the founder's wallet — not as a hidden premine but as a consensus rule stated in this paper, enforced and displayed by every node, and traceable on-chain forever. Its declared purposes are exchange liquidity provisioning, builder grants, and network operations; movements from the reserve address are public by construction. Every other coin — roughly 19 million — can only be earned by public proof-of-work mining, by whoever shows up.

## 5. The Junior Network

Mainnet nodes speak the **Bitcoin P2P wire protocol** over TCP (default port **9333**, RPC **9332**), identified by the JrBTC message-start bytes `0xFA 'J' 'R' 0xDA`; peers on other networks are disconnected at handshake. Full protocol semantics — headers-first sync, compact blocks, inv/getdata gossip, addr relay, feefilter — are inherited unchanged from Bitcoin Core, which is why standard tooling (explorers, ElectrumX-style servers, mining pools, exchange wallets) integrates without custom work. The educational JavaScript implementation uses a deliberately simplified line-delimited JSON analogue of the same message flow:

- **hello** — capabilities exchange: chain height, cumulative work, best tip. A peer that learns of a heavier chain requests synchronization.
- **getblocks / blocks** — batch synchronization from the fork point, located via an exponentially spaced block-hash locator.
- **inv / getdata / block / tx** — gossip: new blocks and transactions are announced by hash, fetched only if unknown, validated, and re-announced. Every relayed object is independently verified; nodes trust arithmetic, not peers.
- **getaddr / addr** — decentralized peer discovery.

A new node needs one reachable peer address. From there it discovers others, downloads the chain, verifies every block and signature back to genesis, and arrives at the identical UTXO set as every honest node — trusting nothing it was told, only what it checked.

## 6. Security model and honest limitations

JrBTC inherits Bitcoin's security assumption: the chain is honest while a majority of hashrate is honest. A young network's absolute hashrate is small, so JrBTC treats its early era with corresponding humility:

- **Deep-reorg exposure.** Until hashrate matures, recipients of large payments should wait far more confirmations than they would on Bitcoin (exchanges should start in the hundreds). Bitcoin's 100-block coinbase maturity applies as-is.
- **Rented-hashpower risk.** A young SHA-256 chain shares its mining algorithm with Bitcoin, so hashpower rental against it is cheap in relative terms. The project's mitigation is transparency (a published attack-cost figure) and conservative confirmation policy — not denial.
- **CPU-friendly era.** At launch difficulty, commodity CPUs mine viable blocks. This is the distribution mechanism working as intended: the widest possible set of participants earning the earliest coins.

JrBTC Core's security argument is inheritance: its consensus-relevant divergence from Bitcoin Core v31.1 is a few dozen lines of chain parameters, kept deliberately auditable, on top of the most adversarially reviewed codebase in the industry. The educational JavaScript node (~2,000 dependency-free lines) makes the complementary argument: the whole design, readable in one sitting.

## 7. Governance and roadmap

Consensus rules change only by node operators voluntarily adopting new software — there is no admin key, no upgrade authority, no foundation veto. The reference roadmap, each item subject to that consent:

- **Era 0 (now):** public testnet season, node-runner tooling, block explorer, seed-node infrastructure.
- **Era 0–1:** deterministic (BIP32-style) wallets, compact block relay, light-client (SPV) proofs, checkpoint option for fast initial sync.
- **Era 1+:** fee-market maturation, hardware-wallet signing flow, mining-pool protocol.

## 8. Legal posture and disclaimer

JrBTC launched with no sale and no issuer promising profit from the efforts of others. Its single founder allocation — the 2,000,000 JrBTC block-1 reserve — is disclosed in this paper, enforced by consensus code rather than by trust, and auditable by anyone from block 1; all other coins enter existence only as mining rewards paid by protocol arithmetic. Nothing in this paper is investment advice or an offer of securities; treatment of digital assets varies by jurisdiction, and participants — especially exchanges, pool operators, and commercial users — are responsible for their own compliance. The software is provided as-is, without warranty. The name JrBTC is a homage; the project is unaffiliated with Bitcoin, whose name and ticker courts and registries have consistently treated as generic terms no one may exclusively claim.

## Appendix A — mainnet parameters (JrBTC Core, forked from Bitcoin Core v31.1)

| | |
|---|---|
| Currency | JrBTC (ticker JRBTC) |
| Network | Junior Network, message start `FA 4A 52 DA` ("·JR·") |
| Consensus | Proof-of-work, double SHA-256, most-work chain — Bitcoin's rules |
| Supply cap | 21,000,000 JrBTC (asymptote ≈ 20,999,949.98 incl. reserve) |
| Subsidy / halving | 50 JrBTC, halves every 190,000 blocks (~3.6 years) |
| Founder Reserve | 2,000,000 JrBTC at block 1 (consensus rule, disclosed) |
| Block interval | 600 s target (Bitcoin's) |
| Retarget | Every 2016 blocks / 14 days, clamped ×4 / ÷4 (Bitcoin's) |
| Starting difficulty | nBits `0x1e0ffff0`; powLimit `0x00000fff…` |
| Coinbase maturity | 100 blocks (Bitcoin's) |
| Script system | Full Bitcoin Script; SegWit + Taproot active from genesis |
| Signatures | ECDSA + Schnorr (BIP340), secp256k1 via libsecp256k1 |
| Addresses | bech32/bech32m HRP `jr` (`jr1…`); legacy base58 `J…` (version 43) |
| Default ports | 9333 p2p / 9332 JSON-RPC |
| Genesis hash | `000000a9896e6f1c0d6962f5850ac81c8149ecd7323989c3ed685ff47b392573` |
| Genesis coinbase | "22/Jul/2026 New PM Andy Burnham enters Downing Street; everyone starts somewhere" — output unspendable |

## Appendix B — emission schedule (eras of 190,000 blocks; cumulative includes the block-1 reserve)

| Era | Subsidy (JrBTC) | Cumulative supply |
|---|---|---|
| — | 2,000,000 (block 1, Founder Reserve) | 2,000,000 |
| 0 | 50 | ≈ 11,499,950 |
| 1 | 25 | 16,249,950 |
| 2 | 12.5 | 18,624,950 |
| 3 | 6.25 | 19,812,450 |
| 4 | 3.125 | 20,406,200 |
| 5 | 1.5625 | 20,703,075 |
| … | … | … |
| 32 | 0.00000001 | ≈ 20,999,949.98 |
| 33+ | 0 (fees only) | ≈ 20,999,949.98 — final, under the 21,000,000 cap |
