import { z } from 'zod';
import type { CaseRecord } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { authorize, type AuthUser, type CaseFacts } from '../auth/authorize.js';
import { openString, pseudonymFor, sealString, sha256Hex } from '../crypto.js';
import { ApiError, notFound } from '../errors.js';
import { activeGrants } from '../disclosure/service.js';
import { loadLedgerUser } from '../users/service.js';
import { OUTCOME_VISIBLE, projectCase } from './projection.js';

export const createCaseSchema = z.object({
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().min(20).max(5000),
  assetRefs: z.array(z.string().regex(/^LOT-[A-Z]\d{2}-\d{4}-\d{4}$/)).max(10).default([]),
  locationRef: z.string().regex(/^DEP-\d{2}\/MAG-\d{2}\/BAY-\d{2}$/),
  occurredAt: z.string().datetime(),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const contentHashOf = (title: string, description: string) => sha256Hex(title + '\n' + description);

export async function createCase(deps: AppDeps, user: AuthUser, input: CreateCaseInput) {
  if (Date.parse(input.occurredAt) > deps.now().getTime()) throw new ApiError(400, 'INVALID_ARG', 'occurredAt is in the future');
  const { rows } = await deps.pool.query(`select nextval('case_seq') as n`);
  const caseId = `CASE-${deps.now().getUTCFullYear()}-${String(rows[0].n).padStart(6, '0')}`;
  const pseudonym = pseudonymFor(deps.cfg.PSEUDONYM_SECRET, user.id, caseId);
  const kek = deps.cfg.AEGIS_KEK;

  const client = await deps.pool.connect();
  try {
    await client.query('begin');
    await client.query('insert into pseudonyms(pseudonym, user_id, case_id) values ($1,$2,$3)', [pseudonym, user.id, caseId]);
    await client.query(
      `insert into cases(case_id, pseudonym, status, depot_id, location_ref, occurred_at, ledger_json, created_at, updated_at)
       values ($1,$2,'PENDING_LEDGER',$3,$4,$5,'{}',$6,$6)`,
      [caseId, pseudonym, input.locationRef.slice(0, 6), input.locationRef, input.occurredAt, deps.now()]);
    await client.query('insert into case_content(case_id, title_enc, description_enc, content_sha256) values ($1,$2,$3,$4)',
      [caseId, sealString(input.title, kek), sealString(input.description, kek), contentHashOf(input.title, input.description)]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }

  try {
    const { txId, result } = await deps.ledger.submit<CaseRecord>(await loadLedgerUser(deps, user.id), 'complaint:registerCase',
      [caseId, pseudonym, contentHashOf(input.title, input.description), JSON.stringify(input.assetRefs), input.locationRef]);
    await projectCase(deps, result);
    deps.onCaseCreated?.(caseId);
    return { caseId, pseudonym, status: result.status, txId };
  } catch (e) {
    await deps.pool.query('delete from cases where case_id = $1', [caseId]);
    await deps.pool.query('delete from pseudonyms where case_id = $1', [caseId]);
    throw e;
  }
}

export interface CaseRow {
  case_id: string; status: string; depot_id: string; investigator_user_id: string | null; owner_id: string | null; ledger_json: CaseRecord;
  outcome: string | null; created_at: Date; triage_status: string;
}

/** Loads a case and the facts authorisation needs. Missing and not-visible both surface as 404. */
export async function loadCaseFor(deps: AppDeps, user: AuthUser, caseId: string): Promise<{ row: CaseRow; facts: CaseFacts }> {
  const { rows } = await deps.pool.query<CaseRow>(
    `select c.*, p.user_id as owner_id from cases c join pseudonyms p on p.case_id = c.case_id
     where c.case_id = $1 and c.status <> 'PENDING_LEDGER'`, [caseId]);
  const row = rows[0];
  if (!row) throw notFound('case');
  const facts: CaseFacts = { depot: row.depot_id, investigatorUserId: row.investigator_user_id, ownedByUser: row.owner_id === user.id };
  if (!authorize(user, 'case:read:summary', facts)) throw notFound('case');
  if (user.role === 'INVESTIGATOR' && row.investigator_user_id !== user.id) facts.fullGrant = (await activeGrants(deps, user, caseId)).full;
  return { row, facts };
}

/** Logs a sensitive read on-chain (non-repudiable) and in access_events (feeds access anomaly detection). */
export async function recordAccess(deps: AppDeps, user: AuthUser, caseId: string, scope: string): Promise<void> {
  const { txId } = await deps.ledger.submit(await loadLedgerUser(deps, user.id), 'complaint:logAccess', [caseId, scope]);
  await deps.pool.query('insert into access_events(user_id, action, resource, at, ledger_tx_id) values ($1,$2,$3,$4,$5)',
    [user.id, scope.split(':')[0], caseId, deps.now(), txId]);
}

export async function decryptContent(deps: AppDeps, caseId: string): Promise<{ title: string; description: string; contentSha256: string }> {
  const { rows } = await deps.pool.query('select * from case_content where case_id = $1', [caseId]);
  if (!rows[0]) throw notFound('case content');
  const kek = deps.cfg.AEGIS_KEK;
  return { title: openString(rows[0].title_enc, kek), description: openString(rows[0].description_enc, kek), contentSha256: rows[0].content_sha256 };
}

async function usernamesByFabricId(deps: AppDeps, ids: string[]): Promise<Map<string, { id: string; username: string }>> {
  if (!ids.length) return new Map();
  const { rows } = await deps.pool.query('select id, username, fabric_identity from users where fabric_identity = any($1)', [ids]);
  return new Map(rows.map((r) => [r.fabric_identity, { id: r.id, username: r.username }]));
}

export async function getCaseView(deps: AppDeps, user: AuthUser, caseId: string) {
  const { row, facts } = await loadCaseFor(deps, user, caseId);
  const lu = await loadLedgerUser(deps, user.id);
  // Read the case from the ledger, not the database copy: a tampered database row never reaches the screen.
  const c = await deps.ledger.evaluate<CaseRecord>(lu, 'complaint:getCase', [caseId]);
  const history = await deps.ledger.evaluate<{ status: string; at: string }[]>(lu, 'complaint:getCaseHistory', [caseId]);
  const timeline = history.filter((h, i) => i === 0 || h.status !== history[i - 1].status).map((h) => ({ status: h.status, at: h.at }));
  const summary = {
    caseId, status: c.status, category: c.category, riskLevel: c.riskLevel, slaDueAt: c.slaDueAt, escalationLevel: c.escalationLevel,
    outcome: OUTCOME_VISIBLE.includes(c.status) ? c.outcome : null, closedAt: c.closedAt, createdAt: c.createdAt, triageStatus: row.triage_status, isOwner: facts.ownedByUser, timeline,
    view: 'SUMMARY' as 'SUMMARY' | 'FULL',
    grants: ['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'].includes(user.role) ? await activeGrants(deps, user, caseId) : null,
  };
  if (!authorize(user, 'case:read:full', facts)) return summary;

  await recordAccess(deps, user, caseId, 'FULL');
  const content = await decryptContent(deps, caseId);
  // Complaint text is shown only while it still matches its on-chain hash.
  const contentIntact = contentHashOf(content.title, content.description) === c.contentHash;
  const people = await usernamesByFabricId(deps, [c.investigator?.id, ...c.approvals.map((a) => a.signer)].filter((x): x is string => !!x));
  const ai = (await deps.pool.query('select category_probs, entities, risk_explanation, model_versions from case_ai where case_id = $1', [caseId])).rows[0] ?? null;
  const finding = (await deps.pool.query('select body_enc, outcome, created_at from findings where case_id = $1 order by created_at desc limit 1', [caseId])).rows[0];
  return {
    ...summary,
    view: 'FULL' as const,
    title: contentIntact ? content.title : null,
    description: contentIntact ? content.description : null,
    integrity: { contentIntact },
    assetRefs: c.assetRefs,
    locationRef: c.locationRef,
    riskScore: c.riskScore,
    investigator: c.investigator ? people.get(c.investigator.id) ?? { id: null, username: c.investigator.id } : null,
    coi: c.coi,
    approvals: c.approvals.map((a) => ({ role: a.role, at: a.at, signer: people.get(a.signer)?.username ?? a.signer })),
    relatedCaseIds: c.relatedCaseIds,
    linkedEventIds: c.linkedEventIds,
    duplicateOf: c.duplicateOf,
    findingsOutcome: c.outcome,
    findings: finding ? { body: JSON.parse(openString(finding.body_enc, deps.cfg.AEGIS_KEK)), createdAt: finding.created_at } : null,
    ai: ai ? { categoryProbs: ai.category_probs, entities: ai.entities, explanation: ai.risk_explanation, modelVersions: ai.model_versions } : null,
  };
}

export const listQuerySchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assigned: z.enum(['me']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

export async function listCases(deps: AppDeps, user: AuthUser, q: z.infer<typeof listQuerySchema>) {
  const where = [`c.status <> 'PENDING_LEDGER'`];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
  if (user.role === 'COMPLAINANT') add('p.user_id = ?', user.id);
  else if (user.role === 'STORE_OFFICER') add('c.depot_id = ?', user.depot);
  else if (user.role === 'ADMIN' || user.role === 'SYSTEM') return [];
  if (q.assigned === 'me') add('c.investigator_user_id = ?', user.id);
  if (q.status) add('c.status = any(?)', q.status.split(','));
  if (q.category) add('c.category = ?', q.category);
  if (q.risk) add('c.risk_level = ?', q.risk);
  if (q.before) add('c.created_at < ?', q.before);
  args.push(q.limit);
  const { rows } = await deps.pool.query(
    `select c.case_id as "caseId", c.status, c.category, c.risk_level as "riskLevel", c.risk_score as "riskScore", c.sla_due_at as "slaDueAt",
            c.escalation_level as "escalationLevel", c.depot_id as "depot", c.outcome, c.triage_status as "triageStatus", c.created_at as "createdAt"
     from cases c join pseudonyms p on p.case_id = c.case_id
     where ${where.join(' and ')} order by c.created_at desc, c.case_id desc limit $${args.length}`, args);
  return rows;
}

export async function caseHistory(deps: AppDeps, user: AuthUser, caseId: string) {
  return deps.ledger.evaluate(await loadLedgerUser(deps, user.id), 'complaint:getCaseHistory', [caseId]);
}
