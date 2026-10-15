import { runAnomalyScan } from './anomaly/service.js';
import { buildApp, type AppDeps } from './app.js';
import { type BlobStore, FsBlobStore, MemoryBlobStore, S3BlobStore } from './blob.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { makeLedger } from './ledger/index.js';
import { migrate } from './migrate.js';
import { CREDENTIALS_PATH, seed } from './seed/index.js';
import { HttpAiClient } from './triage/aiClient.js';
import { runTriage } from './triage/job.js';
import { fillSensorReadings } from './twin/service.js';
import { runSweeps, startTicker, throttled } from './workflow/ticker.js';

/**
 * OFFLINE=1 runs a self-contained demo without Docker or Fabric: embedded Postgres, in-memory ledger and blobs,
 * seeded on start. Everything is lost when the process exits.
 */
async function main() {
  const offline = process.env.OFFLINE === '1';
  let stopDb = async () => {};
  if (offline) {
    const { startEmbeddedDb } = await import('./embeddedDb.js');
    const db = await startEmbeddedDb();
    process.env.DATABASE_URL = db.url;
    process.env.LEDGER_MODE = 'fake';
    stopDb = db.stop;
  }
  const cfg = loadConfig();
  const pool = createPool(cfg.DATABASE_URL);
  if (offline) pool.options.max = 1;
  await migrate(pool);
  const blobs: BlobStore = offline ? new MemoryBlobStore() : cfg.BLOB_DIR ? new FsBlobStore(cfg.BLOB_DIR) : new S3BlobStore(cfg);
  const deps: AppDeps = { cfg, pool, ledger: await makeLedger(cfg, pool), blobs, ai: new HttpAiClient(cfg), now: () => new Date() };
  if (offline) {
    const r = await seed(deps);
    console.log(`offline demo: ${r.status}; credentials in ${CREDENTIALS_PATH}`);
  }
  const triage = (caseId: string) => runTriage(deps, caseId);
  deps.onCaseCreated = (caseId) => void triage(caseId);
  const app = buildApp(deps);
  const stopTicker = startTicker({
    sla: () => runSweeps(deps, triage),
    sensors: () => fillSensorReadings(deps),
    anomalies: throttled(60, () => runAnomalyScan(deps)),
  });
  await app.listen({ port: cfg.PORT, host: '127.0.0.1' });
  const shutdown = async () => {
    stopTicker();
    await app.close();
    await pool.end();
    await stopDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
