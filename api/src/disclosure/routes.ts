import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { parse, requireRoles } from '../auth/plugin.js';
import { loadCaseFor } from '../cases/service.js';
import { changeGrant, createGrant, listGrants, revealIdentity } from './service.js';

type P = { Params: { id: string; gid: string } };

export function disclosureRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.get<P>('/cases/:id/disclosures', async (req) => {
      const user = requireRoles(req, 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR');
      await loadCaseFor(deps, user, req.params.id);
      return listGrants(deps, user, req.params.id);
    });

    app.post<P>('/cases/:id/disclosures', async (req, reply) => {
      const user = requireRoles(req, 'REVIEW_BOARD');
      await loadCaseFor(deps, user, req.params.id);
      const body = parse(z.object({
        granteeUserId: z.string().uuid(), scope: z.enum(['FULL', 'IDENTITY']), reason: z.string().trim().min(10).max(500),
        hours: z.number().int().min(1).max(168),
      }), req.body);
      return reply.status(201).send(await createGrant(deps, user, req.params.id, body));
    });

    for (const action of ['approve', 'revoke'] as const) {
      app.post<P>(`/cases/:id/disclosures/:gid/${action}`, async (req) => {
        const user = requireRoles(req, 'REVIEW_BOARD');
        await loadCaseFor(deps, user, req.params.id);
        parse(z.string().uuid(), req.params.gid);
        return changeGrant(deps, user, req.params.id, req.params.gid, action);
      });
    }

    app.get<P>('/cases/:id/identity', async (req) => {
      const user = requireRoles(req, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR');
      await loadCaseFor(deps, user, req.params.id);
      return revealIdentity(deps, user, req.params.id);
    });

    app.get('/staff', async (req) => {
      requireRoles(req, 'REVIEW_BOARD');
      const { rows } = await deps.pool.query(
        `select id, username, role from users where active and role in ('INVESTIGATOR','SAFETY_OFFICER','REVIEW_BOARD','AUDITOR') order by role, username`);
      return rows;
    });
  };
}
