import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { authenticate, userOf } from './auth/plugin.js';
import { authRoutes } from './auth/routes.js';
import type { BlobStore } from './blob.js';
import { caseRoutes } from './cases/routes.js';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
import { evidenceRoutes } from './evidence/routes.js';
import { httpStatusFor, type Ledger, LedgerError } from './ledger/ledger.js';
import type { AiClient } from './triage/aiClient.js';
import { triageRoutes } from './triage/routes.js';
import { userRoutes } from './users/routes.js';
import { workflowRoutes } from './workflow/routes.js';

export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export interface AppDeps {
  cfg: Config;
  pool: pg.Pool;
  ledger: Ledger;
  blobs: BlobStore;
  ai: AiClient;
  now: () => Date;
  /** Called after a case is registered; wired to the triage job. */
  onCaseCreated?: (caseId: string) => void;
}

/** Feature route modules register here; each gets the shared deps and runs behind authentication. */
export const protectedRoutes: ((deps: AppDeps) => FastifyPluginAsync)[] = [userRoutes, caseRoutes, evidenceRoutes, workflowRoutes, triageRoutes];

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' && !process.env.VITEST, bodyLimit: 1024 * 1024 });
  app.register(helmet);
  app.register(cors, { origin: deps.cfg.WEB_ORIGIN, credentials: true });
  app.register(cookie);
  app.register(rateLimit, { global: false });
  app.register(multipart, { limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1 } });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof LedgerError) {
      return reply.status(httpStatusFor(err.code)).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'file exceeds 25 MB' } });
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });

  app.get('/health', async () => ({ ok: true }));
  app.register(authRoutes(deps), { prefix: '/api/v1/auth' });
  app.register(async (api) => {
    api.decorateRequest('user', null);
    api.addHook('preHandler', authenticate(deps));
    api.get('/me', async (req) => userOf(req));
    for (const r of protectedRoutes) await api.register(r(deps));
  }, { prefix: '/api/v1' });
  return app;
}
