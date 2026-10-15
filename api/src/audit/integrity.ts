import type { CaseRecord } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { projectCase } from '../cases/projection.js';
import { contentHashOf, decryptContent } from '../cases/service.js';
import { verifyEvidenceRow, type VerifyReport } from '../evidence/service.js';
import { LedgerError, type LedgerUser } from '../ledger/ledger.js';
import { userIdForFabricId } from '../users/service.js';

export interface Mismatch { caseId: string; field: string; ledger: unknown; projection: unknown }

/** Fields the database only mirrors from the ledger: a mismatch here can be repaired by re-projecting the ledger record. */
const REPAIRABLE = new Set(['status', 'riskLevel', 'escalationLevel', 'investigator']);

export async function recordIncident(deps: AppDeps, i: {
  kind: 'CASE_FIELD' | 'CONTENT' | 'EVIDENCE' | 'MISSING_ON_LEDGER'; caseId: string; evidenceId?: string; detail: unknown;
  action: 'REPAIRED_FROM_LEDGER' | 'CONTENT_WITHHELD' | 'QUARANTINED' | 'FLAGGED'; by: string;
}) {
  // Ongoing conditions (withheld content, missing ledger record) are recorded once, not on every sweep.
  const ongoing = i.action === 'CONTENT_WITHHELD' || i.action === 'FLAGGED';
  await deps.pool.query(
    `insert into integrity_incidents(kind, case_id, evidence_id, detail, action, detected_by, detected_at)
     select $1, $2, $3, $4, $5, $6, $7
     where not $8 or not exists (select 1 from integrity_incidents where kind = $1 and case_id = $2 and action = $5)`,
    [i.kind, i.caseId, i.evidenceId ?? null, JSON.stringify(i.detail), i.action, i.by, deps.now(), ongoing]);
}

/** Compares every projected case with the ledger, including the hash of the decrypted complaint text. */
export async function reconcile(deps: AppDeps, lu: LedgerUser): Promise<{ checked: number; mismatches: Mismatch[] }> {
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
    if (!(await contentMatchesLedger(deps, r.case_id, c.contentHash))) {
      mismatches.push({ caseId: r.case_id, field: 'content', ledger: c.contentHash, projection: 'altered' });
    }
  }
  return { checked: rows.length, mismatches };
}

export async function contentMatchesLedger(deps: AppDeps, caseId: string, ledgerHash: string): Promise<boolean> {
  try {
    const content = await decryptContent(deps, caseId);
    return contentHashOf(content.title, content.description) === ledgerHash;
  } catch {
    return false;
  }
}

/**
 * Makes tampering ineffective: mirrored fields are restored from the ledger (the source of truth); complaint text that no
 * longer matches its on-chain hash cannot be restored (only the hash is on-chain), so it is withheld from every view.
 */
export async function repairFromLedger(deps: AppDeps, lu: LedgerUser, by: string) {
  const { checked, mismatches } = await reconcile(deps, lu);
  const repaired: Mismatch[] = [];
  const unrepairable: Mismatch[] = [];
  for (const caseId of [...new Set(mismatches.map((m) => m.caseId))]) {
    const forCase = mismatches.filter((m) => m.caseId === caseId);
    const fixable = forCase.filter((m) => REPAIRABLE.has(m.field));
    if (fixable.length) {
      await projectCase(deps, await deps.ledger.evaluate<CaseRecord>(lu, 'complaint:getCase', [caseId]));
      repaired.push(...fixable);
      await recordIncident(deps, { kind: 'CASE_FIELD', caseId, detail: fixable, action: 'REPAIRED_FROM_LEDGER', by });
    }
    for (const m of forCase.filter((x) => !REPAIRABLE.has(x.field))) {
      unrepairable.push(m);
      await recordIncident(deps, m.field === 'content'
        ? { kind: 'CONTENT', caseId, detail: m, action: 'CONTENT_WITHHELD', by }
        : { kind: 'MISSING_ON_LEDGER', caseId, detail: m, action: 'FLAGGED', by });
    }
  }
  return { checked, repaired, unrepairable };
}

/** Re-verifies every evidence file; anything that fails is quarantined so it can never be downloaded. */
export async function verifyAllEvidence(deps: AppDeps, lu: LedgerUser, by: string) {
  const { rows } = await deps.pool.query('select * from evidence order by created_at');
  const failures: (VerifyReport & { quarantined: boolean })[] = [];
  for (const row of rows) {
    const r = await verifyEvidenceRow(deps, lu, row).catch((): VerifyReport => ({
      evidenceId: row.id, caseId: row.case_id, cipherHashOk: false, plainSha256Ok: false, plainSha3Ok: false, ledgerMatch: false, ok: false,
    }));
    if (r.ok) continue;
    if (!row.quarantined_at) await quarantineEvidence(deps, r, by);
    failures.push({ ...r, quarantined: true });
  }
  return { checked: rows.length, failures };
}

export async function quarantineEvidence(deps: AppDeps, r: VerifyReport, by: string) {
  await deps.pool.query('update evidence set quarantined_at = $2 where id = $1 and quarantined_at is null', [r.evidenceId, deps.now()]);
  await recordIncident(deps, { kind: 'EVIDENCE', caseId: r.caseId, evidenceId: r.evidenceId, detail: r, action: 'QUARANTINED', by });
}

export async function listIncidents(deps: AppDeps, caseId?: string) {
  const { rows } = await deps.pool.query(
    `select id, kind, case_id as "caseId", evidence_id as "evidenceId", detail, action, detected_by as "detectedBy", detected_at as "detectedAt"
     from integrity_incidents where $1::text is null or case_id = $1 order by detected_at desc, id desc limit 200`, [caseId ?? null]);
  return rows;
}
