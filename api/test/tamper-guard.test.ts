import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerWriterToken } from '../src/db.js';
import { auth, complaint, makeTestApp, type TestApp } from './helpers.js';

const TOKEN = 'app-writer-token-0123456789abcdef0123456789';
let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let comp: U, so: U, audit: U;
let caseId: string;

/** Runs SQL the way someone in psql would: same database, but without the application's writer token. */
async function asInsider(sql: string, params: unknown[] = []) {
  await t.deps.pool.query(`select set_config('aegis.writer', '', false)`);
  try {
    return await t.deps.pool.query(sql, params);
  } finally {
    await t.deps.pool.query(`select set_config('aegis.writer', $1, false)`, [TOKEN]);
  }
}

beforeAll(async () => {
  t = await makeTestApp();
  comp = await t.user({ username: 'comp1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  so = await t.user({ username: 'safety1', role: 'SAFETY_OFFICER', unit: 'U5' });
  audit = await t.user({ username: 'audit1', role: 'AUDITOR', unit: 'U6' });
  expect(await registerWriterToken(t.deps.pool, TOKEN)).toBe('registered');
  t.deps.pool.on('connect', (c) => { void c.query(`select set_config('aegis.writer', $1, false)`, [TOKEN]); });
  await t.deps.pool.query(`select set_config('aegis.writer', $1, false)`, [TOKEN]);
  caseId = (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(comp.token), payload: complaint })).json().caseId;
});
afterAll(() => t.stop());

describe('database tamper guard', () => {
  it('the application can still write normally', () => expect(caseId).toMatch(/^CASE-/));

  it('an UPDATE from a terminal reports success but changes nothing, and is logged with the attempted values', async () => {
    const r = await asInsider(`update cases set status = 'CLOSED_FINAL', outcome = 'NOT_SUBSTANTIATED' where case_id = $1`, [caseId]);
    expect(r.rowCount).toBe(1);
    const { rows } = await t.deps.pool.query('select status, outcome from cases where case_id = $1', [caseId]);
    expect(rows[0]).toEqual({ status: 'SUBMITTED', outcome: null });
    const list = (await t.app.inject({ url: `/api/v1/audit/tamper-attempts?caseId=${caseId}`, headers: auth(await t.token(audit.id)) })).json();
    expect(list[0]).toMatchObject({ table: 'cases', operation: 'UPDATE', outcome: 'Original values kept' });
    expect(list[0].changes).toEqual(expect.arrayContaining([
      { field: 'status', original: 'SUBMITTED', attempted: 'CLOSED_FINAL' },
      { field: 'outcome', original: null, attempted: 'NOT_SUBSTANTIATED' },
    ]));
    expect(list[0].query).toContain('update cases');
  });

  it('a DELETE and a forged INSERT are skipped; encrypted values are not echoed back', async () => {
    expect((await asInsider('delete from case_content where case_id = $1', [caseId])).rowCount).toBe(0);
    expect((await t.deps.pool.query('select count(*)::int as n from case_content where case_id = $1', [caseId])).rows[0].n).toBe(1);
    await asInsider(`update case_content set description_enc = '\\x00' where case_id = $1`, [caseId]);
    const list = (await t.app.inject({ url: `/api/v1/audit/tamper-attempts?caseId=${caseId}`, headers: auth(await t.token(audit.id)) })).json();
    expect(list.find((a: any) => a.operation === 'DELETE')).toMatchObject({ table: 'case_content', outcome: 'Row not deleted' });
    expect(list[0].changes).toEqual([{ field: 'description_enc', original: '(encrypted / secret value)', attempted: '(encrypted / secret value)' }]);
  });

  it('the case page still shows the original data and how many attempts were blocked', async () => {
    const view = (await t.app.inject({ url: `/api/v1/cases/${caseId}`, headers: auth(await t.token(so.id)) })).json();
    expect(view).toMatchObject({ status: 'SUBMITTED', title: complaint.title, blockedTamperAttempts: 3 });
  });

  it('nobody can erase the attempts log', async () => {
    const before = (await t.deps.pool.query('select count(*)::int as n from tamper_attempts')).rows[0].n;
    await t.deps.pool.query('delete from tamper_attempts');
    const after = await t.deps.pool.query(`select count(*) filter (where table_name <> 'tamper_attempts')::int as kept,
                                                  count(*) filter (where table_name = 'tamper_attempts')::int as erase_attempts from tamper_attempts`);
    expect(after.rows[0].kept).toBe(before);
    expect(after.rows[0].erase_attempts).toBe(before);
  });

  // PGlite (the embedded test database) crashes on statement-level TRUNCATE triggers; run with TEST_DATABASE_URL for real Postgres.
  it.skipIf(!process.env.TEST_DATABASE_URL)('TRUNCATE is refused', async () => {
    await expect(asInsider('truncate cases cascade')).rejects.toThrow(/not permitted/);
  });

  it('the app refuses to start with a different token', async () => {
    await expect(registerWriterToken(t.deps.pool, 'another-token-0123456789abcdef0123456789')).rejects.toThrow(/does not match/);
  });
});
