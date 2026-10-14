import { ComplaintContract } from '../../../chaincode/aegis-cc/src/complaint.js';
import { LifecycleContract } from '../../../chaincode/aegis-cc/src/lifecycle.js';
import { ctxFor, newWorld } from '../../../chaincode/aegis-cc/test/fakeContext.js';
import { Ledger, LedgerError, LedgerUser } from './ledger.js';

const parse = (s: unknown) => {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
};

/** Runs the real chaincode classes in-process against an in-memory world state (tests and offline dev). */
export class FakeLedger implements Ledger {
  readonly world = newWorld();
  private contracts: Record<string, any> = { complaint: new ComplaintContract(), lifecycle: new LifecycleContract() };
  private seq = 0;

  constructor(private clock: () => Date) {}

  static identityOf(userId: string): string {
    return 'x509::' + userId;
  }

  private async call(user: LedgerUser, fn: string, args: string[], write: boolean) {
    const [cn, fname] = fn.split(':');
    const contract = this.contracts[cn];
    if (!contract || typeof contract[fname] !== 'function') throw new LedgerError('LEDGER_ERROR', `unknown function ${fn}`);
    const txId = `tx-${String(++this.seq).padStart(6, '0')}`;
    const ctx = ctxFor(this.world, { id: FakeLedger.identityOf(user.userId), role: user.role, unit: user.unit, depot: user.depot, pseudo: user.pseudo },
      { txId, time: this.clock() });
    // Fabric transactions are atomic and evaluations never write: snapshot and restore on failure / evaluate.
    const snapshot = { state: new Map(this.world.state), history: new Map([...this.world.history].map(([k, v]) => [k, [...v]])), events: this.world.events.length };
    const restore = () => {
      this.world.state.clear(); snapshot.state.forEach((v, k) => this.world.state.set(k, v));
      this.world.history.clear(); snapshot.history.forEach((v, k) => this.world.history.set(k, v));
      this.world.events.length = snapshot.events;
    };
    try {
      const result = parse(await contract[fname](ctx, ...args));
      if (!write) restore();
      return { txId, result };
    } catch (e) {
      restore();
      throw LedgerError.from(e);
    }
  }

  async submit<T>(user: LedgerUser, fn: string, args: string[]) {
    return (await this.call(user, fn, args, true)) as { txId: string; result: T };
  }

  async evaluate<T>(user: LedgerUser, fn: string, args: string[]) {
    return (await this.call(user, fn, args, false)).result as T;
  }
}
