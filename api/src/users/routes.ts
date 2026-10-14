import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { authorize } from '../auth/authorize.js';
import { parse, requireRoles, userOf } from '../auth/plugin.js';
import { forbidden } from '../errors.js';
import { createUser, newUserSchema } from './service.js';

export function userRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/admin/users', async (req, reply) => {
      if (!authorize(userOf(req), 'user:admin')) throw forbidden();
      const input = parse(newUserSchema, req.body);
      const { id, password } = await createUser(deps, input);
      return reply.status(201).send({ id, initialPassword: password });
    });

    app.get('/investigators', async (req) => {
      requireRoles(req, 'SAFETY_OFFICER', 'REVIEW_BOARD');
      const { rows } = await deps.pool.query(
        `select id, username, unit_id as unit, depot_id as depot from users where role = 'INVESTIGATOR' and active order by username`);
      return rows;
    });
  };
}
