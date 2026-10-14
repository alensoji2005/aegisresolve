import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseRecord } from '../../chaincode/aegis-cc/src/types.js';
import { projectCase } from '../src/cases/projection.js';
import { LedgerError } from '../src/ledger/ledger.js';
import { loadLedgerUser } from '../src/users/service.js';
import { runSweeps } from '../src/workflow/ticker.js';
import { auth, complaint, makeTestApp, T0, type TestApp } from './helpers.js';

let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let comp: U, so: U, rb1: U, rb2: U, rb3: U, inv1: U, inv3: U, sys: U;

beforeAll(async () => {
  t = await makeTestApp();
  comp = await t.user({ username: 'comp1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  so = await t.user({ username: 'safety1', role: 'SAFETY_OFFICER', unit: 'U5' });
  rb1 = await t.user({ username: 'board1', role: 'REVIEW_BOARD', unit: 'U6' });
  rb2 = await t.user({ username: 'board2', role: 'REVIEW_BOARD', unit: 'U6' });
  rb3 = await t.user({ username: 'board3', role: 'REVIEW_BOARD', unit: 'U6' });
  inv1 = await t.user({ username: 'inv1', role: 'INVESTIGATOR', unit: 'U4', pseudo: 'PER-201' });
  inv3 = await t.user({ username: 'inv3', role: 'INVESTIGATOR', unit: 'U1', depot: 'DEP-02', pseudo: 'PER-203' });
  sys = await t.user({ username: 'system', role: 'SYSTEM', unit: 'U6' });
});
afterAll(() => t.stop());

const post = (token: string, url: string, payload: object = {}) => t.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: auth(token), payload });

async function newTriagedCase(score: number): Promise<string> {
  t.clock.set(T0);
  const caseId = (await post(comp.token, '/cases', complaint)).json().caseId;
  const { result } = await t.ledger.submit<CaseRecord>(await loadLedgerUser(t.deps, sys.id), 'complaint:triage',
    [caseId, 'STORAGE_ENVIRONMENT', String(score), 'a'.repeat(64), '[]']);
  await projectCase(t.deps, result);
  return caseId;
}

async function toReview(score: number) {
  const id = await newTriagedCase(score);
  expect((await post(so.token, `/cases/${id}/assign`, { investigatorUserId: inv1.id })).statusCode).toBe(200);
  expect((await post(inv1.token, `/cases/${id}/accept`)).statusCode).toBe(200);
  const f = await post(inv1.token, `/cases/${id}/findings`, { body: 'Bay humidity exceeded limits for 48 hours; packaging damp.', outcome: 'SUBSTANTIATED' });
  expect(f.json().status).toBe('FINDINGS_SUBMITTED');
  return id;
}

describe('workflow', () => {
  it('MEDIUM case: assign -> accept -> findings -> SO + RB approve -> CLOSED with outcome', async () => {
    const id = await toReview(0.5);
    expect((await post(so.token, `/cases/${id}/review`, { decision: 'APPROVE' })).json().status).toBe('FINDINGS_SUBMITTED');
    expect((await post(rb1.token, `/cases/${id}/review`, { decision: 'APPROVE' })).json().status).toBe('CLOSED');
    const { rows } = await t.deps.pool.query('select status, outcome from cases where case_id = $1', [id]);
    expect(rows[0]).toEqual({ status: 'CLOSED', outcome: 'SUBSTANTIATED' });
  });

  it('assigning a same-depot investigator -> 409 COI_VIOLATION R4', async () => {
    const id = await newTriagedCase(0.5);
    const r = await post(so.token, `/cases/${id}/assign`, { investigatorUserId: inv3.id });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'COI_VIOLATION', details: { violations: ['R4'] } });
  });

  it('investigator cannot review -> 403', async () => {
    const id = await toReview(0.5);
    expect((await post(inv1.token, `/cases/${id}/review`, { decision: 'APPROVE' })).statusCode).toBe(403);
  });

  it('retries once on MVCC_READ_CONFLICT', async () => {
    const id = await toReview(0.5);
    const real = t.deps.ledger.submit.bind(t.deps.ledger);
    let calls = 0;
    t.deps.ledger.submit = async (u, fn, args) => {
      if (fn === 'complaint:recordApproval' && ++calls === 1) throw new LedgerError('MVCC_READ_CONFLICT', 'conflict');
      return real(u, fn, args);
    };
    const r = await post(so.token, `/cases/${id}/review`, { decision: 'APPROVE' });
    t.deps.ledger.submit = real;
    expect(r.statusCode).toBe(200);
    expect(r.json().approvals).toBe(1);
    expect(calls).toBe(2);
  });

  it('appeal after 15 days -> 409 APPEAL_WINDOW_CLOSED; within window -> APPEALED, decided by a non-approver', async () => {
    const id = await toReview(0.5);
    await post(so.token, `/cases/${id}/review`, { decision: 'APPROVE' });
    await post(rb1.token, `/cases/${id}/review`, { decision: 'APPROVE' });
    t.clock.advanceHours(15 * 24);
    const late = await post(await t.token(comp.id), `/cases/${id}/appeal`, { reason: 'The findings ignore the second bay.' });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('APPEAL_WINDOW_CLOSED');
    t.clock.set(new Date(T0.getTime() + 24 * 3600e3));
    expect((await post(await t.token(comp.id), `/cases/${id}/appeal`, { reason: 'The findings ignore the second bay.' })).json().status).toBe('APPEALED');
    expect((await post(await t.token(rb1.id), `/cases/${id}/appeal/decide`, { accept: false, reason: 'Reviewed again, no change.' })).statusCode).toBe(403);
    expect((await post(await t.token(rb3.id), `/cases/${id}/appeal/decide`, { accept: false, reason: 'Reviewed again, no change.' })).json().status)
      .toBe('CLOSED_FINAL');
  });

  it('HIGH needs two distinct board approvals', async () => {
    const id = await toReview(0.7);
    await post(so.token, `/cases/${id}/review`, { decision: 'APPROVE' });
    expect((await post(rb1.token, `/cases/${id}/review`, { decision: 'APPROVE' })).json().status).toBe('FINDINGS_SUBMITTED');
    expect((await post(rb2.token, `/cases/${id}/review`, { decision: 'APPROVE' })).json().status).toBe('CLOSED');
  });
});

describe('ticker', () => {
  it('HIGH case 13h past SLA escalates to 2; nothing to do on rerun', async () => {
    const id = await newTriagedCase(0.7);
    t.clock.set(new Date(T0.getTime() + 37 * 3600e3));
    const r = await runSweeps(t.deps);
    expect(r.escalated).toBeGreaterThanOrEqual(1);
    const { rows } = await t.deps.pool.query('select escalation_level from cases where case_id = $1', [id]);
    expect(rows[0].escalation_level).toBe(2);
    const again = await runSweeps(t.deps);
    expect(again.escalated).toBe(0);
  });

  it('CLOSED case 15 days old becomes CLOSED_FINAL', async () => {
    const id = await toReview(0.5);
    await post(so.token, `/cases/${id}/review`, { decision: 'APPROVE' });
    await post(rb1.token, `/cases/${id}/review`, { decision: 'APPROVE' });
    t.clock.set(new Date(T0.getTime() + 15 * 24 * 3600e3));
    await runSweeps(t.deps);
    const { rows } = await t.deps.pool.query('select status from cases where case_id = $1', [id]);
    expect(rows[0].status).toBe('CLOSED_FINAL');
  });
});
