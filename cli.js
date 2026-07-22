#!/usr/bin/env node
// jrbtc — command-line interface for the Junior Network.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { NETWORK, COIN, MAX_SUPPLY, INITIAL_REWARD, HALVING_INTERVAL, blockSubsidy } from './src/config.js';
import { parseAmount, formatAmount } from './src/util.js';
import { createWallet, loadWallet, buildTx } from './src/wallet.js';
import { JrbtcNode } from './src/node.js';

const HOME = path.join(os.homedir(), '.jrbtc');
const DEFAULT_WALLET = path.join(HOME, 'wallet.json');
const DEFAULT_DATADIR = path.join(HOME, 'mainnet');
const DEFAULT_FEE = 10_000; // 0.0001 JrBTC

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const api = `http://127.0.0.1:${args.api ?? NETWORK.defaultApiPort}`;
const walletFile = args.wallet ?? DEFAULT_WALLET;

async function call(method, pathName, body) {
  let res;
  try {
    res = await fetch(api + pathName, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    console.error(`Cannot reach node API at ${api}. Start one with: node cli.js start-node`);
    process.exit(1);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const commands = {
  async 'init-wallet'() {
    const w = createWallet(walletFile);
    console.log(`New ${NETWORK.coinName} wallet created: ${walletFile}`);
    console.log(`Address: ${w.address}`);
    console.log('Back this file up — the private key inside is the only way to spend your coins.');
  },

  async address() {
    console.log(loadWallet(walletFile).address);
  },

  async 'start-node'() {
    const node = new JrbtcNode({
      datadir: args.datadir ?? DEFAULT_DATADIR,
      p2pPort: Number(args.p2p ?? NETWORK.defaultP2pPort),
      apiPort: Number(args.api ?? NETWORK.defaultApiPort),
      peers: args.connect ? String(args.connect).split(',') : []
    });
    await node.start();
    if (args.mine) {
      const address = args.address ?? loadWallet(walletFile).address;
      console.log(`[miner] mining to ${address}`);
      node.miner.start(address);
    }
    const shutdown = async () => {
      console.log('\nShutting down…');
      await node.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },

  async status() {
    const s = await call('GET', '/status');
    console.log(`${s.network} — ${s.coin} (${s.ticker})`);
    console.log(`  height     : ${s.height}`);
    console.log(`  tip        : ${s.tip}`);
    console.log(`  supply     : ${s.supplyFormatted}  (${s.percentEmitted}% of 21,000,000)`);
    console.log(`  mempool    : ${s.mempool} tx`);
    console.log(`  peers      : ${s.peers}`);
    console.log(`  mining     : ${s.mining ? `yes → ${s.minerAddress}` : 'no'}`);
  },

  async balance() {
    const address = args._[1] ?? loadWallet(walletFile).address;
    const b = await call('GET', `/balance/${address}`);
    console.log(`Address : ${address}`);
    console.log(`Balance : ${b.confirmedFormatted}`);
    if (b.immature > 0) console.log(`Immature: ${b.immatureFormatted} (mining rewards awaiting maturity)`);
  },

  async send() {
    const [, to, amountStr] = args._;
    if (!to || !amountStr) throw new Error('usage: send <address> <amount> [--fee <amount>]');
    const wallet = loadWallet(walletFile);
    const amount = parseAmount(amountStr);
    const fee = args.fee ? parseAmount(args.fee) : DEFAULT_FEE;
    const utxos = await call('GET', `/utxos/${wallet.address}`);
    const tx = buildTx(wallet, utxos, to, amount, fee);
    const r = await call('POST', '/tx', { tx });
    console.log(`Sent ${formatAmount(amount)} ${NETWORK.coinName} → ${to}`);
    console.log(`  txid: ${r.id}`);
    console.log(`  fee : ${formatAmount(fee)} ${NETWORK.coinName}`);
    console.log('The transaction is in the mempool and will confirm in the next mined block.');
  },

  async mine() {
    const blocks = Number(args._[1] ?? 1);
    const address = args.address ?? loadWallet(walletFile).address;
    const r = await call('POST', '/mine', { blocks, address });
    console.log(`Mined ${r.mined} block(s). New height: ${r.height}`);
  },

  async 'supply-schedule'() {
    console.log(`${NETWORK.coinName} emission schedule (${HALVING_INTERVAL.toLocaleString()} blocks per era, 2-minute blocks)\n`);
    let total = 0, era = 0;
    while (blockSubsidy(era * HALVING_INTERVAL + 1) > 0 && era < 34) {
      const subsidy = blockSubsidy(era * HALVING_INTERVAL + 1);
      const eraTotal = subsidy * HALVING_INTERVAL;
      total += eraTotal;
      if (era < 10 || subsidy < 100) {
        console.log(
          `  era ${String(era).padStart(2)}: ${formatAmount(subsidy).padStart(12)} ${NETWORK.coinName}/block` +
          `  → cumulative ${formatAmount(total).padStart(20)}`
        );
      } else if (era === 10) {
        console.log('  …');
      }
      era++;
    }
    console.log(`\n  Total ever emitted: ${formatAmount(total)} ${NETWORK.coinName}`);
    console.log(`  Hard cap enforced:  ${formatAmount(MAX_SUPPLY)} ${NETWORK.coinName}`);
  },

  help() {
    console.log(`${NETWORK.coinName} — ${NETWORK.name} CLI

  node cli.js init-wallet                     create a wallet (${DEFAULT_WALLET})
  node cli.js address                         show your address
  node cli.js start-node [--p2p ${NETWORK.defaultP2pPort}] [--api ${NETWORK.defaultApiPort}]
                         [--connect host:port] [--datadir dir] [--mine]
  node cli.js status                          node status
  node cli.js balance [address]               balance (defaults to your wallet)
  node cli.js send <address> <amount>         send coins (amount in ${NETWORK.coinName})
  node cli.js mine <n> [--address addr]       mine n blocks
  node cli.js supply-schedule                 print the 21M emission schedule

  Global flags: --api <port>  --wallet <file>`);
  }
};

const run = commands[cmd] ?? commands.help;
run().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
