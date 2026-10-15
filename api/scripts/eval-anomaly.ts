/**
 * Objective 10/12: does the Isolation Forest find the anomalies the seed planted, and how many false alarms does it raise?
 * Runs in-process (embedded Postgres + in-memory ledger + fresh seed) against the real AI service from .env.
 * Usage: start the AI service, then  pnpm --filter @aegis/api eval:anomaly
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnomalyScan } from '../src/anomaly/service.js';
import type { AppDeps } from '../src/app.js';
import { MemoryBlobStore } from '../src/blob.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { startEmbeddedDb } from '../src/embeddedDb.js';
import { FakeLedger } from '../src/ledger/fakeLedger.js';
import { migrate } from '../src/migrate.js';
import { isPlanted, PLANTED } from '../src/seed/domain.js';
import { seed } from '../src/seed/index.js';
import { HttpAiClient } from '../src/triage/aiClient.js';

const RESULTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../eval/results');
const env = loadConfig({ ...process.env, DATABASE_URL: 'postgres://unused@localhost/x' });
const db = await startEmbeddedDb();
const pool = createPool(db.url);
pool.options.max = 1;
await migrate(pool);
const seededAt = new Date();
const cfg = loadConfig({ ...process.env, DATABASE_URL: db.url, LEDGER_MODE: 'fake' });
const deps: AppDeps = { cfg, pool, ledger: new FakeLedger(() => seededAt), blobs: new MemoryBlobStore(), ai: new HttpAiClient(env), now: () => seededAt };
await seed(deps, path.join(await mkdtemp(path.join(os.tmpdir(), 'aegis-')), 'c.json'));
const counts = await runAnomalyScan(deps);
const { rows } = await pool.query(`select family, subject, to_char(day, 'YYYY-MM-DD') as day, score, explanation from anomalies order by score desc`);
await pool.end();
await db.stop();

const flagged = rows.map((r) => ({ ...r, planted: isPlanted(r, seededAt) }));
const atK = (k: number) => flagged.slice(0, k).filter((r) => r.planted).length / Math.max(Math.min(k, flagged.length), 1);
const found = (family: string) => flagged.some((r) => r.family === family && r.planted);
const fmtWhy = (e: any[]) => e.map((x) => `${x.feature} ${x.value} vs ${x.baseline} (z ${x.z})`).join('; ');
const md = [
  '# Anomaly detection', '',
  `Generated ${new Date().toISOString()} by \`pnpm --filter @aegis/api eval:anomaly\` (Isolation Forest, contamination 0.02, explanations = features with |z| ≥ 2).`, '',
  '| Planted anomaly | Family | Found |', '|---|---|---|',
  `| ${PLANTED.access.what} (${PLANTED.access.subject}) | access | ${found('access') ? '✅' : '❌'} |`,
  `| ${PLANTED.lifecycle.what} (${PLANTED.lifecycle.subject}) | lifecycle | ${found('lifecycle') ? '✅' : '❌'} |`,
  `| ${PLANTED.sensor.what} | sensor | ${found('sensor') ? '✅' : '❌'} |`, '',
  `Flagged in total: ${flagged.length} (lifecycle ${counts.lifecycle}, access ${counts.access}, sensor ${counts.sensor}). `
    + `Planted among them: ${flagged.filter((r) => r.planted).length}. Precision@5: ${atK(5).toFixed(2)}, precision@10: ${atK(10).toFixed(2)}.`, '',
  'Flags that are not planted are not necessarily wrong: the synthetic data has natural variation (e.g. busy reconciliation days).', '',
  '## Top 10 flags', '', '| # | Family | Subject | Day | Score | Planted | Why |', '|---|---|---|---|---|---|---|',
  ...flagged.slice(0, 10).map((r, i) => `| ${i + 1} | ${r.family} | ${r.subject} | ${r.day} | ${Number(r.score).toFixed(3)} | ${r.planted ? 'yes' : ''} | ${fmtWhy(r.explanation)} |`),
];
await mkdir(RESULTS, { recursive: true });
await writeFile(path.join(RESULTS, 'anomaly.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
process.exit(0);
