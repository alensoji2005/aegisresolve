import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerError } from '../src/ledger/ledger.js';
import { auth, makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let compA: U, compB: U, store1: U, store2: U, inv: U, so: U;

export const complaint = {
  title: 'Damp packaging in bay 4',
  description: 'Humidity indicator showed 85% for two days; packaging on the lot looks damp.',
  assetRefs: ['LOT-B03-2025-0117'],
  locationRef: 'DEP-02/MAG-01/BAY-04',
  occurredAt: '2026-10-13T08:00:00.000Z',
};

beforeAll(async () => {
  t = await makeTestApp();
  compA = await t.user({ username: 'comp-a', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  compB = await t.user({ username: 'comp-b', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  store1 = await t.user({ username: 'store-1', role: 'STORE_OFFICER', unit: 'U3', depot: 'DEP-01' });
  store2 = await t.user({ username: 'store-2', role: 'STORE_OFFICER', unit: 'U3', depot: 'DEP-02' });
  inv = await t.user({ username: 'inv-1', role: 'INVESTIGATOR', unit: 'U4' });
  so = await t.user({ username: 'safety-1', role: 'SAFETY_OFFICER', unit: 'U5' });
});
afterAll(() => t.stop());

const create = (token: string, body: object = complaint) => t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(token), payload: body });
const get = (token: string, id: string) => t.app.inject({ url: `/api/v1/cases/${id}`, headers: auth(token) });

describe('cases', () => {
  let caseId: string;

  it('complainant creates case -> 201, ledger SUBMITTED, projection matches', async () => {
    const r = await create(compA.token);
    expect(r.statusCode).toBe(201);
    caseId = r.json().caseId;
    expect(caseId).toMatch(/^CASE-2026-\d{6}$/);
    expect(r.json().pseudonym).toMatch(/^PSN-/);
    const { rows } = await t.deps.pool.query('select status, depot_id, ledger_json from cases where case_id = $1', [caseId]);
    expect(rows[0]).toMatchObject({ status: 'SUBMITTED', depot_id: 'DEP-02' });
    expect(rows[0].ledger_json.caseId).toBe(caseId);
  });

  it('content is stored sealed', async () => {
    const { rows } = await t.deps.pool.query('select title_enc, description_enc from case_content where case_id = $1', [caseId]);
    expect(Buffer.from(rows[0].title_enc).toString('latin1')).not.toContain('Damp');
    expect(Buffer.from(rows[0].description_enc).toString('latin1')).not.toContain('Humidity');
  });

  it('validation: bad asset ref -> 400', async () => {
    const r = await create(compA.token, { ...complaint, assetRefs: ['LOT-1'] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('INVALID_ARG');
  });

  it('investigator cannot create -> 403', async () => {
    expect((await create(inv.token)).statusCode).toBe(403);
  });

  it('ledger failure leaves no rows (503)', async () => {
    const real = t.deps.ledger.submit.bind(t.deps.ledger);
    t.deps.ledger.submit = async () => { throw new LedgerError('UNAVAILABLE', 'down'); };
    const before = (await t.deps.pool.query('select count(*)::int as n from cases')).rows[0].n;
    const r = await create(compA.token);
    t.deps.ledger.submit = real;
    expect(r.statusCode).toBe(503);
    const after = await t.deps.pool.query(`select (select count(*)::int from cases) as c, (select count(*)::int from pseudonyms) as p,
      (select count(*)::int from case_content) as k`);
    expect(after.rows[0]).toEqual({ c: before, p: before, k: before });
  });

  it("complainant B reading A's case -> 404", async () => {
    expect((await get(compB.token, caseId)).statusCode).toBe(404);
  });

  it('store officer of another depot -> 404; same depot gets summary', async () => {
    expect((await get(store1.token, caseId)).statusCode).toBe(404);
    expect((await get(store2.token, caseId)).json().view).toBe('SUMMARY');
  });

  it('unassigned investigator gets summary only', async () => {
    const r = await get(inv.token, caseId);
    expect(r.json().view).toBe('SUMMARY');
    expect(r.json().title).toBeUndefined();
  });

  it('safety officer full view decrypts content and logs FULL access on ledger', async () => {
    const r = await get(so.token, caseId);
    expect(r.json()).toMatchObject({ view: 'FULL', title: complaint.title });
    const log = await t.ledger.evaluate<any[]>({ userId: so.id, role: 'AUDITOR', unit: 'U6', depot: 'NONE', pseudo: '' }, 'complaint:getAccessLog', [caseId]);
    expect(log.some((e) => e.scope === 'FULL' && e.viewer === 'x509::' + so.id)).toBe(true);
  });

  it('complainant summary has timeline but no investigator or content', async () => {
    const body = (await get(compA.token, caseId)).json();
    expect(body).toMatchObject({ view: 'SUMMARY', isOwner: true, status: 'SUBMITTED' });
    expect(body.timeline).toEqual([{ status: 'SUBMITTED', at: expect.any(String) }]);
    expect(body.investigator).toBeUndefined();
    expect(body.description).toBeUndefined();
  });

  it('list is role-filtered', async () => {
    const mine = (await t.app.inject({ url: '/api/v1/cases', headers: auth(compA.token) })).json();
    const other = (await t.app.inject({ url: '/api/v1/cases', headers: auth(compB.token) })).json();
    expect(mine.map((c: any) => c.caseId)).toContain(caseId);
    expect(other).toEqual([]);
  });

  it('history is oversight-only', async () => {
    expect((await t.app.inject({ url: `/api/v1/cases/${caseId}/history`, headers: auth(compA.token) })).statusCode).toBe(403);
    const h = (await t.app.inject({ url: `/api/v1/cases/${caseId}/history`, headers: auth(so.token) })).json();
    expect(h[0]).toMatchObject({ status: 'SUBMITTED', actor: expect.stringMatching(/^COMPLAINANT:/) });
  });
});
