import type pg from 'pg';
import type { CaseRecord } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { userIdForFabricId } from '../users/service.js';

const OUTCOME_VISIBLE = ['CLOSED', 'APPEALED', 'CLOSED_FINAL'];

/** Writes the ledger's case record into the Postgres read model. The ledger stays the source of truth. */
export async function projectCase(deps: AppDeps, c: CaseRecord, db: pg.Pool | pg.PoolClient = deps.pool): Promise<void> {
  const investigatorUserId = await userIdForFabricId(deps, c.investigator?.id);
  await db.query(
    `update cases set status=$2, category=$3, risk_level=$4, risk_score=$5, depot_id=$6, location_ref=$7, investigator_user_id=$8,
       sla_due_at=$9, escalation_level=$10, outcome=$11, ledger_json=$12, updated_at=$13
     where case_id=$1`,
    [c.caseId, c.status, c.category, c.riskLevel, c.riskScore, c.depot, c.locationRef, investigatorUserId, c.slaDueAt, c.escalationLevel,
      OUTCOME_VISIBLE.includes(c.status) ? c.outcome : null, JSON.stringify(c), c.updatedAt],
  );
}
