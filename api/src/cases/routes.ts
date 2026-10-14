import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { authorize } from '../auth/authorize.js';
import { parse, requireRoles, userOf } from '../auth/plugin.js';
import { forbidden } from '../errors.js';
import { caseHistory, createCase, createCaseSchema, getCaseView, listCases, listQuerySchema, loadCaseFor } from './service.js';

export function caseRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/cases', async (req, reply) => {
      const user = userOf(req);
      if (!authorize(user, 'case:create')) throw forbidden();
      return reply.status(201).send(await createCase(deps, user, parse(createCaseSchema, req.body)));
    });

    app.get('/cases', async (req) => listCases(deps, userOf(req), parse(listQuerySchema, req.query)));

    app.get<{ Params: { id: string } }>('/cases/:id', async (req) => getCaseView(deps, userOf(req), req.params.id));

    app.get<{ Params: { id: string } }>('/cases/:id/history', async (req) => {
      const user = requireRoles(req, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR');
      await loadCaseFor(deps, user, req.params.id);
      return caseHistory(deps, user, req.params.id);
    });
  };
}
