import { Context } from 'fabric-contract-api';
import { Actor } from '../src/types';

export interface FakeWorld {
  state: Map<string, Buffer>;
  history: Map<string, { txId: string; timestamp: Date; value: Buffer }[]>;
  events: { name: string; payload: unknown; txId: string }[];
}

export function newWorld(): FakeWorld {
  return { state: new Map(), history: new Map(), events: [] };
}

let txCounter = 0;

/** In-memory stand-in for a Fabric Context: enough of ChaincodeStub/ClientIdentity for our contracts. */
export function ctxFor(world: FakeWorld, actor: Actor, opts: { txId?: string; time?: Date } = {}): Context {
  const txId = opts.txId ?? `tx-${String(++txCounter).padStart(6, '0')}`;
  const time = opts.time ?? new Date('2026-10-14T09:00:00Z');
  const attrs: Record<string, string> = { role: actor.role, unit: actor.unit, depot: actor.depot, pseudo: actor.pseudo };
  const stub = {
    getTxID: () => txId,
    getTxTimestamp: () => ({ seconds: Math.floor(time.getTime() / 1000), nanos: (time.getTime() % 1000) * 1e6 }),
    createCompositeKey: (type: string, parts: string[]) => '\u0000' + type + '\u0000' + parts.map((p) => p + '\u0000').join(''),
    getState: async (k: string) => world.state.get(k) ?? Buffer.alloc(0),
    putState: async (k: string, v: Buffer) => {
      world.state.set(k, v);
      const h = world.history.get(k) ?? [];
      h.push({ txId, timestamp: time, value: v });
      world.history.set(k, h);
    },
    getStateByPartialCompositeKey: async (type: string, parts: string[]) => {
      const prefix = '\u0000' + type + '\u0000' + parts.map((p) => p + '\u0000').join('');
      const rows = [...world.state.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
      let i = 0;
      return {
        next: async () => (i < rows.length ? { done: false, value: { key: rows[i][0], value: rows[i++][1] } } : { done: true, value: undefined }),
        close: async () => undefined,
      };
    },
    getHistoryForKey: async (k: string) => {
      const rows = world.history.get(k) ?? [];
      let i = 0;
      return {
        next: async () => {
          if (i >= rows.length) return { done: true, value: undefined };
          const r = rows[i++];
          const secs = Math.floor(r.timestamp.getTime() / 1000);
          return { done: false, value: { txId: r.txId, timestamp: { seconds: secs, nanos: 0 }, value: r.value, isDelete: false } };
        },
        close: async () => undefined,
      };
    },
    setEvent: (name: string, payload: Buffer) => {
      world.events.push({ name, payload: JSON.parse(payload.toString('utf8')), txId });
    },
  };
  const clientIdentity = {
    getID: () => actor.id,
    getMSPID: () => (['COMPLAINANT', 'STORE_OFFICER'].includes(actor.role) ? 'Org1MSP' : 'Org2MSP'),
    getAttributeValue: (n: string) => attrs[n] ?? null,
  };
  return { stub, clientIdentity, logging: {} } as unknown as Context;
}

export function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  const name = `${role.toLowerCase()}-1`;
  return { id: `x509::${name}`, role, unit: 'U9', depot: 'NONE', pseudo: `PER-${name}`, ...over };
}
