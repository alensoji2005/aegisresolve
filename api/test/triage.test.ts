import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTriage } from '../src/triage/job.js';
import { suggestLifecycleEvents } from '../src/triage/lifecycleSuggest.js';
import { computeRisk } from '../src/triage/risk.js';
import { findSimilar, isRecurring, toVector } from '../src/triage/similarity.js';
import { runSweeps } from '../src/workflow/ticker.js';
import { auth, complaint, fakeAi, makeTestApp, T0, type TestApp } from './helpers.js';

describe('computeRisk', () => {
  it('STORAGE_ENVIRONMENT, hits 2, sensor 0.5, related 1 -> 0.5233 MEDIUM with 6 factors summing to score', () => {
    const r = computeRisk({ category: 'STORAGE_ENVIRONMENT', severityHits: 2, sensorExcursionFraction: 0.5, recentRelatedCount: 1, assetOverdue: false, quantityMismatch: false });
    expect(r.score).toBeCloseTo(0.5233, 4);
    expect(r.level).toBe('MEDIUM');
    expect(r.factors).toHaveLength(6);
    expect(r.factors.reduce((s, f) => s + f.contribution, 0)).toBeCloseTo(r.score, 3);
  });

  it('saturates severity at 3', () => {
    const base = { category: 'CONDUCT_PROCESS_GRIEVANCE' as const, sensorExcursionFraction: 0, recentRelatedCount: 0, assetOverdue: false, quantityMismatch: false };
    expect(computeRisk({ ...base, severityHits: 9 }).score).toBe(computeRisk({ ...base, severityHits: 3 }).score);
  });
});

let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let comp: U, so: U;

beforeAll(async () => {
  t = await makeTestApp();
  comp = await t.user({ username: 'comp1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  so = await t.user({ username: 'safety1', role: 'SAFETY_OFFICER', unit: 'U5' });
  await t.user({ username: 'system', role: 'SYSTEM', unit: 'U6' });
  const q = (sql: string, args: unknown[] = []) => t.deps.pool.query(sql, args);
  await q(`insert into depots values ('DEP-02','Depot 2')`);
  await q(`insert into locations values ('DEP-02/MAG-01/BAY-04','DEP-02',5,30,70), ('DEP-02/MAG-02/BAY-01','DEP-02',5,30,70)`);
  await q(`insert into assets values ('LOT-B03-2025-0117','ITEM-TYPE-01',100,'2020-01-01',24,'DEP-02/MAG-01/BAY-04','IN_STORE')`);
  for (const [id, type, days] of [['EVT-000001', 'ISSUE', -3], ['EVT-000002', 'RECONCILIATION', -5], ['EVT-000003', 'RECEIPT', -20]] as const) {
    await q(`insert into lifecycle_events(id, asset_id, event_type, quantity, actor_pseudo, actor_unit, occurred_at, payload)
             values ($1,'LOT-B03-2025-0117',$2,10,'PER-101','U1',$3,$4)`,
      [id, type, new Date(Date.parse(complaint.occurredAt) + days * 864e5), JSON.stringify(type === 'RECONCILIATION' ? { discrepancy: -4 } : {})]);
  }
  // 84 of the 168 hours before the incident were out of bounds (RH 85 > 70).
  for (let h = 0; h < 168; h++) {
    await q('insert into sensor_readings values ($1,$2,$3,$4)', ['DEP-02/MAG-01/BAY-04', new Date(Date.parse(complaint.occurredAt) - h * 3600e3), 20, h < 84 ? 85 : 50]);
  }
});
afterAll(() => t.stop());

const create = async (body: object = complaint) =>
  (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(await t.token(comp.id)), payload: body })).json().caseId as string;

const setEmbedding = (caseId: string, v: number[]) =>
  t.deps.pool.query(`insert into case_ai(case_id, result_sha256, embedding) values ($1,'x',$2::vector)
                     on conflict (case_id) do update set embedding = excluded.embedding`, [caseId, toVector(v)]);

const unit = (cos: number) => { const v = new Array(384).fill(0); v[0] = cos; v[1] = Math.sqrt(1 - cos * cos); return v; };

describe('similarity', () => {
  it('orders DUPLICATE then RELATED and drops dissimilar', async () => {
    t.clock.set(T0);
    const a = await create();
    t.clock.set(new Date(T0.getTime() + 4 * 864e5));
    const dup = await create();
    const rel = await create({ ...complaint, assetRefs: ['LOT-A01-2025-0001'], locationRef: 'DEP-02/MAG-02/BAY-01' });
    const far = await create({ ...complaint, assetRefs: [], locationRef: 'DEP-02/MAG-02/BAY-01' });
    await setEmbedding(a, unit(1));
    await setEmbedding(dup, unit(0.95));
    await setEmbedding(rel, unit(0.8));
    await setEmbedding(far, unit(0.5));
    const s = await findSimilar(t.deps, a);
    expect(s.map((x) => [x.caseId, x.linkType])).toEqual([[dup, 'DUPLICATE'], [rel, 'RELATED']]);
    expect(s[0].reasons).toEqual(expect.arrayContaining(['same lot LOT-B03-2025-0117', 'filed 4 days apart']));
  });

  it('three RELATED on the same location within 90 days -> recurring', async () => {
    const ids = [await create(), await create(), await create(), await create()];
    for (const o of ids.slice(1)) {
      await t.deps.pool.query(`insert into case_links(case_id, linked_case_id, link_type) values ($1,$2,'RELATED')`, [ids[0], o]);
    }
    expect(await isRecurring(t.deps, ids[0])).toBe(true);
    expect(await isRecurring(t.deps, ids[1])).toBe(false);
  });
});

describe('triage job', () => {
  it('moves case to TRIAGED with aiResultHash equal to case_ai.result_sha256 and explainable risk', async () => {
    t.clock.set(T0);
    const id = await create();
    await runTriage(t.deps, id);
    const { rows } = await t.deps.pool.query('select c.status, c.triage_status, c.ledger_json, a.result_sha256, a.risk_explanation from cases c join case_ai a using (case_id) where case_id = $1', [id]);
    expect(rows[0]).toMatchObject({ status: 'TRIAGED', triage_status: 'DONE' });
    expect(rows[0].ledger_json.aiResultHash).toBe(rows[0].result_sha256);
    const factors = Object.fromEntries(rows[0].risk_explanation.factors.map((f: any) => [f.name, f.value]));
    expect(factors).toMatchObject({ sensor_excursion: 0.5, asset_overdue: 1, quantity_mismatch: 1 });
    const ai = await t.app.inject({ url: `/api/v1/cases/${id}/ai`, headers: auth(await t.token(so.id)) });
    expect(ai.json().risk_explanation.topKeywords).toEqual(['humidity', 'damp']);
  });

  it('AI down -> stays SUBMITTED, FAILED, attempt 1; ticker retries and succeeds', async () => {
    t.clock.set(T0);
    const id = await create();
    fakeAi.fail = true;
    await runTriage(t.deps, id);
    let row = (await t.deps.pool.query('select status, triage_status, triage_attempts from cases where case_id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'SUBMITTED', triage_status: 'FAILED', triage_attempts: 1 });
    fakeAi.fail = false;
    t.clock.set(new Date(T0.getTime() + 5 * 60e3));
    await runSweeps(t.deps, (c) => runTriage(t.deps, c));
    row = (await t.deps.pool.query('select status, triage_status, triage_attempts from cases where case_id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'TRIAGED', triage_status: 'DONE', triage_attempts: 2 });
  });

  it('lifecycle suggestions rank RECONCILIATION first for INVENTORY_DISCREPANCY', async () => {
    const id = await create();
    await t.deps.pool.query(`update cases set category = 'INVENTORY_DISCREPANCY' where case_id = $1`, [id]);
    const s = await suggestLifecycleEvents(t.deps, id);
    expect(s.map((e) => e.eventType)).toEqual(['RECONCILIATION', 'ISSUE', 'RECEIPT']);
  });
});
