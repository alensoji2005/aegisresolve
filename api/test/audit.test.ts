import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sealString } from '../src/crypto.js';
import { auth, complaint, makeTestApp, multipart, PNG, type TestApp } from './helpers.js';

let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let comp: U, auditor: U, inv: U;
let caseId: string;
let eid: string;

beforeAll(async () => {
  t = await makeTestApp();
  comp = await t.user({ username: 'comp1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  auditor = await t.user({ username: 'audit1', role: 'AUDITOR', unit: 'U6' });
  inv = await t.user({ username: 'inv1', role: 'INVESTIGATOR', unit: 'U4' });
  caseId = (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(comp.token), payload: complaint })).json().caseId;
  const m = multipart('photo.png', PNG);
  eid = (await t.app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/evidence`, headers: { ...auth(comp.token), ...m.headers }, payload: m.payload })).json().id;
});
afterAll(() => t.stop());

const reconcile = async () => (await t.app.inject({ url: '/api/v1/audit/reconcile', headers: auth(await t.token(auditor.id)) })).json();
const verifyAll = async () => (await t.app.inject({ method: 'POST', url: '/api/v1/audit/verify-evidence', headers: auth(await t.token(auditor.id)) })).json();

describe('audit', () => {
  it('clean system -> 0 mismatches, 0 evidence failures', async () => {
    expect(await reconcile()).toEqual({ checked: 1, mismatches: [] });
    expect(await verifyAll()).toEqual({ checked: 1, failures: [] });
  });

  it('direct status edit in Postgres is detected', async () => {
    await t.deps.pool.query(`update cases set status = 'CLOSED' where case_id = $1`, [caseId]);
    expect((await reconcile()).mismatches).toEqual([{ caseId, field: 'status', ledger: 'SUBMITTED', projection: 'CLOSED' }]);
    await t.deps.pool.query(`update cases set status = 'SUBMITTED' where case_id = $1`, [caseId]);
  });

  it('re-sealed, altered complaint text is detected', async () => {
    const { rows } = await t.deps.pool.query('select description_enc from case_content where case_id = $1', [caseId]);
    await t.deps.pool.query('update case_content set description_enc = $2 where case_id = $1',
      [caseId, sealString('Everything was fine, nothing to report here at all.', t.deps.cfg.AEGIS_KEK)]);
    expect((await reconcile()).mismatches.map((m: any) => m.field)).toEqual(['content']);
    await t.deps.pool.query('update case_content set description_enc = $2 where case_id = $1', [caseId, rows[0].description_enc]);
  });

  it('tampered blob is reported by verify-evidence', async () => {
    const key = `evidence/${caseId}/${eid}`;
    const orig = t.blobs.items.get(key)!;
    t.blobs.items.set(key, Buffer.concat([orig, Buffer.from([0])]));
    expect((await verifyAll()).failures).toEqual([expect.objectContaining({ evidenceId: eid, cipherHashOk: false, ok: false })]);
    t.blobs.items.set(key, orig);
  });

  it('access log and history readable by auditor; investigator -> 403', async () => {
    const tok = await t.token(auditor.id);
    expect((await t.app.inject({ url: `/api/v1/audit/access-log?caseId=${caseId}`, headers: auth(tok) })).statusCode).toBe(200);
    expect((await t.app.inject({ url: `/api/v1/audit/cases/${caseId}/history`, headers: auth(tok) })).json()[0].status).toBe('SUBMITTED');
    expect((await t.app.inject({ url: '/api/v1/audit/reconcile', headers: auth(await t.token(inv.id)) })).statusCode).toBe(403);
  });
});
