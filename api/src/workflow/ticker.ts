import { escalationLevel, POLICY } from '../../../chaincode/aegis-cc/src/rules.js';
import type { CaseRecord } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { projectCase } from '../cases/projection.js';
import { systemUser } from '../users/service.js';

export type RetryTriage = (caseId: string) => Promise<void>;

/** True when checkSla would change the case: avoids a ledger transaction per overdue case per minute. */
function slaChangeDue(c: CaseRecord, now: Date): boolean {
  const due = new Date(c.slaDueAt);
  if (now <= due) return false;
  if (c.status === 'CLOSED') return true;
  const hours = c.riskLevel ? POLICY.slaHours[c.riskLevel] : POLICY.untriagedSlaHours;
  return escalationLevel(now, due, hours) > c.escalationLevel;
}

export async function runSweeps(deps: AppDeps, retryTriage?: RetryTriage): Promise<{ escalated: number; finalised: number; triaged: number }> {
  const now = deps.now();
  const out = { escalated: 0, finalised: 0, triaged: 0 };
  const { rows } = await deps.pool.query<{ ledger_json: CaseRecord }>(
    `select ledger_json from cases where sla_due_at < $1 and status not in ('CLOSED_FINAL','MERGED_DUPLICATE','PENDING_LEDGER')`, [now]);
  const due = rows.map((r) => r.ledger_json).filter((c) => slaChangeDue(c, now));
  if (due.length) {
    const sys = await systemUser(deps);
    for (const before of due) {
      try {
        const { result } = await deps.ledger.submit<CaseRecord>(sys, 'complaint:checkSla', [before.caseId]);
        await projectCase(deps, result);
        if (result.status === 'CLOSED_FINAL' && before.status === 'CLOSED') out.finalised++;
        else if (result.escalationLevel > before.escalationLevel) out.escalated++;
      } catch (e) {
        console.error('checkSla failed', before.caseId, e);
      }
    }
  }
  if (retryTriage) {
    const pending = await deps.pool.query<{ case_id: string }>(
      `select case_id from cases where status = 'SUBMITTED' and triage_status in ('PENDING','FAILED') and triage_attempts < 3
       and created_at < $1 order by created_at limit 20`, [new Date(now.getTime() - 60_000)]);
    for (const r of pending.rows) {
      await retryTriage(r.case_id);
      out.triaged++;
    }
  }
  return out;
}

export function startTicker(deps: AppDeps, retryTriage?: RetryTriage, everyMs = 60_000): () => void {
  let running = false;
  const handle = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runSweeps(deps, retryTriage);
    } catch (e) {
      console.error('ticker sweep failed', e);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => clearInterval(handle);
}
