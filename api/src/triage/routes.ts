import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { authorize } from '../auth/authorize.js';
import { userOf } from '../auth/plugin.js';
import { loadCaseFor } from '../cases/service.js';
import { forbidden } from '../errors.js';
import { linkedLifecycleEvents, suggestLifecycleEvents } from './lifecycleSuggest.js';

type P = { Params: { id: string } };

export function triageRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    const fullCase = async (req: any) => {
      const user = userOf(req);
      const loaded = await loadCaseFor(deps, user, req.params.id);
      if (!authorize(user, 'case:read:full', loaded.facts)) throw forbidden();
      return loaded;
    };

    app.get<P>('/cases/:id/ai', async (req) => {
      await fullCase(req);
      const { rows } = await deps.pool.query(
        'select category_probs, entities, risk_explanation, model_versions, result_sha256 from case_ai where case_id = $1', [req.params.id]);
      return rows[0] ?? null;
    });

    app.get<P>('/cases/:id/similar', async (req) => {
      await fullCase(req);
      const { rows } = await deps.pool.query(
        `select k.linked_case_id as "caseId", k.link_type as "linkType", k.similarity as score, k.reasons, k.confirmed_by is not null as confirmed,
                c.status, c.category, c.created_at as "createdAt"
         from case_links k join cases c on c.case_id = k.linked_case_id where k.case_id = $1 order by k.similarity desc nulls last`,
        [req.params.id]);
      return rows;
    });

    app.get<P>('/cases/:id/lifecycle', async (req) => {
      const user = userOf(req);
      const { row, facts } = await loadCaseFor(deps, user, req.params.id);
      const storeOfficer = user.role === 'STORE_OFFICER' && facts.depot === user.depot;
      if (!storeOfficer && !authorize(user, 'case:read:full', facts)) throw forbidden();
      return {
        linked: await linkedLifecycleEvents(deps, row.ledger_json.linkedEventIds ?? []),
        suggested: await suggestLifecycleEvents(deps, req.params.id),
      };
    });
  };
}
