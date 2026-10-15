import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PostgresLedger } from '../src/ledger/postgresLedger.js';
import type { LedgerUser } from '../src/ledger/ledger.js';
import { migrate } from '../src/migrate.js';
import { T0 } from './helpers.js';
import { testPool } from './pgtest.js';

let pool: pg.Pool;
let stop: () => Promise<void>;
let ledger: PostgresLedger;
const comp: LedgerUser = { userId: 'u1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02', pseudo: 'PER-001' };
const sys: LedgerUser = { userId: 'u2', role: 'SYSTEM', unit: 'U6', depot: 'NONE', pseudo: 'PER-002' };
const h = 'a'.repeat(64);
const register = (id: string) => ledger.submit<any>(comp, 'complaint:registerCase', [id, 'PSN-0123456789ab', h, '[]', 'DEP-02/MAG-01/BAY-01']);

beforeAll(async () => {
  ({ pool, stop } = await testPool());
  await migrate(pool);
  ledger = new PostgresLedger(pool, () => T0);
});
afterAll(() => stop());

describe('PostgresLedger (centralised baseline)', () => {
  it('runs the same chaincode rules and keeps history', async () => {
    await register('CASE-2026-000001');
    await ledger.submit(sys, 'complaint:triage', ['CASE-2026-000001', 'STORAGE_ENVIRONMENT', '0.5', h, '[]']);
    const hist = await ledger.evaluate<any[]>(sys, 'complaint:getCaseHistory', ['CASE-2026-000001']);
    expect(hist.map((x) => x.status)).toEqual(['SUBMITTED', 'TRIAGED']);
  });

  it('rejects rule violations without writing', async () => {
    await expect(register('CASE-2026-000001')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    await expect(ledger.submit(comp, 'complaint:triage', ['CASE-2026-000001', 'STORAGE_ENVIRONMENT', '0.5', h, '[]'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { rows } = await pool.query('select count(*)::int as n from central_history');
    expect(rows[0].n).toBe(2);
  });

  it('evaluate never writes', async () => {
    await ledger.evaluate(comp, 'complaint:registerCase', ['CASE-2026-000009', 'PSN-0123456789ab', h, '[]', 'DEP-02/MAG-01/BAY-01']);
    await expect(ledger.evaluate(sys, 'complaint:getCase', ['CASE-2026-000009'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lifecycle range queries work over the starts_with index', async () => {
    const ev = (id: string, at: string) => ledger.submit(sys, 'lifecycle:recordEvent', [id, 'LOT-B03-2025-0117', 'ISSUE', '', '', '1', 'PER-1', 'U1', at, h]);
    await ev('EVT-000002', '2026-10-02T00:00:00Z');
    await ev('EVT-000001', '2026-10-01T00:00:00Z');
    const hist = await ledger.evaluate<any[]>(sys, 'lifecycle:getAssetHistory', ['LOT-B03-2025-0117']);
    expect(hist.map((e) => e.eventId)).toEqual(['EVT-000001', 'EVT-000002']);
  });
});
