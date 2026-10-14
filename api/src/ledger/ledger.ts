import type { Role } from '../../../chaincode/aegis-cc/src/types.js';

export interface LedgerUser {
  userId: string;
  role: Role;
  unit: string;
  depot: string;
  pseudo: string;
  mspId?: string;
  certPem?: string;
  keyPem?: string;
}

export interface Ledger {
  /** fn is 'contract:function', e.g. 'complaint:registerCase'. */
  submit<T = unknown>(user: LedgerUser, fn: string, args: string[]): Promise<{ txId: string; result: T }>;
  evaluate<T = unknown>(user: LedgerUser, fn: string, args: string[]): Promise<T>;
}

const CODES = [
  'FORBIDDEN', 'NOT_FOUND', 'INVALID_ARG', 'INVALID_TRANSITION', 'COI_VIOLATION', 'INELIGIBLE_APPROVER', 'STALE_FINDINGS',
  'DUPLICATE_APPROVAL', 'APPEAL_WINDOW_CLOSED', 'ALREADY_EXISTS', 'MVCC_READ_CONFLICT', 'UNAVAILABLE',
] as const;
export type LedgerCode = (typeof CODES)[number] | 'LEDGER_ERROR';

export class LedgerError extends Error {
  constructor(public code: LedgerCode, message: string, public details?: unknown) {
    super(message);
  }

  /** Parses chaincode messages of the form "CODE: detail" (possibly wrapped by the peer). */
  static from(e: unknown): LedgerError {
    if (e instanceof LedgerError) return e;
    const msg = e instanceof Error ? e.message : String(e);
    const all = [msg, ...((e as any)?.details ?? []).map((d: any) => d?.message ?? '')].join(' | ');
    const code = CODES.find((c) => new RegExp(`(^|\\W)${c}(:|\\W|$)`).test(all)) ?? 'LEDGER_ERROR';
    const details = code === 'COI_VIOLATION' ? { violations: (all.match(/COI_VIOLATION: ([R1-4,]+)/)?.[1] ?? '').split(',').filter(Boolean) } : undefined;
    return new LedgerError(code, all, details);
  }
}

export function httpStatusFor(code: LedgerCode): number {
  switch (code) {
    case 'FORBIDDEN': case 'INELIGIBLE_APPROVER': return 403;
    case 'NOT_FOUND': return 404;
    case 'INVALID_ARG': return 400;
    case 'UNAVAILABLE': return 503;
    case 'LEDGER_ERROR': return 502;
    default: return 409;
  }
}

export async function withMvccRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LedgerError && e.code === 'MVCC_READ_CONFLICT') return fn();
    throw e;
  }
}
