import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppDeps } from '../app.js';
import { MemoryBlobStore } from '../blob.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { makeLedger } from '../ledger/index.js';
import { migrate } from '../migrate.js';
import { HttpAiClient } from '../triage/aiClient.js';
import { seedDomain } from './domain.js';
import { mulberry32 } from './prng.js';
import { seedUsers } from './users.js';

export const CREDENTIALS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../seed/credentials.local.json');

/** Idempotent: does nothing when the system user already exists. */
export async function seed(deps: AppDeps, credentialsPath = CREDENTIALS_PATH): Promise<{ status: 'seeded' | 'already seeded'; users: number; events: number }> {
  const { rows } = await deps.pool.query(`select 1 from users where username = 'system'`);
  if (rows.length) return { status: 'already seeded', users: 0, events: 0 };
  const creds = await seedUsers(deps);
  // Written before the slow ledger replay so a later failure does not lose the only copy of the passwords.
  await mkdir(path.dirname(credentialsPath), { recursive: true });
  await writeFile(credentialsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  const { events } = await seedDomain(deps, mulberry32(42));
  return { status: 'seeded', users: creds.length, events };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const cfg = loadConfig();
    const pool = createPool(cfg.DATABASE_URL);
    await migrate(pool);
    const deps: AppDeps = { cfg, pool, ledger: await makeLedger(cfg, pool), blobs: new MemoryBlobStore(), ai: new HttpAiClient(cfg), now: () => new Date() };
    const r = await seed(deps);
    console.log(r.status === 'seeded' ? `seeded ${r.users} users, ${r.events} lifecycle events; credentials in ${CREDENTIALS_PATH}` : r.status);
    await pool.end();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
