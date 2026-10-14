import { buildApp, type AppDeps } from './app.js';
import { S3BlobStore } from './blob.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import type { Ledger } from './ledger/ledger.js';
import { migrate } from './migrate.js';
import { HttpAiClient } from './triage/aiClient.js';
import { runTriage } from './triage/job.js';
import { startTicker } from './workflow/ticker.js';

async function main() {
  const cfg = loadConfig();
  const pool = createPool(cfg.DATABASE_URL);
  await migrate(pool);
  let ledger: Ledger;
  if (cfg.LEDGER_MODE === 'fabric') {
    const { FabricLedger } = await import('./ledger/fabricLedger.js');
    ledger = new FabricLedger(cfg);
  } else {
    const { FakeLedger } = await import('./ledger/fakeLedger.js');
    ledger = new FakeLedger(() => new Date());
    console.warn('LEDGER_MODE=fake: in-memory ledger, state is lost on restart');
  }
  const deps: AppDeps = { cfg, pool, ledger, blobs: new S3BlobStore(cfg), ai: new HttpAiClient(cfg), now: () => new Date() };
  const triage = (caseId: string) => runTriage(deps, caseId);
  deps.onCaseCreated = (caseId) => void triage(caseId);
  const app = buildApp(deps);
  const stopTicker = startTicker(deps, triage);
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  const shutdown = async () => {
    stopTicker();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
