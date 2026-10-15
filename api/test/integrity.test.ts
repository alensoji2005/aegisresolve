import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runIntegritySweep } from '../src/audit/routes.js';
import { sealString } from '../src/crypto.js';
import { auth, complaint, makeTestApp, multipart, PNG, type TestApp } from './helpers.js';

let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let comp: U, so: U, audit: U;

beforeAll(async () => {
  t = await makeTestApp();
  comp = await t.user({ username: 'comp1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  so = await t.user({ username: 'safety1', role: 'SAFETY_OFFICER', unit: 'U5' });
  audit = await t.user({ username: 'audit1', role: 'AUDITOR', unit: 'U6' });
  await t.user({ username: 'system', role: 'SYSTEM', unit: 'U6' });
});
afterAll(() => t.stop());

const as = async (u: U) => auth(await t.token(u.id));
async function newCase(withEvidence = false) {
  const id = (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: await as(comp), payload: complaint })).json().caseId as string;
  if (!withEvidence) return { id, eid: '' };
  const m = multipart('photo.png', PNG);
  const eid = (await t.app.inject({ method: 'POST', url: `/api/v1/cases/${id}/evidence`, headers: { ...(await as(comp)), ...m.headers }, payload: m.payload })).json().id;
  return { id, eid };
}
const q = (sql: string, p: unknown[] = []) => t.deps.pool.query(sql, p);

describe('tamper response', () => {
  it('a forged status never reaches the screen and is repaired from the ledger', async () => {
    const { id } = await newCase();
    await q(`update cases set status = 'CLOSED_FINAL', ledger_json = jsonb_set(ledger_json, '{status}', '"CLOSED_FINAL"') where case_id = $1`, [id]);
    expect((await t.app.inject({ url: `/api/v1/cases/${id}`, headers: await as(so) })).json().status).toBe('SUBMITTED');
    const r = (await t.app.inject({ method: 'POST', url: '/api/v1/audit/repair', headers: await as(audit) })).json();
    expect(r.repaired).toEqual(expect.arrayContaining([expect.objectContaining({ caseId: id, field: 'status' })]));
    expect((await q('select status from cases where case_id = $1', [id])).rows[0].status).toBe('SUBMITTED');
    expect((await t.app.inject({ url: '/api/v1/audit/reconcile', headers: await as(audit) })).json().mismatches.filter((m: any) => m.caseId === id)).toEqual([]);
  });

  it('rewritten complaint text is withheld, reported as unrepairable, and logged once', async () => {
    const { id } = await newCase();
    await q('update case_content set description_enc = $2 where case_id = $1', [id, sealString('Nothing happened at all, please ignore.', t.deps.cfg.AEGIS_KEK)]);
    const view = (await t.app.inject({ url: `/api/v1/cases/${id}`, headers: await as(so) })).json();
    expect(view).toMatchObject({ view: 'FULL', description: null, title: null, integrity: { contentIntact: false } });
    const r = (await t.app.inject({ method: 'POST', url: '/api/v1/audit/repair', headers: await as(audit) })).json();
    expect(r.unrepairable).toEqual(expect.arrayContaining([expect.objectContaining({ caseId: id, field: 'content' })]));
    await runIntegritySweep(t.deps);
    expect((await q(`select count(*)::int as n from integrity_incidents where case_id = $1 and kind = 'CONTENT'`, [id])).rows[0].n).toBe(1);
  });

  it('tampered evidence is refused, quarantined, and stays refused', async () => {
    const { id, eid } = await newCase(true);
    const key = `evidence/${id}/${eid}`;
    t.blobs.items.set(key, Buffer.concat([t.blobs.items.get(key)!, Buffer.from('x')]));
    const dl = await t.app.inject({ url: `/api/v1/cases/${id}/evidence/${eid}/download`, headers: await as(so) });
    expect(dl.statusCode).toBe(409);
    expect(dl.json().error.code).toBe('EVIDENCE_TAMPERED');
    expect((await q('select quarantined_at from evidence where id = $1', [eid])).rows[0].quarantined_at).not.toBeNull();
    const again = await t.app.inject({ url: `/api/v1/cases/${id}/evidence/${eid}/download`, headers: await as(so) });
    expect(again.json().error.code).toBe('EVIDENCE_QUARANTINED');
    const list = (await t.app.inject({ url: `/api/v1/cases/${id}/evidence`, headers: await as(so) })).json();
    expect(list[0].quarantinedAt).toBeTruthy();
  });

  it('the background sweep repairs and quarantines on its own, and incidents are listed for auditors', async () => {
    const { id, eid } = await newCase(true);
    await q(`update cases set status = 'CLOSED' where case_id = $1`, [id]);
    const key = `evidence/${id}/${eid}`;
    t.blobs.items.set(key, Buffer.from('replaced'));
    const r = await runIntegritySweep(t.deps);
    expect(r.repaired).toBeGreaterThanOrEqual(1);
    expect((await q('select status from cases where case_id = $1', [id])).rows[0].status).toBe('SUBMITTED');
    expect((await q('select quarantined_at from evidence where id = $1', [eid])).rows[0].quarantined_at).not.toBeNull();
    const inc = (await t.app.inject({ url: `/api/v1/audit/incidents?caseId=${id}`, headers: await as(audit) })).json();
    expect(inc.map((i: any) => i.action).sort()).toEqual(['QUARANTINED', 'REPAIRED_FROM_LEDGER']);
    expect((await t.app.inject({ url: '/api/v1/audit/incidents', headers: await as(so) })).statusCode).toBe(403);
  });
});
