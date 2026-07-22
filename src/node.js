import { Blockchain } from './blockchain.js';
import { Mempool } from './mempool.js';
import { Miner } from './miner.js';
import { P2P } from './p2p.js';
import { startApi } from './httpapi.js';
import { blockHash } from './block.js';
import { txId } from './transaction.js';
import { NETWORK } from './config.js';

/** A full Junior Network node: chain + mempool + p2p + miner + local API. */
export class JrbtcNode {
  constructor({ datadir = null, p2pPort, apiPort, peers = [], label = 'node' }) {
    this.label = label;
    this.apiPort = apiPort;
    this.initialPeers = peers;

    this.chain = new Blockchain(datadir);
    this.mempool = new Mempool(this.chain);
    this.p2p = new P2P(this.chain, this.mempool, {
      port: p2pPort,
      onNewTip: () => this._onNewTip()
    });
    this.miner = new Miner(this.chain, this.mempool, block => this._onBlockMined(block));
    this.apiServer = null;
  }

  async start() {
    await this.p2p.start();
    if (this.apiPort) this.apiServer = await startApi(this, this.apiPort);
    for (const peer of this.initialPeers) {
      const [host, port] = peer.split(':');
      this.p2p.connect(host, Number(port));
    }
    console.log(
      `[${this.label}] ${NETWORK.name} node up — p2p :${this.p2p.port}` +
      (this.apiPort ? `, api http://127.0.0.1:${this.apiPort}` : '') +
      `, height ${this.chain.height}`
    );
    return this;
  }

  _onNewTip() {
    this.mempool.refresh();
  }

  _onBlockMined(block) {
    const r = this.chain.addBlock(block);
    if (r.added) {
      this.mempool.refresh();
      this.p2p.announceBlock(blockHash(block));
    }
  }

  submitTx(tx) {
    const r = this.mempool.accept(tx);
    if (r.accepted) this.p2p.announceTx(txId(tx));
    return r;
  }

  async stop() {
    this.miner.stop();
    this.chain.save?.();
    await this.p2p.stop();
    if (this.apiServer) await new Promise(r => this.apiServer.close(() => r()));
  }
}
