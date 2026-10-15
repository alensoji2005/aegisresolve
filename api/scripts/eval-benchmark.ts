/**
 * Objective 12 (blockchain performance): latency and throughput of ledger writes and reads.
 *
 * Writes = complaint:registerCase (endorse + order + commit on Fabric). Reads = complaint:getCase.
 * Usage:  pnpm --filter @aegis/api eval:bench               # in-process ledger and centralised DB baseline
 *         pnpm --filter @aegis/api eval:bench -- --fabric   # plus the running Fabric network from .env (uses seeded comp2/audit1)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { startEmbeddedDb } from '../src/embeddedDb.js';
import { FakeLedger } from '../src/ledger/fakeLedger.js';
import type { Ledger, LedgerUser } from '../src/ledger/ledger.js';
import { FabricLedger } from '../src/ledger/fabricLedger.js';
import { PostgresLedger } from '../src/ledger/postgresLedger.js';
import { migrate } from '../src/migrate.js';
import { loadLedgerUser } from '../src/users/service.js';

const RESULTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../eval/results');
const WRITES_PER_LEVEL = Number(process.env.BENCH_WRITES ?? 100);
const READS = Number(process.env.BENCH_READS ?? 200);
const LEVELS = [1, 10, 25];

interface Row { ledger: string; op: string; concurrency: number; n: number; errors: number; tps: number; meanMs: number; p50Ms: number; p95Ms: number }

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;
const r1 = (x: number) => Math.round(x * 10) / 10;

async function measure(label: string, op: string, concurrency: number, n: number, task: (i: number) => Promise<unknown>): Promise<Row> {
  const lat: number[] = [];
  let errors = 0;
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < n) {
      const i = next++;
      const t = performance.now();
      try { await task(i); lat.push(performance.now() - t); } catch { errors++; }
    }
  }));
  const wall = (performance.now() - start) / 1000;
  lat.sort((a, b) => a - b);
  return { ledger: label, op, concurrency, n, errors, tps: r1(lat.length / wall), meanMs: r1(lat.reduce((s, x) => s + x, 0) / (lat.length || 1)),
    p50Ms: r1(pct(lat, 50)), p95Ms: r1(pct(lat, 95)) };
}

async function bench(label: string, ledger: Ledger, writer: LedgerUser, reader: LedgerUser): Promise<Row[]> {
  const rows: Row[] = [];
  let seq = Math.floor(Math.random() * 800000);
  const ids: string[] = [];
  for (const c of LEVELS) {
    rows.push(await measure(label, 'write registerCase', c, WRITES_PER_LEVEL, async () => {
      const id = `CASE-2099-${String(++seq).padStart(6, '0')}`;
      await ledger.submit(writer, 'complaint:registerCase', [id, 'PSN-0123456789ab', 'a'.repeat(64), '[]', 'DEP-01/MAG-01/BAY-01']);
      ids.push(id);
    }));
    console.log(rows.at(-1));
  }
  rows.push(await measure(label, 'read getCase', 10, READS, (i) => ledger.evaluate(reader, 'complaint:getCase', [ids[i % ids.length]])));
  console.log(rows.at(-1));
  return rows;
}

const synthetic = (role: LedgerUser['role']): LedgerUser => ({ userId: role.toLowerCase(), role, unit: 'U1', depot: 'DEP-01', pseudo: 'PER-001' });
const all: Row[] = [];

all.push(...await bench('In-process ledger (no network)', new FakeLedger(() => new Date()), synthetic('COMPLAINANT'), synthetic('AUDITOR')));
{
  const db = await startEmbeddedDb();
  const pool = createPool(db.url);
  pool.options.max = 1;
  await migrate(pool);
  all.push(...await bench('Centralised DB (embedded Postgres)', new PostgresLedger(pool, () => new Date()), synthetic('COMPLAINANT'), synthetic('AUDITOR')));
  await pool.end();
  await db.stop();
}
if (process.argv.includes('--fabric')) {
  const cfg = loadConfig();
  const pool = createPool(cfg.DATABASE_URL);
  const deps = { cfg, pool } as AppDeps;
  const id = async (u: string) => (await pool.query('select id from users where username = $1', [u])).rows[0].id;
  const ledger = new FabricLedger(cfg);
  all.push(...await bench('Hyperledger Fabric 2 orgs (Raft, 1 orderer)', ledger, await loadLedgerUser(deps, await id('comp2')), await loadLedgerUser(deps, await id('audit1'))));
  ledger.close();
  await pool.end();
}

const md = [
  '# Ledger performance',
  '',
  `Generated ${new Date().toISOString()} by \`pnpm --filter @aegis/api eval:bench\`. ${WRITES_PER_LEVEL} writes per concurrency level, ${READS} reads.`,
  'Writes are `complaint:registerCase`; on Fabric each write is endorsed by both organisations, ordered and committed before it returns.',
  '',
  '| Ledger | Operation | Concurrency | Throughput (tx/s) | Mean (ms) | p50 (ms) | p95 (ms) | Errors |',
  '|---|---|---|---|---|---|---|---|',
  ...all.map((r) => `| ${r.ledger} | ${r.op} | ${r.concurrency} | ${r.tps} | ${r.meanMs} | ${r.p50Ms} | ${r.p95Ms} | ${r.errors} |`),
  '',
  'Machine-dependent: quote these together with the hardware (e.g. GitHub Codespace, 4 cores / 16 GB).',
];
await mkdir(RESULTS, { recursive: true });
await writeFile(path.join(RESULTS, 'benchmark.md'), md.join('\n') + '\n');
await writeFile(path.join(RESULTS, 'benchmark.csv'),
  ['ledger,op,concurrency,n,errors,tps,mean_ms,p50_ms,p95_ms', ...all.map((r) => [JSON.stringify(r.ledger), r.op, r.concurrency, r.n, r.errors, r.tps, r.meanMs, r.p50Ms, r.p95Ms].join(','))].join('\n') + '\n');
console.log(md.join('\n'));
process.exit(0);
