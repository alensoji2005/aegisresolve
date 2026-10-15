/**
 * Objective 13: blockchain vs centralised database under insider tampering.
 *
 * The insider has full access to the application database and the evidence store, and knows the encryption key.
 * Each attack also "covers its tracks" in every store the insider controls. With LEDGER_MODE=postgres that includes the
 * ledger tables; with a blockchain the ledger is held by peers of other organisations, so it cannot be rewritten.
 * Detection uses the system's own audit endpoints (reconcile + verify-evidence).
 *
 * Usage:  pnpm --filter @aegis/api eval:tamper            # simulated ledger vs central DB (no Docker needed)
 *         pnpm --filter @aegis/api eval:tamper -- --fabric # also the running Fabric stack from .env (creates fresh demo cases)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { type AppDeps, buildApp } from '../src/app.js';
import { signToken } from '../src/auth/tokens.js';
import { MemoryBlobStore } from '../src/blob.js';
import { contentHashOf } from '../src/cases/service.js';
import { loadConfig } from '../src/config.js';
import { seal, sealString, sha256Hex, sha3Hex } from '../src/crypto.js';
import { createPool } from '../src/db.js';
import { startEmbeddedDb } from '../src/embeddedDb.js';
import { FakeLedger } from '../src/ledger/fakeLedger.js';
import { makeLedger } from '../src/ledger/index.js';
import { centralKey, PostgresLedger } from '../src/ledger/postgresLedger.js';
import { migrate } from '../src/migrate.js';
import { createUser } from '../src/users/service.js';

const RESULTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../eval/results');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ATTACKS = ['status', 'investigator', 'content', 'evidence'] as const;
type Attack = (typeof ATTACKS)[number];
const LABEL: Record<Attack, string> = {
  status: 'Close a case by editing its status',
  investigator: 'Reassign the investigator',
  content: 'Rewrite the complaint text (re-encrypted, hash updated)',
  evidence: 'Swap an evidence file (re-encrypted, hashes updated)',
};

interface ModeResult { mode: string; ledger: string; detected: Record<Attack, string | null>; baselineClean: boolean }

async function editCentral(pool: pg.Pool, type: string, parts: string[], mutate: (v: any) => void) {
  const k = centralKey(type, parts);
  const { rows } = await pool.query('select value from central_state where key = $1', [k]);
  const v = JSON.parse(Buffer.from(rows[0].value).toString('utf8'));
  mutate(v);
  await pool.query('update central_state set value = $2 where key = $1', [k, Buffer.from(JSON.stringify(v))]);
}

async function run(mode: string, ledgerLabel: string, deps: AppDeps, ids: { comp: string; audit: string; target: string }, centralDb: boolean): Promise<ModeResult> {
  const app = buildApp(deps, { logger: false });
  await app.ready();
  const tok = (id: string) => signToken(deps.cfg, id, 'access', deps.now()).then((t) => ({ authorization: `Bearer ${t}` }));
  const cases: string[] = [];
  for (const _ of ATTACKS) {
    const r = await app.inject({ method: 'POST', url: '/api/v1/cases', headers: await tok(ids.comp), payload: {
      title: 'Tamper evaluation case', description: 'Synthetic complaint created by the tamper evaluation script for comparison.',
      assetRefs: [], locationRef: 'DEP-01/MAG-01/BAY-01', occurredAt: new Date(deps.now().getTime() - 3600e3).toISOString() } });
    if (r.statusCode !== 201) throw new Error(`create case failed: ${r.statusCode} ${r.body}`);
    cases.push(r.json().caseId);
  }
  const b = '----eval';
  const up = await app.inject({ method: 'POST', url: `/api/v1/cases/${cases[3]}/evidence`, headers: { ...(await tok(ids.comp)), 'content-type': `multipart/form-data; boundary=${b}` },
    payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`)]) });
  if (up.statusCode !== 201) throw new Error(`upload failed: ${up.statusCode} ${up.body}`);
  const eid: string = up.json().id;

  const audit = async () => {
    const h = await tok(ids.audit);
    const rec = (await app.inject({ url: '/api/v1/audit/reconcile', headers: h })).json();
    const ev = (await app.inject({ method: 'POST', url: '/api/v1/audit/verify-evidence', headers: h })).json();
    return { mismatches: rec.mismatches as { caseId: string; field: string }[], failures: ev.failures as { evidenceId: string }[] };
  };
  const before = await audit();
  const baselineClean = !before.mismatches.some((m) => cases.includes(m.caseId)) && !before.failures.some((f) => f.evidenceId === eid);

  const q = (sql: string, p: unknown[]) => deps.pool.query(sql, p);
  const kek = deps.cfg.AEGIS_KEK;
  const targetFabricId = (await q('select fabric_identity from users where id = $1', [ids.target])).rows[0].fabric_identity;
  // 1. status
  await q(`update cases set status = 'CLOSED_FINAL', ledger_json = jsonb_set(ledger_json, '{status}', '"CLOSED_FINAL"') where case_id = $1`, [cases[0]]);
  if (centralDb) await editCentral(deps.pool, 'CASE', [cases[0]], (v) => { v.status = 'CLOSED_FINAL'; });
  // 2. investigator
  await q('update cases set investigator_user_id = $2 where case_id = $1', [cases[1], ids.target]);
  if (centralDb) await editCentral(deps.pool, 'CASE', [cases[1]], (v) => { v.investigator = { id: targetFabricId, unit: 'U4', depot: 'NONE', pseudo: 'PER-999' }; });
  // 3. content
  const title = 'Tamper evaluation case';
  const description = 'Nothing happened; this complaint was withdrawn by the complainant.';
  await q('update case_content set title_enc = $2, description_enc = $3, content_sha256 = $4 where case_id = $1',
    [cases[2], sealString(title, kek), sealString(description, kek), contentHashOf(title, description)]);
  if (centralDb) await editCentral(deps.pool, 'CASE', [cases[2]], (v) => { v.contentHash = contentHashOf(title, description); });
  // 4. evidence
  const fake = Buffer.concat([PNG, Buffer.from('forged')]);
  const s = seal(fake, kek);
  const row = (await q('select object_key from evidence where id = $1', [eid])).rows[0];
  await deps.blobs.put(row.object_key, s.ciphertext);
  await q(`update evidence set sha256_plain = $2, sha3_plain = $3, sha256_cipher = $4, dek_wrapped = $5, iv = $6, auth_tag = $7, size_bytes = $8 where id = $1`,
    [eid, sha256Hex(fake), sha3Hex(fake), sha256Hex(s.ciphertext), s.dekWrapped, s.iv, s.authTag, fake.length]);
  if (centralDb) {
    await editCentral(deps.pool, 'EVID', [eid], (v) => {
      Object.assign(v, { sha256Plain: sha256Hex(fake), sha3Plain: sha3Hex(fake), sha256Cipher: sha256Hex(s.ciphertext), sizeBytes: fake.length });
    });
  }

  const after = await audit();
  const detected = {} as Record<Attack, string | null>;
  ATTACKS.forEach((a, i) => {
    const m = after.mismatches.find((x) => x.caseId === cases[i]);
    const f = a === 'evidence' ? after.failures.find((x) => x.evidenceId === eid) : undefined;
    detected[a] = m ? `reconcile: ${m.field}` : f ? 'verify-evidence' : null;
  });
  await app.close();
  return { mode, ledger: ledgerLabel, detected, baselineClean };
}

async function inProcessMode(mode: 'fake' | 'postgres'): Promise<ModeResult> {
  const db = await startEmbeddedDb();
  const pool = createPool(db.url);
  pool.options.max = 1;
  await migrate(pool);
  const k = (n: number) => Buffer.alloc(n, 7).toString('base64');
  const cfg = loadConfig({ DATABASE_URL: db.url, AEGIS_KEK: k(32), PSEUDONYM_SECRET: k(32), JWT_SECRET: k(64), WALLET_KEK: k(32), LEDGER_MODE: mode });
  const now = () => new Date();
  const ledger = mode === 'fake' ? new FakeLedger(now) : new PostgresLedger(pool, now);
  const deps: AppDeps = { cfg, pool, ledger, blobs: new MemoryBlobStore(), ai: { analyze: async () => { throw new Error('not used'); } } as any, now };
  const comp = await createUser(deps, { username: 'comp', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-01', totpConfirmed: true });
  const audit = await createUser(deps, { username: 'audit', role: 'AUDITOR', unit: 'U6', totpConfirmed: true });
  const target = await createUser(deps, { username: 'inv', role: 'INVESTIGATOR', unit: 'U4', totpConfirmed: true });
  try {
    return await run(mode, mode === 'fake' ? 'Independent ledger (simulated in-process)' : 'Centralised database (ledger tables in app DB)',
      deps, { comp: comp.id, audit: audit.id, target: target.id }, mode === 'postgres');
  } finally {
    await pool.end();
    await db.stop();
  }
}

async function fabricMode(): Promise<ModeResult> {
  const cfg = loadConfig();
  if (cfg.LEDGER_MODE !== 'fabric') throw new Error('--fabric needs LEDGER_MODE=fabric in .env');
  const pool = createPool(cfg.DATABASE_URL);
  const { FsBlobStore } = await import('../src/blob.js');
  const deps: AppDeps = { cfg, pool, ledger: await makeLedger(cfg, pool), blobs: new FsBlobStore(cfg.BLOB_DIR ?? '../data/blobs'),
    ai: { analyze: async () => { throw new Error('not used'); } } as any, now: () => new Date() };
  const id = async (u: string) => (await pool.query('select id from users where username = $1', [u])).rows[0]?.id;
  try {
    return await run('fabric', 'Hyperledger Fabric (2 orgs, live)', deps, { comp: await id('comp2'), audit: await id('audit1'), target: await id('inv2') }, false);
  } finally {
    await pool.end();
  }
}

const results: ModeResult[] = [await inProcessMode('fake'), await inProcessMode('postgres')];
if (process.argv.includes('--fabric')) results.push(await fabricMode());

const lines = [
  '# Tamper detection: blockchain vs centralised database',
  '',
  `Generated ${new Date().toISOString()} by \`pnpm --filter @aegis/api eval:tamper\`.`,
  '',
  'Insider model: full write access to the application database and evidence store, knows the encryption key, and covers tracks in every store they control.',
  'Detection uses the system\'s own audit endpoints (`/audit/reconcile`, `/audit/verify-evidence`).',
  '',
  `| Attack | ${results.map((r) => r.ledger).join(' | ')} |`,
  `|---|${results.map(() => '---').join('|')}|`,
  ...ATTACKS.map((a) => `| ${LABEL[a]} | ${results.map((r) => (r.detected[a] ? `✅ detected (${r.detected[a]})` : '❌ undetected')).join(' | ')} |`),
  `| **Detected** | ${results.map((r) => `**${ATTACKS.filter((a) => r.detected[a]).length}/${ATTACKS.length}**`).join(' | ')} |`,
  '',
  `Baseline before attacks was clean in every mode: ${results.every((r) => r.baselineClean) ? 'yes' : 'NO — check setup'}.`,
];
await mkdir(RESULTS, { recursive: true });
await writeFile(path.join(RESULTS, 'tamper.md'), lines.join('\n') + '\n');
await writeFile(path.join(RESULTS, 'tamper.json'), JSON.stringify(results, null, 2));
console.log(lines.join('\n'));
process.exit(0);
