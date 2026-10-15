import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, complaint, makeTestApp, multipart, PNG, T0, type TestApp } from './helpers.js';

let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let comp: U, rb1: U, rb2: U, so: U, inv1: U, audit: U;
let caseId: string;
let eid: string;

beforeAll(async () => {
  t = await makeTestApp();
  comp = await t.user({ username: 'comp1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  rb1 = await t.user({ username: 'board1', role: 'REVIEW_BOARD', unit: 'U6' });
  rb2 = await t.user({ username: 'board2', role: 'REVIEW_BOARD', unit: 'U6' });
  so = await t.user({ username: 'safety1', role: 'SAFETY_OFFICER', unit: 'U5' });
  inv1 = await t.user({ username: 'inv1', role: 'INVESTIGATOR', unit: 'U4' });
  audit = await t.user({ username: 'audit1', role: 'AUDITOR', unit: 'U6' });
  caseId = (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(comp.token), payload: complaint })).json().caseId;
  const m = multipart('photo.png', PNG);
  eid = (await t.app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/evidence`, headers: { ...auth(comp.token), ...m.headers }, payload: m.payload })).json().id;
});
afterAll(() => t.stop());

const as = async (u: U) => auth(await t.token(u.id));
const get = async (u: U, url: string) => t.app.inject({ url: `/api/v1${url}`, headers: await as(u) });
const post = async (u: U, url: string, payload: object = {}) => t.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: await as(u), payload });
const grant = (u: U, granteeUserId: string, scope: string, hours = 2) =>
  post(u, `/cases/${caseId}/disclosures`, { granteeUserId, scope, reason: 'Second opinion requested by the safety board.', hours });

describe('controlled disclosure', () => {
  it('FULL grant lets an unassigned investigator read (not write) until it expires', async () => {
    t.clock.set(T0);
    expect((await get(inv1, `/cases/${caseId}`)).json().view).toBe('SUMMARY');
    expect((await grant(rb1, inv1.id, 'FULL')).statusCode).toBe(201);
    expect((await get(inv1, `/cases/${caseId}`)).json()).toMatchObject({ view: 'FULL', title: complaint.title, grants: { full: true, identity: false } });
    expect((await get(inv1, `/cases/${caseId}/evidence/${eid}/download`)).statusCode).toBe(200);
    const m = multipart('more.png', PNG);
    const up = await t.app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/evidence`, headers: { ...(await as(inv1)), ...m.headers }, payload: m.payload });
    expect(up.statusCode).toBe(403);
    t.clock.advanceHours(3);
    expect((await get(inv1, `/cases/${caseId}`)).json().view).toBe('SUMMARY');
    t.clock.set(T0);
  });

  it('IDENTITY needs a second board member; reveal is logged; revoke ends it', async () => {
    const gid = (await grant(rb1, so.id, 'IDENTITY')).json().grantId;
    expect((await get(so, `/cases/${caseId}/identity`)).statusCode).toBe(403);
    expect((await post(rb1, `/cases/${caseId}/disclosures/${gid}/approve`)).statusCode).toBe(403);
    expect((await post(rb2, `/cases/${caseId}/disclosures/${gid}/approve`)).statusCode).toBe(200);
    const who = await get(so, `/cases/${caseId}/identity`);
    expect(who.json()).toEqual({ username: 'comp1', unit: 'U1', depot: 'DEP-02' });
    const log = (await get(audit, `/audit/access-log?caseId=${caseId}`)).json();
    expect(log.some((e: any) => e.scope === 'IDENTITY' && e.role === 'SAFETY_OFFICER')).toBe(true);
    await post(rb2, `/cases/${caseId}/disclosures/${gid}/revoke`);
    expect((await get(so, `/cases/${caseId}/identity`)).statusCode).toBe(403);
  });

  it('lists grants with usernames and a verified reason', async () => {
    const list = (await get(audit, `/cases/${caseId}/disclosures`)).json();
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'IDENTITY', grantee: 'safety1', grantedBy: 'board1', approvedBy: 'board2', revoked: true, reasonVerified: true })]));
  });

  it('cannot grant to a complainant, and non-board staff cannot grant', async () => {
    expect((await grant(rb1, comp.id, 'FULL')).statusCode).toBe(400);
    expect((await grant(so, inv1.id, 'FULL')).statusCode).toBe(403);
    expect((await get(comp, `/cases/${caseId}/disclosures`)).statusCode).toBe(403);
  });

  it('a grant cannot be forged by editing the database', async () => {
    await t.deps.pool.query(`insert into disclosure_reasons(grant_id, case_id, reason_enc) values (gen_random_uuid(), $1, '\\x00')`, [caseId]);
    const other = await t.user({ username: 'inv9', role: 'INVESTIGATOR', unit: 'U4' });
    expect((await get(other, `/cases/${caseId}`)).json().view).toBe('SUMMARY');
  });
});
