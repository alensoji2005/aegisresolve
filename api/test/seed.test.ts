import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDomain } from '../src/seed/domain.js';
import { seed } from '../src/seed/index.js';
import { mulberry32 } from '../src/seed/prng.js';
import { makeTestApp, T0, type TestApp } from './helpers.js';

let t: TestApp;
let credPath: string;
beforeAll(async () => {
  t = await makeTestApp();
  credPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'aegis-')), 'credentials.local.json');
});
afterAll(() => t.stop());

describe('seed', () => {
  it('seeds 14 users and every event lands on the ledger', async () => {
    const r = await seed(t.deps, credPath);
    expect(r.status).toBe('seeded');
    expect(r.users).toBe(14);
    expect(JSON.parse(await readFile(credPath, 'utf8'))).toHaveLength(14);
    const { rows } = await t.deps.pool.query('select count(*)::int as n, count(ledger_tx_id)::int as anchored from lifecycle_events');
    expect(rows[0]).toEqual({ n: r.events, anchored: r.events });
  }, 120_000);

  it('second run reports already seeded', async () => {
    expect((await seed(t.deps, credPath)).status).toBe('already seeded');
  });

  it('DEP-02/MAG-01/BAY-02 has exactly 48 humidity excursion readings', async () => {
    const { rows } = await t.deps.pool.query(`select count(*)::int as n from sensor_readings where location_id = 'DEP-02/MAG-01/BAY-02' and rh_pct > 70`);
    expect(rows[0].n).toBe(48);
  });

  it('is deterministic for seed 42', () => {
    const a = buildDomain(mulberry32(42), T0).events.map((e) => [e.id, e.asset]);
    const b = buildDomain(mulberry32(42), T0).events.map((e) => [e.id, e.asset]);
    expect(a).toEqual(b);
  });
});
