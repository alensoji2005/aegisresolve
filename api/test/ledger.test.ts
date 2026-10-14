import { describe, expect, it } from 'vitest';
import { FakeLedger } from '../src/ledger/fakeLedger.js';
import { httpStatusFor, LedgerError, type LedgerUser, withMvccRetry } from '../src/ledger/ledger.js';
import { T0 } from './helpers.js';

const comp: LedgerUser = { userId: 'u1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02', pseudo: 'PER-001' };
const auditor: LedgerUser = { userId: 'u2', role: 'AUDITOR', unit: 'U6', depot: 'NONE', pseudo: 'PER-002' };
const h = 'a'.repeat(64);

describe('FakeLedger', () => {
  it('register then getCase round-trips', async () => {
    const l = new FakeLedger(() => T0);
    const { txId, result } = await l.submit<any>(comp, 'complaint:registerCase', ['CASE-2026-000001', 'PSN-0123456789ab', h, '[]', 'DEP-02/MAG-01/BAY-01']);
    expect(txId).toMatch(/^tx-/);
    expect(result.status).toBe('SUBMITTED');
    expect((await l.evaluate<any>(auditor, 'complaint:getCase', ['CASE-2026-000001'])).caseId).toBe('CASE-2026-000001');
  });

  it('maps chaincode FORBIDDEN to LedgerError', async () => {
    const l = new FakeLedger(() => T0);
    await expect(l.submit(auditor, 'complaint:registerCase', ['CASE-2026-000001', 'PSN-0123456789ab', h, '[]', 'DEP-02/MAG-01/BAY-01']))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('evaluate never persists writes', async () => {
    const l = new FakeLedger(() => T0);
    await l.evaluate(comp, 'complaint:registerCase', ['CASE-2026-000001', 'PSN-0123456789ab', h, '[]', 'DEP-02/MAG-01/BAY-01']);
    await expect(l.evaluate(auditor, 'complaint:getCase', ['CASE-2026-000001'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('LedgerError', () => {
  it('parses COI violations', () => {
    const e = LedgerError.from(new Error('endorse failed: chaincode response 500, COI_VIOLATION: R2,R4'));
    expect(e.code).toBe('COI_VIOLATION');
    expect(e.details).toEqual({ violations: ['R2', 'R4'] });
  });

  it.each([['FORBIDDEN', 403], ['INELIGIBLE_APPROVER', 403], ['NOT_FOUND', 404], ['INVALID_ARG', 400], ['UNAVAILABLE', 503],
    ['COI_VIOLATION', 409], ['STALE_FINDINGS', 409]] as const)('%s -> %i', (code, status) => expect(httpStatusFor(code)).toBe(status));

  it('withMvccRetry retries exactly once', async () => {
    let n = 0;
    const r = await withMvccRetry(async () => { if (n++ === 0) throw new LedgerError('MVCC_READ_CONFLICT', 'x'); return 'ok'; });
    expect([r, n]).toEqual(['ok', 2]);
  });
});
