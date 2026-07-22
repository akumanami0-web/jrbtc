// JrBTC Dashboard — local block explorer + wallet + one-click miner.
// Talks to the JrBTC Core daemon over JSON-RPC (cookie auth) and serves a
// single-page dashboard at http://127.0.0.1:3900. Localhost only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RPC = 'http://127.0.0.1:9332/';
const COOKIE = 'C:/jrbtc-data/.cookie';
const WALLET = 'main';         // day-to-day wallet: mining rewards, sending
const OWNER_WALLET = 'owner';  // founder reserve: holds the 2,000,000 JrBTC
const PORT = 3900;
const here = path.dirname(fileURLToPath(import.meta.url));
const ADDR_FILE = path.join(here, '.mining-address');

async function rpc(method, params = [], wallet = null) {
  const auth = Buffer.from(fs.readFileSync(COOKIE, 'utf8').trim()).toString('base64');
  const res = await fetch(RPC + (wallet ? `wallet/${wallet}` : ''), {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'jrx', method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function ensureWallet(name) {
  try {
    await rpc('getwalletinfo', [], name);
  } catch {
    await rpc('loadwallet', [name]).catch(() => {});
  }
}

async function miningAddress() {
  if (fs.existsSync(ADDR_FILE)) return fs.readFileSync(ADDR_FILE, 'utf8').trim();
  const addr = await rpc('getnewaddress', ['mining'], WALLET);
  fs.writeFileSync(ADDR_FILE, addr);
  return addr;
}

async function summary() {
  await ensureWallet(WALLET);
  await ensureWallet(OWNER_WALLET);
  const [info, mempool, peers, balances] = await Promise.all([
    rpc('getblockchaininfo'),
    rpc('getmempoolinfo'),
    rpc('getconnectioncount'),
    rpc('getbalances', [], WALLET)
  ]);
  let owner = null; // absent until the owner wallet exists on this node
  try {
    const ob = await rpc('getbalances', [], OWNER_WALLET);
    owner = ob.mine.trusted + ob.mine.immature + ob.mine.untrusted_pending;
  } catch { /* owner wallet not present */ }
  const address = await miningAddress();
  const blocks = [];
  for (let h = info.blocks; h > Math.max(0, info.blocks - 12); h--) {
    const hash = await rpc('getblockhash', [h]);
    const b = await rpc('getblock', [hash]);
    blocks.push({ height: h, hash, time: b.time, nTx: b.nTx });
  }
  let supply = null;
  try {
    supply = (await rpc('gettxoutsetinfo', ['none'])).total_amount;
  } catch { supply = null; }
  return {
    coin: 'JrBTC', network: 'Junior Network',
    height: info.blocks, best: info.bestblockhash,
    difficulty: info.difficulty, target: info.target,
    mempool: mempool.size, peers,
    supply, maxSupply: 21_000_000, owner,
    balance: balances.mine, address, blocks
  };
}

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JrBTC — Junior Network Dashboard</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --line:#21262d; --text:#e6edf3; --dim:#8b949e;
          --gold:#f5b83d; --green:#3fb950; --red:#f85149; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:15px/1.5 system-ui,Segoe UI,sans-serif; padding:24px; }
  .wrap { max-width:1080px; margin:0 auto; }
  header { display:flex; align-items:baseline; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
  h1 { font-size:26px; } h1 .jr { color:var(--gold); }
  header .sub { color:var(--dim); }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .card .k { color:var(--dim); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  .card .v { font-size:22px; font-weight:600; margin-top:2px; word-break:break-all; }
  .card .v.gold { color:var(--gold); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; }
  @media (max-width:800px){ .grid2 { grid-template-columns:1fr; } }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; }
  .panel h2 { font-size:15px; margin-bottom:12px; color:var(--gold); }
  .addr { font-family:ui-monospace,Consolas,monospace; font-size:13px; background:var(--bg);
          border:1px solid var(--line); border-radius:6px; padding:8px 10px; word-break:break-all; }
  button { background:var(--gold); color:#1c1400; border:0; border-radius:8px; padding:9px 16px;
           font-weight:700; font-size:14px; cursor:pointer; }
  button.ghost { background:transparent; color:var(--gold); border:1px solid var(--gold); }
  button:disabled { opacity:.45; cursor:wait; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  input { background:var(--bg); border:1px solid var(--line); color:var(--text); border-radius:8px;
          padding:9px 10px; font-size:14px; flex:1; min-width:120px; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { text-align:left; color:var(--dim); font-weight:500; padding:6px 8px; border-bottom:1px solid var(--line); }
  td { padding:7px 8px; border-bottom:1px solid var(--line); font-family:ui-monospace,Consolas,monospace; }
  td.h { color:var(--gold); }
  #log { font-family:ui-monospace,Consolas,monospace; font-size:12.5px; color:var(--dim);
         max-height:140px; overflow-y:auto; }
  #log .ok { color:var(--green); } #log .err { color:var(--red); }
  .note { color:var(--dim); font-size:12.5px; margin-top:8px; }
</style></head>
<body><div class="wrap">
<header>
  <h1><span class="jr">JrBTC</span> · Junior Network</h1>
  <span class="sub">your own chain, running on the Bitcoin Core engine — local dashboard</span>
</header>

<div class="cards">
  <div class="card"><div class="k">Block height</div><div class="v" id="height">…</div></div>
  <div class="card"><div class="k">Circulating supply</div><div class="v gold" id="supply">…</div></div>
  <div class="card"><div class="k">Hard cap</div><div class="v">21,000,000</div></div>
  <div class="card"><div class="k">Owner Reserve</div><div class="v gold" id="owner">…</div></div>
  <div class="card"><div class="k">Difficulty</div><div class="v" id="diff">…</div></div>
  <div class="card"><div class="k">Peers</div><div class="v" id="peers">…</div></div>
  <div class="card"><div class="k">Mempool</div><div class="v" id="mempool">…</div></div>
</div>

<div class="grid2">
  <div class="panel">
    <h2>Your wallet</h2>
    <div class="cards" style="margin-bottom:12px">
      <div class="card"><div class="k">Spendable</div><div class="v gold" id="spendable">…</div></div>
      <div class="card"><div class="k">Immature (maturing)</div><div class="v" id="immature">…</div></div>
    </div>
    <div class="k" style="color:var(--dim);font-size:12px;margin-bottom:4px">YOUR ADDRESS (receive JrBTC here)</div>
    <div class="addr" id="address">…</div>
    <div class="row">
      <button class="ghost" onclick="copyAddr()">Copy address</button>
    </div>
    <div class="note">Mining rewards unlock after 100 blocks — Bitcoin's own coinbase-maturity rule.<br>
    The 2,000,000 JrBTC <b style="color:var(--gold)">Owner Reserve</b> lives in a separate wallet ("owner") and never mixes with this spending wallet. Move it only via <code>bitcoin-cli -rpcwallet=owner</code>.</div>
  </div>

  <div class="panel">
    <h2>Mine JrBTC</h2>
    <p style="color:var(--dim);font-size:13.5px">Real SHA-256d proof-of-work, done by your CPU through Bitcoin Core's mining path. Each block pays <b style="color:var(--gold)">50 JrBTC</b> to your wallet.</p>
    <div class="row">
      <button onclick="mine(1)" id="m1">⛏ Mine 1 block</button>
      <button onclick="mine(5)" id="m5">Mine 5</button>
      <button onclick="mine(25)" id="m25">Mine 25</button>
    </div>
    <h2 style="margin-top:18px">Send JrBTC</h2>
    <div class="row">
      <input id="sendTo" placeholder="jr1q… address">
      <input id="sendAmt" placeholder="amount" style="max-width:110px">
      <button class="ghost" onclick="send()">Send</button>
    </div>
    <h2 style="margin-top:18px">Activity</h2>
    <div id="log"></div>
  </div>
</div>

<div class="panel">
  <h2>Latest blocks</h2>
  <div style="overflow-x:auto"><table>
    <thead><tr><th>Height</th><th>Hash</th><th>Time</th><th>Txs</th><th>Reward</th></tr></thead>
    <tbody id="blocks"></tbody>
  </table></div>
</div>
</div>

<script>
const $ = id => document.getElementById(id);
let busy = false;
function log(msg, cls) {
  const el = document.createElement('div');
  el.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  if (cls) el.className = cls;
  $('log').prepend(el);
}
async function api(path, body) {
  const res = await fetch(path, body ? { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}
function fmt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 }); }
async function refresh() {
  try {
    const s = await api('/api/summary');
    $('height').textContent = fmt(s.height);
    $('supply').textContent = s.supply === null ? '…' : fmt(s.supply);
    $('owner').textContent = s.owner === null ? '—' : fmt(s.owner);
    $('diff').textContent = s.difficulty.toExponential(2);
    $('peers').textContent = s.peers;
    $('mempool').textContent = s.mempool;
    $('spendable').textContent = fmt(s.balance.trusted) + ' JrBTC';
    $('immature').textContent = fmt(s.balance.immature) + ' JrBTC';
    $('address').textContent = s.address;
    $('blocks').innerHTML = s.blocks.map(b =>
      '<tr><td class="h">' + b.height + '</td><td>' + b.hash.slice(0,26) + '…</td><td>' +
      new Date(b.time*1000).toLocaleTimeString() + '</td><td>' + b.nTx + '</td><td>50 JrBTC</td></tr>'
    ).join('');
  } catch (e) { log('node unreachable: ' + e.message, 'err'); }
}
async function mine(n) {
  if (busy) return;
  busy = true; ['m1','m5','m25'].forEach(id => $(id).disabled = true);
  log('mining ' + n + ' block(s)… (real proof-of-work, hold on)');
  try {
    const r = await api('/api/mine', { blocks: n });
    log('mined ' + r.hashes.length + ' block(s) → height ' + r.height + '  (+' + (r.hashes.length*50) + ' JrBTC)', 'ok');
  } catch (e) { log('mining failed: ' + e.message, 'err'); }
  busy = false; ['m1','m5','m25'].forEach(id => $(id).disabled = false);
  refresh();
}
async function send() {
  const to = $('sendTo').value.trim(), amt = $('sendAmt').value.trim();
  if (!to || !amt) return log('enter an address and amount', 'err');
  if (!confirm('Send ' + amt + ' JrBTC to ' + to + '?')) return;
  try {
    const r = await api('/api/send', { to, amount: Number(amt) });
    log('sent! txid ' + r.txid.slice(0, 24) + '… (confirms next block)', 'ok');
    $('sendTo').value = ''; $('sendAmt').value = '';
  } catch (e) { log('send failed: ' + e.message, 'err'); }
  refresh();
}
function copyAddr() {
  navigator.clipboard.writeText($('address').textContent).then(() => log('address copied', 'ok'));
}
refresh();
setInterval(() => { if (!busy) refresh(); }, 5000);
</script>
</body></html>`;

async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

http.createServer(async (req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type });
    res.end(type === 'text/html' ? body : JSON.stringify(body));
  };
  try {
    if (req.method === 'GET' && req.url === '/') return send(200, PAGE, 'text/html');
    if (req.method === 'GET' && req.url === '/api/summary') return send(200, await summary());
    if (req.method === 'POST' && req.url === '/api/mine') {
      const { blocks } = await readBody(req);
      const n = Math.min(Math.max(1, blocks | 0), 25);
      await ensureWallet(WALLET);
      const addr = await miningAddress();
      const hashes = await rpc('generatetoaddress', [n, addr, 1_000_000_000]);
      const height = await rpc('getblockcount');
      return send(200, { hashes, height });
    }
    if (req.method === 'POST' && req.url === '/api/send') {
      const { to, amount } = await readBody(req);
      await ensureWallet(WALLET);
      // Named params; explicit fee_rate because a young chain has no fee estimates.
      const txid = await rpc('sendtoaddress', { address: to, amount, fee_rate: 1 }, WALLET);
      return send(200, { txid });
    }
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`JrBTC dashboard → http://127.0.0.1:${PORT}`);
});
