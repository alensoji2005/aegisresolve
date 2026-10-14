import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { openString } from '../crypto.js';
import { ApiError } from '../errors.js';
import { hashPassword, otpauthUrl, verifyPassword, verifyTotp } from './credentials.js';
import { parse } from './plugin.js';
import { signToken, verifyToken } from './tokens.js';

const REFRESH_COOKIE = 'aegis_refresh';
let dummyHash: Promise<string> | null = null;

export function authRoutes(deps: AppDeps): FastifyPluginAsync {
  const invalid = () => new ApiError(401, 'INVALID_CREDENTIALS', 'invalid username or password');

  return async (app) => {
    app.post('/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
      const body = parse(z.object({ username: z.string().max(80), password: z.string().max(200) }), req.body);
      const { rows } = await deps.pool.query('select id, username, password_hash, totp_secret_enc, totp_confirmed from users where username = $1 and active', [body.username]);
      const u = rows[0];
      if (!u) {
        // Spend the same argon2 time for unknown users so timing does not reveal account existence.
        await verifyPassword(await (dummyHash ??= hashPassword('not-a-real-password')), body.password);
        throw invalid();
      }
      if (!(await verifyPassword(u.password_hash, body.password))) throw invalid();
      const mfaToken = await signToken(deps.cfg, u.id, 'mfa', deps.now());
      return u.totp_confirmed
        ? { mfaRequired: true, mfaToken }
        : { mfaRequired: true, mfaToken, otpauthUrl: otpauthUrl(u.username, openString(u.totp_secret_enc, deps.cfg.AEGIS_KEK)) };
    });

    app.post('/mfa/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = parse(z.object({ mfaToken: z.string(), code: z.string() }), req.body);
      const userId = await verifyToken(deps.cfg, body.mfaToken, 'mfa', deps.now());
      const { rows } = await deps.pool.query('select * from users where id = $1 and active', [userId]);
      const u = rows[0];
      if (!u || !verifyTotp(openString(u.totp_secret_enc, deps.cfg.AEGIS_KEK), body.code, deps.now())) {
        throw new ApiError(401, 'INVALID_MFA', 'invalid code');
      }
      if (!u.totp_confirmed) await deps.pool.query('update users set totp_confirmed = true where id = $1', [u.id]);
      const now = deps.now();
      reply.setCookie(REFRESH_COOKIE, await signToken(deps.cfg, u.id, 'refresh', now), {
        httpOnly: true, sameSite: 'strict', secure: true, path: '/api/v1/auth', maxAge: 8 * 3600,
      });
      return {
        accessToken: await signToken(deps.cfg, u.id, 'access', now),
        user: { id: u.id, username: u.username, role: u.role, unit: u.unit_id, depot: u.depot_id },
      };
    });

    app.post('/refresh', async (req) => {
      const token = req.cookies[REFRESH_COOKIE];
      if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'no session');
      const userId = await verifyToken(deps.cfg, token, 'refresh', deps.now());
      const { rows } = await deps.pool.query('select id, username, role, unit_id, depot_id from users where id = $1 and active', [userId]);
      if (!rows[0]) throw new ApiError(401, 'UNAUTHENTICATED');
      const u = rows[0];
      return {
        accessToken: await signToken(deps.cfg, userId, 'access', deps.now()),
        user: { id: u.id, username: u.username, role: u.role, unit: u.unit_id, depot: u.depot_id },
      };
    });

    app.post('/logout', async (_req, reply) => {
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
      return { ok: true };
    });
  };
}
