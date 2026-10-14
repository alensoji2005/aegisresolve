import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Role } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { ApiError, forbidden } from '../errors.js';
import type { AuthUser } from './authorize.js';
import { verifyToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
}

export function authenticate(deps: AppDeps) {
  return async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHENTICATED', 'missing token');
    const sub = await verifyToken(deps.cfg, h.slice(7), 'access', deps.now());
    const { rows } = await deps.pool.query('select id, username, role, unit_id, depot_id, pseudo from users where id = $1 and active', [sub]);
    if (!rows[0]) throw new ApiError(401, 'UNAUTHENTICATED', 'unknown user');
    const r = rows[0];
    req.user = { id: r.id, username: r.username, role: r.role, unit: r.unit_id, depot: r.depot_id, pseudo: r.pseudo ?? '' };
  };
}

export function userOf(req: FastifyRequest): AuthUser {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
  return req.user;
}

export function requireRoles(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const u = userOf(req);
  if (!roles.includes(u.role)) throw forbidden();
  return u;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ApiError(400, 'INVALID_ARG', 'invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}
