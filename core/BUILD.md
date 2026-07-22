# Building JrBTC Core

JrBTC Core is **Bitcoin Core v31.1** with a small, auditable set of chain-parameter
and monetary-policy changes. Everything consensus-critical below the parameter layer —
SHA-256d proof-of-work, UTXO validation, Bitcoin Script, SegWit, Taproot, the P2P
protocol, mining via `getblocktemplate`, and the wallet — is Bitcoin Core's own code,
unmodified.

The complete change set is in [`jrbtc-v31.1.patch`](./jrbtc-v31.1.patch) (4 files,
~77 insertions). The exact patched files are mirrored under
[`patched-files/`](./patched-files) for review. See
[`../CORE_FORK_REPORT.md`](../CORE_FORK_REPORT.md) for a line-by-line explanation.

## Reproduce the build

```bash
git clone --branch v31.1 --depth 1 https://github.com/bitcoin/bitcoin.git jrbtc-core
cd jrbtc-core
git apply /path/to/jrbtc-v31.1.patch      # or copy patched-files/src/* over src/*
```

### Windows (MSVC) — how this reference build was produced
- Visual Studio 2022 Build Tools with the C++ (NativeDesktop) workload, CMake, and vcpkg.
- Note: MSVC 17.x has a `consteval` bug that trips two upstream `uint256{...}` literals in
  test-network params; the patch already switches those to `uint256::FromHex(...).value()`.

```powershell
$env:VCPKG_ROOT = 'C:\vcpkg'
cmake -B build -G "Visual Studio 17 2022" -A x64 `
  --toolchain C:\vcpkg\scripts\buildsystems\vcpkg.cmake `
  -DVCPKG_TARGET_TRIPLET=x64-windows `
  -DVCPKG_MANIFEST_NO_DEFAULT_FEATURES=ON -DVCPKG_MANIFEST_FEATURES=wallet `
  -DBUILD_GUI=OFF -DWITH_ZMQ=OFF -DBUILD_TESTS=OFF -DBUILD_BENCH=OFF
cmake --build build --config Release -j 8
```

Outputs: `build/bin/Release/bitcoind.exe`, `bitcoin-cli.exe`.

### Linux / macOS
Standard Bitcoin Core build after applying the patch — see Bitcoin Core's
`doc/build-unix.md` / `doc/build-osx.md`. No JrBTC-specific steps.

## What the patch changes
- **Genesis block** — 22 Jul 2026, its own hash/merkle root, dated coinbase headline.
- **Monetary policy** — block 1 pays the disclosed **2,000,000 JrBTC Founder Reserve**
  (`nFounderReserveAmount`); halving interval 190,000 blocks so reserve + ~19M mined
  stays under the 21M cap.
- **Network identity** — message-start bytes `FA 4A 52 DA`, ports 9333/9332,
  `jr1…` bech32 addresses, `J…` legacy addresses.
- **Fresh-chain hygiene** — no seeds/checkpoints/assumevalid; all soft forks active
  from genesis.
