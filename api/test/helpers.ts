import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { type AppDeps, buildApp } from '../src/app.js';
import { totpCode } from '../src/auth/credentials.js';
import { signToken } from '../src/auth/tokens.js';
import { MemoryBlobStore } from '../src/blob.js';
import { loadConfig } from '../src/config.js';
import { FakeLedger } from '../src/ledger/fakeLedger.js';
import { migrate } from '../src/migrate.js';
import type { AnalyzeResult } from '../src/triage/aiClient.js';
import { createUser, type NewUser } from '../src/users/service.js';
import { testPool } from './pgtest.js';

export const T0 = new Date('2026-10-14T09:00:00Z');

export function testConfig() {
  const k = (n: number) => randomBytes(n).toString('base64');
  return loadConfig({
    DATABASE_URL: 'postgres://unused@localhost/x', AEGIS_KEK: k(32), PSEUDONYM_SECRET: k(32), JWT_SECRET: k(64), WALLET_KEK: k(32),
    LEDGER_MODE: 'fake', AI_SHARED_SECRET: 's',
  });
}

/** Deterministic unit-length embedding from text, so similar texts are not required to be similar (tests set embeddings explicitly when it matters). */
export function hashEmbedding(text: string): number[] {
  const v: number[] = [];
  let seed = createHash('sha256').update(text).digest();
  while (v.length < 384) {
    for (const b of seed) v.push(b / 255 - 0.5);
    seed = createHash('sha256').update(seed).digest();
  }
  const e = v.slice(0, 384);
  const n = Math.hypot(...e);
  return e.map((x) => x / n);
}

export const fakeAi = {
  calls: 0,
  fail: false,
  async analyze(text: string): Promise<AnalyzeResult> {
    this.calls++;
    if (this.fail) throw new Error('AI down');
    return {
      category: 'STORAGE_ENVIRONMENT', categoryProbs: { STORAGE_ENVIRONMENT: 0.91, INVENTORY_DISCREPANCY: 0.05 }, needsHumanTriage: false,
      topKeywords: ['humidity', 'damp'], entities: [], severityHits: 2, embedding: hashEmbedding(text), modelVersion: 'fake-1',
    };
  },
};

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  ledger: FakeLedger;
  blobs: MemoryBlobStore;
  clock: { set(d: Date): void; advanceHours(h: number): void };
  user(u: NewUser): Promise<{ id: string; token: string; password: string; totpSecret: string }>;
  stop(): Promise<void>;
}

export async function makeTestApp(over: Partial<AppDeps> = {}): Promise<TestApp> {
  const { pool, stop } = await testPool();
  await migrate(pool);
  let now = T0;
  const cfg = testConfig();
  const ledger = new FakeLedger(() => now);
  const blobs = new MemoryBlobStore();
  fakeAi.fail = false;
  fakeAi.calls = 0;
  const deps: AppDeps = { cfg, pool, ledger, blobs, ai: fakeAi, now: () => now, ...over };
  const app = buildApp(deps);
  await app.ready();
  return {
    app, deps, ledger, blobs,
    clock: { set: (d) => { now = d; }, advanceHours: (h) => { now = new Date(now.getTime() + h * 3600e3); } },
    async user(u) {
      const created = await createUser(deps, { totpConfirmed: true, ...u });
      return { ...created, token: await signToken(cfg, created.id, 'access', now) };
    },
    async stop() { await app.close(); await stop(); },
  };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
export { totpCode };

export function multipart(filename: string, data: Buffer, type = 'application/octet-stream') {
  const b = '----aegis' + randomBytes(8).toString('hex');
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

export const complaint = {
  title: 'Damp packaging in bay 4',
  description: 'Humidity indicator showed 85% for two days; packaging on the lot looks damp.',
  assetRefs: ['LOT-B03-2025-0117'],
  locationRef: 'DEP-02/MAG-01/BAY-04',
  occurredAt: '2026-10-13T08:00:00.000Z',
};
