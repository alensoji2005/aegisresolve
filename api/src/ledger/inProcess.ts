// Compiled chaincode (tsc: legacy decorators + metadata, as on a real peer). esbuild-based runners cannot compile it from src.
import { ComplaintContract, LifecycleContract } from '../../../chaincode/aegis-cc/dist/index.js';
import type { Actor } from '../../../chaincode/aegis-cc/src/types.js';
import { fakeIdentityOf, LedgerError, type LedgerUser } from './ledger.js';

const CONTRACTS: Record<string, any> = { complaint: new ComplaintContract(), lifecycle: new LifecycleContract() };

const parse = (s: unknown) => {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
};

export const actorFor = (u: LedgerUser): Actor => ({ id: fakeIdentityOf(u.userId), role: u.role, unit: u.unit, depot: u.depot, pseudo: u.pseudo });

/** Runs one chaincode function (e.g. 'complaint:registerCase') in-process against the given stub context. */
export async function invokeChaincode(fn: string, ctx: unknown, args: string[]): Promise<unknown> {
  const [cn, fname] = fn.split(':');
  const contract = CONTRACTS[cn];
  if (!contract || typeof contract[fname] !== 'function') throw new LedgerError('LEDGER_ERROR', `unknown function ${fn}`);
  try {
    return parse(await contract[fname](ctx, ...args));
  } catch (e) {
    throw LedgerError.from(e);
  }
}
