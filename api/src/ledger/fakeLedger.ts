import { ctxFor, newWorld } from '../../../chaincode/aegis-cc/test/fakeContext.js';
import { actorFor, invokeChaincode } from './inProcess.js';
import type { Ledger, LedgerUser } from './ledger.js';

/** Runs the real chaincode classes in-process against an in-memory world state (tests and offline dev). */
export class FakeLedger implements Ledger {
  readonly world = newWorld();
  private seq = 0;

  constructor(private clock: () => Date) {}

  private async call(user: LedgerUser, fn: string, args: string[], write: boolean) {
    const txId = `tx-${String(++this.seq).padStart(6, '0')}`;
    const ctx = ctxFor(this.world, actorFor(user), { txId, time: this.clock() });
    // Fabric transactions are atomic and evaluations never write: snapshot and restore on failure / evaluate.
    const snapshot = { state: new Map(this.world.state), history: new Map([...this.world.history].map(([k, v]) => [k, [...v]])), events: this.world.events.length };
    const restore = () => {
      this.world.state.clear(); snapshot.state.forEach((v, k) => this.world.state.set(k, v));
      this.world.history.clear(); snapshot.history.forEach((v, k) => this.world.history.set(k, v));
      this.world.events.length = snapshot.events;
    };
    try {
      const result = await invokeChaincode(fn, ctx, args);
      if (!write) restore();
      return { txId, result };
    } catch (e) {
      restore();
      throw e;
    }
  }

  async submit<T>(user: LedgerUser, fn: string, args: string[]) {
    return (await this.call(user, fn, args, true)) as { txId: string; result: T };
  }

  async evaluate<T>(user: LedgerUser, fn: string, args: string[]) {
    return (await this.call(user, fn, args, false)).result as T;
  }
}
