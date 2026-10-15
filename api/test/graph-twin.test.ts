import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../src/seed/index.js';
import { fillSensorReadings } from '../src/twin/service.js';
import { auth, complaint, makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let tok: Record<string, string>;
let caseA: string;

beforeAll(async () => {
  t = await makeTestApp();
  t.clock.set(new Date());
  await seed(t.deps, path.join(await mkdtemp(path.join(os.tmpdir(), 'aegis-')), 'c.json'));
  const ids = Object.fromEntries((await t.deps.pool.query('select username, id from users')).rows.map((r) => [r.username, r.id]));
  tok = Object.fromEntries(await Promise.all(['comp2', 'safety1', 'store1', 'store2', 'audit1'].map(async (u) => [u, await t.token(ids[u])])));
  const occurredAt = new Date(Date.now() - 2 * 864e5).toISOString();
  for (let i = 0; i < 2; i++) {
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(tok.comp2), payload: { ...complaint, occurredAt } });
    caseA ??= r.json().caseId;
  }
}, 180_000);
afterAll(() => t.stop());

const get = (who: string, url: string) => t.app.inject({ url: `/api/v1${url}`, headers: auth(tok[who]) });

describe('knowledge graph', () => {
  it('expands a case to its lot, location and the lot\'s events', async () => {
    const g = (await get('safety1', `/graph?center=case:${caseA}&depth=2`)).json();
    const ids = g.nodes.map((n: any) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['lot:LOT-B03-2025-0117', 'loc:DEP-02/MAG-01/BAY-04']));
    expect(g.nodes.some((n: any) => n.type === 'event' && n.data.asset === 'LOT-B03-2025-0117')).toBe(true);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.nodes.every((n: any) => !('description' in n.data) && !('title' in n.data))).toBe(true);
  });

  it('finds the lot with repeated complaints', async () => {
    const i = (await get('audit1', '/graph/insights')).json();
    expect(i.lotsWithRepeatedComplaints).toEqual(expect.arrayContaining([{ lot: 'LOT-B03-2025-0117', cases: 2 }]));
  });

  it('rejects complainants and malformed centers', async () => {
    expect((await get('comp2', `/graph?center=case:${caseA}`)).statusCode).toBe(403);
    expect((await get('safety1', '/graph?center=drop table')).statusCode).toBe(400);
  });
});

describe('digital twin', () => {
  it('shows the seeded humidity excursion and open cases per bay', async () => {
    const twin = (await get('safety1', '/twin')).json();
    expect(twin.map((d: any) => d.id)).toEqual(['DEP-01', 'DEP-02']);
    const bay = twin[1].magazines[0].bays.find((b: any) => b.id === 'DEP-02/MAG-01/BAY-04');
    expect(bay).toMatchObject({ excursionHours7d: 48, openCases: 2 });
    expect(bay.lots).toBeGreaterThan(0);
  });

  it('scopes store officers to their own depot', async () => {
    expect((await get('store1', '/twin')).json().map((d: any) => d.id)).toEqual(['DEP-01']);
    expect((await get('store1', '/twin/location?id=DEP-02/MAG-01/BAY-04')).statusCode).toBe(403);
    expect((await get('store2', '/twin/location?id=DEP-02/MAG-01/BAY-04')).statusCode).toBe(200);
  });

  it('location detail has 7 days of readings and the open cases', async () => {
    const d = (await get('safety1', '/twin/location?id=DEP-02/MAG-01/BAY-04')).json();
    expect(d.readings.length).toBeGreaterThanOrEqual(160);
    expect(d.readings.filter((r: any) => r.outOfBounds)).toHaveLength(48);
    expect(d.cases.map((c: any) => c.caseId)).toContain(caseA);
  });

  it('sensor simulator fills missing hours once', async () => {
    t.clock.set(new Date(Date.now() + 3 * 3600e3));
    // seed stops at the hour before seeding, so the current hour + 3 more are filled
    expect(await fillSensorReadings(t.deps)).toBe(16 * 4);
    expect(await fillSensorReadings(t.deps)).toBe(0);
  });
});
