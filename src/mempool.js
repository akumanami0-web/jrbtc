import { txId, validateTx, isCoinbase } from './transaction.js';

export class Mempool {
  constructor(chain) {
    this.chain = chain;
    this.txs = new Map();       // txid -> {tx, fee}
    this.spentKeys = new Set(); // outpoints claimed by pending txs
    this.version = 0;           // bumped on any change; miners watch this
  }

  /** Validate against the chain UTXO set + other pending txs. */
  accept(tx) {
    if (isCoinbase(tx)) throw new Error('coinbase cannot enter mempool');
    const id = txId(tx);
    if (this.txs.has(id)) return { id, accepted: false, reason: 'already known' };

    for (const inp of tx.inputs) {
      if (this.spentKeys.has(`${inp.txid}:${inp.vout}`)) {
        throw new Error('conflicts with a pending transaction');
      }
    }
    const fee = validateTx(
      tx,
      (t, v) => this.chain.utxo.get(`${t}:${v}`),
      this.chain.height
    );

    this.txs.set(id, { tx, fee });
    for (const inp of tx.inputs) this.spentKeys.add(`${inp.txid}:${inp.vout}`);
    this.version++;
    return { id, accepted: true, fee };
  }

  /** Drop txs confirmed in (or conflicting with) the current chain. */
  refresh() {
    let changed = false;
    for (const [id, { tx }] of this.txs) {
      const stillValid = tx.inputs.every(
        inp => this.chain.utxo.get(`${inp.txid}:${inp.vout}`) !== undefined
      );
      if (!stillValid) {
        for (const inp of tx.inputs) this.spentKeys.delete(`${inp.txid}:${inp.vout}`);
        this.txs.delete(id);
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  /** Highest-fee-first selection for block templates. */
  select(max) {
    return [...this.txs.values()]
      .sort((a, b) => b.fee - a.fee)
      .slice(0, max)
      .map(e => e.tx);
  }

  get size() { return this.txs.size; }
}
