import type pg from 'pg';
import { actorFor, invokeChaincode } from './inProcess.js';
import type { Ledger, LedgerUser } from './ledger.js';

const SEP = '\u001f'; // Postgres text cannot hold the NUL separator Fabric uses
export const centralKey = (type: string, parts: string[]) => SEP + type + SEP + parts.map((p) => p + SEP).join('');

/**
 * Baseline for objective 13: the same chaincode rules, but "the ledger" is two ordinary tables in the application's own
 * database. Anyone with database access can rewrite state and history, which is exactly what a centralised system allows.
 */
export class PostgresLedger implements Ledger {
  constructor(private pool: pg.Pool, private clock: () => Date) {}

  private async call(user: LedgerUser, fn: string, args: string[], write: boolean) {
    const client = await this.pool.connect();
    const time = this.clock();
    const writes = new Map<string, Buffer>();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(4242)'); // one writer at a time, like an ordered ledger
      const txId = 'pg-' + String((await client.query(`select nextval('central_tx_seq') as n`)).rows[0].n).padStart(8, '0');
      const actor = actorFor(user);
      const attrs: Record<string, string> = { role: actor.role, unit: actor.unit, depot: actor.depot, pseudo: actor.pseudo };
      const rows = async (sql: string, p: unknown[]) => (await client.query(sql, p)).rows;
      const iterator = (items: { key: string; value: Buffer }[]) => {
        let i = 0;
        return { next: async () => (i < items.length ? { done: false, value: items[i++] } : { done: true, value: undefined }), close: async () => undefined };
      };
      const stub = {
        getTxID: () => txId,
        getTxTimestamp: () => ({ seconds: Math.floor(time.getTime() / 1000), nanos: (time.getTime() % 1000) * 1e6 }),
        createCompositeKey: centralKey,
        // Like Fabric, reads see committed state only, not this transaction's own writes.
        getState: async (k: string) => (await rows('select value from central_state where key = $1', [k]))[0]?.value ?? Buffer.alloc(0),
        putState: async (k: string, v: Buffer) => { writes.set(k, Buffer.from(v)); },
        getStateByPartialCompositeKey: async (type: string, parts: string[]) =>
          iterator(await rows('select key, value from central_state where starts_with(key, $1) order by key', [centralKey(type, parts)])),
        getHistoryForKey: async (k: string) => iterator((await rows('select tx_id, ts, value from central_history where key = $1 order by id', [k]))
          .map((r) => ({ key: k, txId: r.tx_id, timestamp: { seconds: Math.floor(new Date(r.ts).getTime() / 1000), nanos: 0 }, value: r.value }))),
        setEvent: () => undefined,
      };
      const clientIdentity = { getID: () => actor.id, getMSPID: () => 'CentralMSP', getAttributeValue: (n: string) => attrs[n] ?? null };
      const result = await invokeChaincode(fn, { stub, clientIdentity, logging: {} }, args);
      if (write) {
        for (const [k, v] of writes) {
          await client.query('insert into central_state(key, value) values ($1,$2) on conflict (key) do update set value = excluded.value', [k, v]);
          await client.query('insert into central_history(key, tx_id, ts, value) values ($1,$2,$3,$4)', [k, txId, time, v]);
        }
      }
      await client.query(write ? 'commit' : 'rollback');
      return { txId, result };
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async submit<T>(user: LedgerUser, fn: string, args: string[]) {
    return (await this.call(user, fn, args, true)) as { txId: string; result: T };
  }

  async evaluate<T>(user: LedgerUser, fn: string, args: string[]) {
    return (await this.call(user, fn, args, false)).result as T;
  }
}
