import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type CaseRecord, OUTCOMES, type Outcome } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { authorize, type AuthUser } from '../auth/authorize.js';
import { parse, requireRoles, userOf } from '../auth/plugin.js';
import { projectCase } from '../cases/projection.js';
import { loadCaseFor } from '../cases/service.js';
import { sealString, sha256Hex } from '../crypto.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { withMvccRetry } from '../ledger/ledger.js';
import { loadLedgerUser } from '../users/service.js';

type P = { Params: { id: string } };

/** Submits a case transition as the acting user (retrying once on MVCC conflict) and projects the result. */
export async function transition(deps: AppDeps, user: AuthUser, caseId: string, fn: string, args: string[]) {
  const lu = await loadLedgerUser(deps, user.id);
  const { txId, result } = await withMvccRetry(() => deps.ledger.submit<CaseRecord>(lu, `complaint:${fn}`, [caseId, ...args]));
  await projectCase(deps, result);
  return { txId, case: result };
}

const reply = (r: { txId: string; case: CaseRecord }) => ({
  caseId: r.case.caseId, status: r.case.status, escalationLevel: r.case.escalationLevel, approvals: r.case.approvals.length, txId: r.txId,
});

const caseIdRe = /^CASE-\d{4}-\d{6}$/;

export function workflowRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.post<P>('/cases/:id/assign', async (req) => {
      const user = userOf(req);
      if (!authorize(user, 'case:assign')) throw forbidden();
      await loadCaseFor(deps, user, req.params.id);
      const { investigatorUserId } = parse(z.object({ investigatorUserId: z.string().uuid() }), req.body);
      const { rows } = await deps.pool.query(
        `select fabric_identity, unit_id, depot_id, pseudo from users where id = $1 and role = 'INVESTIGATOR' and active`, [investigatorUserId]);
      if (!rows[0]) throw notFound('investigator');
      const i = rows[0];
      return reply(await transition(deps, user, req.params.id, 'assignInvestigator', [i.fabric_identity, i.unit_id, i.depot_id, i.pseudo]));
    });

    app.post<P>('/cases/:id/accept', async (req) => {
      const user = requireRoles(req, 'INVESTIGATOR');
      await loadCaseFor(deps, user, req.params.id);
      return reply(await transition(deps, user, req.params.id, 'acceptAssignment', []));
    });

    app.post<P>('/cases/:id/findings', async (req) => {
      const user = requireRoles(req, 'INVESTIGATOR');
      await loadCaseFor(deps, user, req.params.id);
      const b = parse(z.object({
        body: z.string().trim().min(20).max(10000),
        outcome: z.enum(OUTCOMES as [Outcome, ...Outcome[]]),
        correctiveAction: z.string().trim().max(2000).optional(),
      }), req.body);
      const doc = JSON.stringify({ body: b.body, outcome: b.outcome, correctiveAction: b.correctiveAction ?? null });
      const hash = sha256Hex(doc);
      const r = await transition(deps, user, req.params.id, 'submitFindings', [hash, b.outcome]);
      await deps.pool.query('insert into findings(case_id, author, body_enc, body_sha256, outcome, ledger_tx_id) values ($1,$2,$3,$4,$5,$6)',
        [req.params.id, user.id, sealString(doc, deps.cfg.AEGIS_KEK), hash, b.outcome, r.txId]);
      return reply(r);
    });

    app.post<P>('/cases/:id/review', async (req) => {
      const user = userOf(req);
      if (!authorize(user, 'case:review')) throw forbidden();
      await loadCaseFor(deps, user, req.params.id);
      const { decision } = parse(z.object({ decision: z.enum(['APPROVE', 'REJECT']) }), req.body);
      const { rows } = await deps.pool.query('select body_sha256 from findings where case_id = $1 order by created_at desc limit 1', [req.params.id]);
      if (!rows[0]) throw new ApiError(409, 'INVALID_TRANSITION', 'no findings to review');
      return reply(await transition(deps, user, req.params.id, 'recordApproval', [decision, rows[0].body_sha256]));
    });

    app.post<P>('/cases/:id/appeal', async (req) => {
      const user = requireRoles(req, 'COMPLAINANT');
      await loadCaseFor(deps, user, req.params.id);
      const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(2000) }), req.body);
      const r = await transition(deps, user, req.params.id, 'fileAppeal', [sha256Hex(reason)]);
      await deps.pool.query('insert into appeals(case_id, reason_enc, ledger_tx_id) values ($1,$2,$3)',
        [req.params.id, sealString(reason, deps.cfg.AEGIS_KEK), r.txId]);
      return reply(r);
    });

    app.post<P>('/cases/:id/appeal/decide', async (req) => {
      const user = requireRoles(req, 'REVIEW_BOARD');
      await loadCaseFor(deps, user, req.params.id);
      const b = parse(z.object({ accept: z.boolean(), reason: z.string().trim().min(10).max(2000) }), req.body);
      const r = await transition(deps, user, req.params.id, 'decideAppeal', [String(b.accept), sha256Hex(b.reason)]);
      await deps.pool.query(`update appeals set status = $2 where case_id = $1 and status = 'FILED'`, [req.params.id, b.accept ? 'ACCEPTED' : 'REJECTED']);
      return reply(r);
    });

    app.post<P>('/cases/:id/duplicate', async (req) => {
      const user = requireRoles(req, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD');
      await loadCaseFor(deps, user, req.params.id);
      const { ofCaseId } = parse(z.object({ ofCaseId: z.string().regex(caseIdRe) }), req.body);
      const r = await transition(deps, user, req.params.id, 'markDuplicate', [ofCaseId]);
      await upsertLink(deps, req.params.id, ofCaseId, 'DUPLICATE', user.id);
      return reply(r);
    });

    app.post<P>('/cases/:id/links', async (req) => {
      const user = requireRoles(req, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD');
      await loadCaseFor(deps, user, req.params.id);
      const { linkedCaseId } = parse(z.object({ linkedCaseId: z.string().regex(caseIdRe) }), req.body);
      const r = await transition(deps, user, req.params.id, 'linkRelated', [linkedCaseId]);
      const other = await deps.ledger.evaluate<CaseRecord>(await loadLedgerUser(deps, user.id), 'complaint:getCase', [linkedCaseId]);
      await projectCase(deps, other);
      await upsertLink(deps, req.params.id, linkedCaseId, 'RELATED', user.id);
      return reply(r);
    });

    app.post<P>('/cases/:id/lifecycle-links', async (req) => {
      const user = requireRoles(req, 'INVESTIGATOR', 'STORE_OFFICER');
      await loadCaseFor(deps, user, req.params.id);
      const { eventIds } = parse(z.object({ eventIds: z.array(z.string().regex(/^EVT-\d{6}$/)).min(1).max(50) }), req.body);
      return reply(await transition(deps, user, req.params.id, 'linkLifecycleEvents', [JSON.stringify(eventIds)]));
    });
  };
}

async function upsertLink(deps: AppDeps, caseId: string, linkedCaseId: string, type: 'DUPLICATE' | 'RELATED', userId: string) {
  await deps.pool.query(
    `insert into case_links(case_id, linked_case_id, link_type, confirmed_by) values ($1,$2,$3,$4)
     on conflict (case_id, linked_case_id) do update set link_type = excluded.link_type, confirmed_by = excluded.confirmed_by`,
    [caseId, linkedCaseId, type, userId]);
}
