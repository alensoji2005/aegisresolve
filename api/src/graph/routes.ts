import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { parse, requireRoles } from '../auth/plugin.js';
import { forbidden } from '../errors.js';
import { twinLocation, twinState } from '../twin/service.js';
import { graphAround, graphInsights } from './service.js';

const OVERSIGHT = ['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] as const;

export function graphRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/graph', async (req) => {
      requireRoles(req, ...OVERSIGHT);
      const { center, depth } = parse(z.object({ center: z.string().max(80), depth: z.coerce.number().int().min(1).max(3).default(2) }), req.query);
      return graphAround(deps, center, depth);
    });

    app.get('/graph/insights', async (req) => {
      requireRoles(req, ...OVERSIGHT);
      return graphInsights(deps);
    });

    app.get('/twin', async (req) => {
      const user = requireRoles(req, ...OVERSIGHT, 'STORE_OFFICER');
      return twinState(deps, user.role === 'STORE_OFFICER' ? user.depot : null);
    });

    app.get('/twin/location', async (req) => {
      const user = requireRoles(req, ...OVERSIGHT, 'STORE_OFFICER');
      const { id } = parse(z.object({ id: z.string().regex(/^DEP-\d{2}\/MAG-\d{2}\/BAY-\d{2}$/) }), req.query);
      if (user.role === 'STORE_OFFICER' && !id.startsWith(user.depot + '/')) throw forbidden();
      return twinLocation(deps, id);
    });
  };
}
