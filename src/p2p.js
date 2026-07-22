import net from 'node:net';
import { NETWORK, MAX_MSG_BYTES } from './config.js';
import { txId } from './transaction.js';
import { blockHash } from './block.js';

// Junior Network wire protocol: newline-delimited JSON over TCP.
//   hello     {magic, version, listenPort, height, work, tip}
//   getblocks {locator}            -> blocks {blocks, more}
//   inv       {kind, hash}         -> getdata {kind, hash} -> block/tx
//   getaddr                        -> addr {peers}
//   ping/pong
// Peers with the wrong magic are disconnected immediately.

let nextPeerId = 1;

export class P2P {
  constructor(chain, mempool, { port, onNewTip }) {
    this.chain = chain;
    this.mempool = mempool;
    this.port = port;
    this.onNewTip = onNewTip ?? (() => {});
    this.peers = new Map(); // id -> peer
    this.server = null;
    this.timer = null;
  }

  start() {
    this.server = net.createServer(socket => this._setup(socket, true));
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, () => {
        this.timer = setInterval(() => this._heartbeat(), 30_000);
        this.timer.unref?.();
        resolve();
      });
    });
  }

  stop() {
    clearInterval(this.timer);
    for (const peer of this.peers.values()) peer.socket.destroy();
    this.peers.clear();
    return new Promise(r => (this.server ? this.server.close(() => r()) : r()));
  }

  connect(host, port) {
    for (const p of this.peers.values()) {
      if (p.remoteHost === host && p.remoteListenPort === port) return; // already connected
    }
    const socket = net.connect({ host, port });
    socket.once('connect', () => this._setup(socket, false, { host, port }));
    socket.once('error', () => socket.destroy());
  }

  _setup(socket, inbound, dial = null) {
    const peer = {
      id: nextPeerId++,
      socket,
      inbound,
      buffer: '',
      helloed: false,
      remoteHost: dial?.host ?? socket.remoteAddress,
      remoteListenPort: dial?.port ?? null,
      remoteWork: 0n,
      remoteHeight: 0
    };
    this.peers.set(peer.id, peer);
    socket.setNoDelay(true);
    socket.on('data', chunk => this._onData(peer, chunk));
    const drop = () => {
      socket.destroy();
      this.peers.delete(peer.id);
    };
    socket.on('error', drop);
    socket.on('close', drop);
    this._send(peer, this._helloMsg());
  }

  _helloMsg() {
    return {
      type: 'hello',
      magic: NETWORK.magic,
      version: NETWORK.protocolVersion,
      listenPort: this.port,
      height: this.chain.height,
      work: this.chain.tip.work.toString(16),
      tip: this.chain.tipHash
    };
  }

  _send(peer, msg) {
    try {
      peer.socket.write(JSON.stringify(msg) + '\n');
    } catch { /* dropped by close handler */ }
  }

  broadcast(msg, exceptId = null) {
    for (const peer of this.peers.values()) {
      if (peer.helloed && peer.id !== exceptId) this._send(peer, msg);
    }
  }

  announceBlock(hash, exceptId = null) {
    this.broadcast({ type: 'inv', kind: 'block', hash }, exceptId);
  }

  announceTx(hash, exceptId = null) {
    this.broadcast({ type: 'inv', kind: 'tx', hash }, exceptId);
  }

  _onData(peer, chunk) {
    peer.buffer += chunk.toString('utf8');
    if (peer.buffer.length > MAX_MSG_BYTES) {
      peer.socket.destroy();
      return;
    }
    let idx;
    while ((idx = peer.buffer.indexOf('\n')) >= 0) {
      const line = peer.buffer.slice(0, idx);
      peer.buffer = peer.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        peer.socket.destroy();
        return;
      }
      try {
        this._onMessage(peer, msg);
      } catch (e) {
        // A misbehaving peer must not take the node down.
        console.error(`[p2p] peer ${peer.id} message error: ${e.message}`);
      }
    }
  }

  _requestSync(peer) {
    this._send(peer, { type: 'getblocks', locator: this.chain.locator() });
  }

  _onMessage(peer, msg) {
    if (!peer.helloed && msg.type !== 'hello') {
      peer.socket.destroy();
      return;
    }

    switch (msg.type) {
      case 'hello': {
        if (msg.magic !== NETWORK.magic) {
          peer.socket.destroy();
          this.peers.delete(peer.id);
          return;
        }
        peer.helloed = true;
        peer.remoteListenPort ??= msg.listenPort;
        peer.remoteWork = BigInt('0x' + (msg.work || '0'));
        peer.remoteHeight = msg.height | 0;
        if (peer.remoteWork > this.chain.tip.work) this._requestSync(peer);
        break;
      }

      case 'getblocks': {
        const { blocks, more } = this.chain.getBlocksAfter(msg.locator ?? [], 500);
        this._send(peer, { type: 'blocks', blocks, more });
        break;
      }

      case 'blocks': {
        let newTip = false;
        for (const block of msg.blocks ?? []) {
          const r = this.chain.addBlock(block);
          if (r.isNewTip) newTip = true;
        }
        if (newTip) this.onNewTip();
        if (msg.more) this._requestSync(peer);
        break;
      }

      case 'inv': {
        if (msg.kind === 'block' && !this.chain.index.has(msg.hash)) {
          this._send(peer, { type: 'getdata', kind: 'block', hash: msg.hash });
        } else if (msg.kind === 'tx' && !this.mempool.txs.has(msg.hash)) {
          this._send(peer, { type: 'getdata', kind: 'tx', hash: msg.hash });
        }
        break;
      }

      case 'getdata': {
        if (msg.kind === 'block') {
          const entry = this.chain.index.get(msg.hash);
          if (entry) this._send(peer, { type: 'block', block: entry.block });
        } else if (msg.kind === 'tx') {
          const entry = this.mempool.txs.get(msg.hash);
          if (entry) this._send(peer, { type: 'tx', tx: entry.tx });
        }
        break;
      }

      case 'block': {
        const r = this.chain.addBlock(msg.block);
        if (r.added) {
          if (r.isNewTip) this.onNewTip();
          this.announceBlock(blockHash(msg.block), peer.id);
        } else if (r.orphan) {
          this._requestSync(peer); // we are behind — pull the missing history
        }
        break;
      }

      case 'tx': {
        try {
          const r = this.mempool.accept(msg.tx);
          if (r.accepted) this.announceTx(txId(msg.tx), peer.id);
        } catch { /* invalid or conflicting tx — ignore */ }
        break;
      }

      case 'getaddr': {
        const peers = [...this.peers.values()]
          .filter(p => p.helloed && p.remoteListenPort)
          .map(p => ({ host: p.remoteHost, port: p.remoteListenPort }));
        this._send(peer, { type: 'addr', peers });
        break;
      }

      case 'addr': {
        for (const { host, port } of (msg.peers ?? []).slice(0, 16)) {
          if (this.peers.size >= 16) break;
          if (host && port && port !== this.port) this.connect(host, port);
        }
        break;
      }

      case 'ping': this._send(peer, { type: 'pong' }); break;
      case 'pong': break;

      default: break; // unknown types ignored for forward compatibility
    }
  }

  _heartbeat() {
    for (const peer of this.peers.values()) {
      if (peer.helloed) this._send(peer, this._helloMsg());
    }
  }

  get peerCount() {
    return [...this.peers.values()].filter(p => p.helloed).length;
  }
}
