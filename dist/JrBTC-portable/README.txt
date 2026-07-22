==============================================================
  JrBTC — Junior Network · Portable Node & Miner Kit
==============================================================

WHAT THIS IS
  A self-contained JrBTC full node + wallet + CPU miner.
  Copy this whole folder anywhere — another PC, a pendrive —
  and it runs from there. No installation.

REQUIREMENTS
  - Windows 10/11, 64-bit
  - Microsoft Visual C++ Redistributable 2015-2022 (x64).
    Most PCs already have it. If bitcoind.exe complains about
    missing VCRUNTIME140.dll, install it from:
    https://aka.ms/vs/17/release/vc_redist.x64.exe

QUICK START (join the Junior Network and mine)
  1. start-node.cmd <seed-ip>     <- IP of an existing JrBTC node
     (leave the window open; it is your node)
  2. In a second window: mine.cmd  <- mines blocks to YOUR wallet
  3. my-wallet.cmd                 <- your address and balance

  Your node downloads and verifies the whole chain from the seed
  peer, then mines on top of it. Every block you mine pays 50 JrBTC
  to your own wallet (spendable after 100 more blocks - the same
  coinbase-maturity rule Bitcoin has).

IMPORTANT - WHAT A COPY OF THIS FOLDER MEANS
  - bin\        the JrBTC software (safe to share with anyone)
  - data\       this node's copy of the blockchain (safe to share;
                everyone's chain data is identical and public)
  - data\wallets\   YOUR PRIVATE KEYS. Whoever has this folder
                can spend your coins. Never share it, and DO keep
                a second backup of it somewhere safe.

  The coins themselves do NOT live in any folder - they are entries
  on the shared blockchain. The wallet folder holds the keys that
  control them. Copying the kit to a pendrive copies the software,
  a snapshot of the chain, and (if present) your keys.

PORTS
  P2P 9333 (open/forward this on the seed node's router so others
  can reach it), local RPC 9332 (never expose this to the internet).

NETWORK FACTS
  Coin: JrBTC - hard cap 21,000,000
  2,000,000 JrBTC: disclosed Founder Reserve (block 1, on-chain)
  ~19,000,000 JrBTC: public mining, 50/block halving every 190,000
  blocks - Bitcoin's SHA-256d proof-of-work and difficulty rules.
  Genesis: 22 Jul 2026, message
  "22/Jul/2026 New PM Andy Burnham enters Downing Street;
   everyone starts somewhere"

The software is a fork of Bitcoin Core v31.1 (MIT licence).
Provided as-is, without warranty. Not investment advice.
