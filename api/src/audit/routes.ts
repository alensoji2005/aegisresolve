import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authorize, type AuthUser } from '../auth/authorize.js';
import { parse, userOf } from '../auth/plugin.js';
import { forbidden } from '../errors.js';
import { loadLedgerUser, systemUser } from '../users/service.js';
import { listIncidents, reconcile, repairFromLedger, verifyAllEvidence } from './integrity.js';

function auditor(req: FastifyRequest): AuthUser {
  const user = userOf(req);
  if (!authorize(user, 'audit:read')) throw forbidden();
  return user;
}

const caseIdSchema = z.string().regex(/^CASE-\d{4}-\d{6}$/);

export function auditRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/audit/reconcile', async (req) => reconcile(deps, await loadLedgerUser(deps, auditor(req).id)));

    app.post('/audit/repair', async (req) => {
      const user = auditor(req);
      return repairFromLedger(deps, await loadLedgerUser(deps, user.id), user.username);
    });

    app.post('/audit/verify-evidence', async (req) => {
      const user = auditor(req);
      return verifyAllEvidence(deps, await loadLedgerUser(deps, user.id), user.username);
    });

    app.get('/audit/incidents', async (req) => {
      auditor(req);
      const { caseId } = parse(z.object({ caseId: caseIdSchema.optional() }), req.query);
      return listIncidents(deps, caseId);
    });

    app.get('/audit/access-log', async (req) => {
      const lu = await loadLedgerUser(deps, auditor(req).id);
      const { caseId } = parse(z.object({ caseId: caseIdSchema }), req.query);
      return deps.ledger.evaluate(lu, 'complaint:getAccessLog', [caseId]);
    });

    app.get<{ Params: { id: string } }>('/audit/cases/:id/history', async (req) => {
      const lu = await loadLedgerUser(deps, auditor(req).id);
      return deps.ledger.evaluate(lu, 'complaint:getCaseHistory', [parse(caseIdSchema, req.params.id)]);
    });
  };
}

/** Background job: repairs mirrored fields from the ledger and quarantines tampered evidence, as the system identity. */
export async function runIntegritySweep(deps: AppDeps) {
  const sys = await systemUser(deps);
  const repair = await repairFromLedger(deps, sys, 'system');
  const evidence = await verifyAllEvidence(deps, sys, 'system');
  return { repaired: repair.repaired.length, unrepairable: repair.unrepairable.length, quarantined: evidence.failures.length };
}
