import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { parse, requireRoles } from '../auth/plugin.js';
import { listAnomalies, runAnomalyScan } from './service.js';

export function anomalyRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/anomalies', async (req) => {
      requireRoles(req, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR');
      const q = parse(z.object({ family: z.enum(['lifecycle', 'access', 'sensor']).optional(), days: z.coerce.number().int().min(1).max(90).default(30) }), req.query);
      return listAnomalies(deps, q.family, q.days);
    });

    app.post('/anomalies/scan', async (req) => {
      requireRoles(req, 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR');
      return runAnomalyScan(deps);
    });
  };
}
