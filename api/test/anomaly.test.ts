import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureRows, runAnomalyScan } from '../src/anomaly/service.js';
import { isPlanted } from '../src/seed/domain.js';
import { seed } from '../src/seed/index.js';
import { auth, complaint, makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let seededAt: Date;
let tok: Record<string, string>;

beforeAll(async () => {
  t = await makeTestApp();
  seededAt = new Date();
  t.clock.set(seededAt);
  await seed(t.deps, path.join(await mkdtemp(path.join(os.tmpdir(), 'aegis-')), 'c.json'));
  const ids = Object.fromEntries((await t.deps.pool.query('select username, id from users')).rows.map((r) => [r.username, r.id]));
  tok = Object.fromEntries(await Promise.all(['comp2', 'safety1', 'audit1', 'inv1'].map(async (u) => [u, await t.token(ids[u])])));
}, 180_000);
afterAll(() => t.stop());

describe('anomaly detection', () => {
  it('builds daily feature rows for all three families', async () => {
    const access = await featureRows(t.deps, 'access');
    expect(access.find((r) => r.subject === 'inv2' && r.features.evidence_downloads === 14)).toBeTruthy();
    const life = await featureRows(t.deps, 'lifecycle');
    expect(life.find((r) => r.subject === 'PER-107' && r.features.off_hours_ratio === 1)).toBeTruthy();
    expect((await featureRows(t.deps, 'sensor')).some((r) => r.features.out_of_bounds_hours > 0)).toBe(true);
  });

  it('scan finds each planted anomaly with an explanation, and nothing it cannot explain', async () => {
    await runAnomalyScan(t.deps);
    const { rows } = await t.deps.pool.query(`select family, subject, to_char(day, 'YYYY-MM-DD') as day, explanation from anomalies`);
    for (const family of ['access', 'lifecycle', 'sensor']) {
      expect(rows.some((a) => a.family === family && isPlanted(a, seededAt)), `planted ${family} anomaly not found`).toBe(true);
    }
    expect(rows.every((a) => a.explanation.length > 0)).toBe(true);
    const burst = rows.find((a) => a.family === 'access' && a.subject === 'inv2');
    expect(burst.explanation.map((e: any) => e.feature)).toContain('evidence_downloads');
  });

  it('rescanning is idempotent', async () => {
    const before = (await t.deps.pool.query('select count(*)::int as n from anomalies')).rows[0].n;
    await runAnomalyScan(t.deps);
    expect((await t.deps.pool.query('select count(*)::int as n from anomalies')).rows[0].n).toBe(before);
  });

  it('lists anomalies for oversight roles only; scan is restricted', async () => {
    const list = await t.app.inject({ url: '/api/v1/anomalies?family=access', headers: auth(tok.audit1) });
    expect(list.json()[0]).toMatchObject({ family: 'access', subject: 'inv2' });
    expect((await t.app.inject({ url: '/api/v1/anomalies', headers: auth(tok.comp2) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/anomalies/scan', headers: auth(tok.inv1) })).statusCode).toBe(403);
  });

  it('a full case view is recorded in access_events for future scans', async () => {
    const id = (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(tok.comp2), payload: complaint })).json().caseId;
    await t.app.inject({ url: `/api/v1/cases/${id}`, headers: auth(tok.safety1) });
    const { rows } = await t.deps.pool.query(`select action, ledger_tx_id from access_events where resource = $1`, [id]);
    expect(rows).toEqual([{ action: 'FULL', ledger_tx_id: expect.stringMatching(/^tx-/) }]);
  });
});
