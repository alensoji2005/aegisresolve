import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CaseRecord } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { authorize, type AuthUser } from '../auth/authorize.js';
import { parse, userOf } from '../auth/plugin.js';
import { contentHashOf, decryptContent } from '../cases/service.js';
import { forbidden } from '../errors.js';
import { verifyEvidenceRow, type VerifyReport } from '../evidence/service.js';
import { LedgerError } from '../ledger/ledger.js';
import { loadLedgerUser, userIdForFabricId } from '../users/service.js';

interface Mismatch { caseId: string; field: string; ledger: unknown; projection: unknown }

function auditor(req: FastifyRequest): AuthUser {
  const user = userOf(req);
  if (!authorize(user, 'audit:read')) throw forbidden();
  return user;
}

/** Compares every projected case with the ledger, including the hash of the decrypted complaint text. */
export async function reconcile(deps: AppDeps, user: AuthUser): Promise<{ checked: number; mismatches: Mismatch[] }> {
  const lu = await loadLedgerUser(deps, user.id);
  const { rows } = await deps.pool.query(`select case_id, status, risk_level, escalation_level, investigator_user_id from cases
                                          where status <> 'PENDING_LEDGER' order by case_id`);
  const mismatches: Mismatch[] = [];
  for (const r of rows) {
    let c: CaseRecord;
    try {
      c = await deps.ledger.evaluate<CaseRecord>(lu, 'complaint:getCase', [r.case_id]);
    } catch (e) {
      if (e instanceof LedgerError && e.code === 'NOT_FOUND') {
        mismatches.push({ caseId: r.case_id, field: 'existence', ledger: null, projection: 'present' });
        continue;
      }
      throw e;
    }
    const cmp = (field: string, ledger: unknown, projection: unknown) => {
      if ((ledger ?? null) !== (projection ?? null)) mismatches.push({ caseId: r.case_id, field, ledger, projection });
    };
    cmp('status', c.status, r.status);
    cmp('riskLevel', c.riskLevel, r.risk_level);
    cmp('escalationLevel', c.escalationLevel, r.escalation_level);
    cmp('investigator', await userIdForFabricId(deps, c.investigator?.id), r.investigator_user_id);
    try {
      const content = await decryptContent(deps, r.case_id);
      cmp('content', c.contentHash, contentHashOf(content.title, content.description));
    } catch {
      mismatches.push({ caseId: r.case_id, field: 'content', ledger: c.contentHash, projection: 'unreadable' });
    }
  }
  return { checked: rows.length, mismatches };
}

export function auditRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/audit/reconcile', async (req) => reconcile(deps, auditor(req)));

    app.post('/audit/verify-evidence', async (req) => {
      const lu = await loadLedgerUser(deps, auditor(req).id);
      const { rows } = await deps.pool.query('select * from evidence order by created_at');
      const failures: VerifyReport[] = [];
      for (const row of rows) {
        const r = await verifyEvidenceRow(deps, lu, row).catch((): VerifyReport => ({
          evidenceId: row.id, caseId: row.case_id, cipherHashOk: false, plainSha256Ok: false, plainSha3Ok: false, ledgerMatch: false, ok: false,
        }));
        if (!r.ok) failures.push(r);
      }
      return { checked: rows.length, failures };
    });

    app.get('/audit/access-log', async (req) => {
      const lu = await loadLedgerUser(deps, auditor(req).id);
      const { caseId } = parse(z.object({ caseId: z.string().regex(/^CASE-\d{4}-\d{6}$/) }), req.query);
      return deps.ledger.evaluate(lu, 'complaint:getAccessLog', [caseId]);
    });

    app.get<{ Params: { id: string } }>('/audit/cases/:id/history', async (req) => {
      const lu = await loadLedgerUser(deps, auditor(req).id);
      return deps.ledger.evaluate(lu, 'complaint:getCaseHistory', [req.params.id]);
    });
  };
}
