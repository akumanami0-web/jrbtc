import http from 'node:http';
import { NETWORK, MAX_SUPPLY } from './config.js';
import { formatAmount } from './util.js';
import { txId } from './transaction.js';
import { blockHash } from './block.js';

// Local control API, bound to 127.0.0.1 only. The wallet never lives in the
// node: the CLI builds and signs transactions locally and posts raw txs here.

function json(res, code, body) {
  const data = JSON.stringify(body, null, 1);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(data);
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 8 * 1024 * 1024) throw new Error('body too large');
  }
  return data ? JSON.parse(data) : {};
}

export function startApi(node, port) {
  const server = http.createServer(async (req, res) => {
    const { chain, mempool, p2p, miner } = node;
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      // ------------------------------------------------------------ GET
      if (req.method === 'GET') {
        if (parts[0] === 'status') {
          return json(res, 200, {
            network: NETWORK.name,
            coin: NETWORK.coinName,
            ticker: NETWORK.ticker,
            protocolVersion: NETWORK.protocolVersion,
            height: chain.height,
            tip: chain.tipHash,
            target: chain.tip.block.header.target,
            supply: chain.supply,
            supplyFormatted: `${formatAmount(chain.supply)} ${NETWORK.coinName}`,
            maxSupply: MAX_SUPPLY,
            percentEmitted: +(100 * chain.supply / MAX_SUPPLY).toFixed(4),
            mempool: mempool.size,
            peers: p2p.peerCount,
            mining: miner.running,
            minerAddress: miner.address,
            blocksMinedLocally: miner.blocksMined
          });
        }
        if (parts[0] === 'balance' && parts[1]) {
          const b = chain.getBalance(parts[1]);
          return json(res, 200, {
            address: parts[1],
            confirmed: b.confirmed,
            immature: b.immature,
            confirmedFormatted: `${formatAmount(b.confirmed)} ${NETWORK.coinName}`,
            immatureFormatted: `${formatAmount(b.immature)} ${NETWORK.coinName}`
          });
        }
        if (parts[0] === 'utxos' && parts[1]) {
          return json(res, 200, chain.getUtxos(parts[1]));
        }
        if (parts[0] === 'block' && parts[1]) {
          const entry = /^\d+$/.test(parts[1])
            ? chain.entryAtHeight(Number(parts[1]))
            : chain.index.get(parts[1]);
          if (!entry) return json(res, 404, { error: 'block not found' });
          return json(res, 200, { hash: entry.hash, height: entry.height, block: entry.block });
        }
        if (parts[0] === 'mempool') {
          return json(res, 200, [...mempool.txs.keys()]);
        }
        if (parts[0] === 'peers') {
          return json(res, 200, [...p2p.peers.values()]
            .filter(p => p.helloed)
            .map(p => ({ host: p.remoteHost, port: p.remoteListenPort, height: p.remoteHeight })));
        }
      }

      // ----------------------------------------------------------- POST
      if (req.method === 'POST') {
        const body = await readBody(req);

        if (parts[0] === 'tx') {
          const r = node.submitTx(body.tx ?? body);
          return json(res, r.accepted ? 200 : 409, r);
        }
        if (parts[0] === 'mine') {
          const n = Math.min(Math.max(1, body.blocks | 0), 500);
          if (!body.address) return json(res, 400, { error: 'address required' });
          const hashes = await miner.mineBlocks(n, body.address);
          return json(res, 200, { mined: hashes.length, hashes, height: chain.height });
        }
        if (parts[0] === 'miner') {
          if (body.action === 'start') {
            if (!body.address) return json(res, 400, { error: 'address required' });
            miner.start(body.address); // runs async
            return json(res, 200, { mining: true, address: body.address });
          }
          if (body.action === 'stop') {
            miner.stop();
            return json(res, 200, { mining: false });
          }
          return json(res, 400, { error: 'action must be start|stop' });
        }
        if (parts[0] === 'peers') {
          if (!body.host || !body.port) return json(res, 400, { error: 'host and port required' });
          p2p.connect(body.host, Number(body.port));
          return json(res, 200, { connecting: `${body.host}:${body.port}` });
        }
      }

      return json(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
