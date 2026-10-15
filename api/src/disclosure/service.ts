import { randomUUID } from 'node:crypto';
import { type Disclosure, disclosureActive } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import type { AuthUser } from '../auth/authorize.js';
import { openString, sealString, sha256Hex } from '../crypto.js';
import { recordAccess } from '../cases/service.js';
import { ApiError, notFound } from '../errors.js';
import { loadLedgerUser } from '../users/service.js';

const GRANTEE_ROLES = ['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'];

async function ledgerGrants(deps: AppDeps, user: AuthUser, caseId: string): Promise<Disclosure[]> {
  return deps.ledger.evaluate<Disclosure[]>(await loadLedgerUser(deps, user.id), 'complaint:getDisclosures', [caseId]);
}

/** The user's active grants on a case, read from the ledger (not the database) so they cannot be forged by a DB edit. */
export async function activeGrants(deps: AppDeps, user: AuthUser, caseId: string): Promise<{ full: boolean; identity: boolean }> {
  const { rows } = await deps.pool.query('select fabric_identity from users where id = $1', [user.id]);
  const mine = (await ledgerGrants(deps, user, caseId)).filter((d) => d.grantee === rows[0]?.fabric_identity && disclosureActive(d, deps.now()));
  return { full: mine.some((d) => d.scope === 'FULL'), identity: mine.some((d) => d.scope === 'IDENTITY') };
}

export async function listGrants(deps: AppDeps, user: AuthUser, caseId: string) {
  const grants = await ledgerGrants(deps, user, caseId);
  const ids = [...new Set(grants.flatMap((g) => [g.grantee, g.grantedBy, g.approvedBy]).filter((x): x is string => !!x))];
  const names = new Map((await deps.pool.query('select fabric_identity, username from users where fabric_identity = any($1)', [ids])).rows
    .map((r) => [r.fabric_identity, r.username]));
  const reasons = new Map((await deps.pool.query('select grant_id::text, reason_enc from disclosure_reasons where case_id = $1', [caseId])).rows
    .map((r) => [r.grant_id, openString(r.reason_enc, deps.cfg.AEGIS_KEK)]));
  return grants.map((g) => ({
    grantId: g.grantId, scope: g.scope, grantee: names.get(g.grantee) ?? g.grantee, grantedBy: names.get(g.grantedBy) ?? g.grantedBy,
    approvedBy: g.approvedBy ? names.get(g.approvedBy) ?? g.approvedBy : null, expiresAt: g.expiresAt, revoked: g.revoked,
    active: disclosureActive(g, deps.now()), awaitingApproval: !g.revoked && !g.approvedBy, reason: reasons.get(g.grantId) ?? null,
    reasonVerified: reasons.has(g.grantId) ? sha256Hex(reasons.get(g.grantId)!) === g.reasonHash : false,
  }));
}

export async function createGrant(deps: AppDeps, user: AuthUser, caseId: string, input: { granteeUserId: string; scope: 'FULL' | 'IDENTITY'; reason: string; hours: number }) {
  const { rows } = await deps.pool.query('select fabric_identity, role from users where id = $1 and active', [input.granteeUserId]);
  if (!rows[0]) throw notFound('grantee');
  if (!GRANTEE_ROLES.includes(rows[0].role)) throw new ApiError(400, 'INVALID_ARG', 'disclosure can only be granted to oversight staff');
  const grantId = randomUUID();
  const expiresAt = new Date(deps.now().getTime() + input.hours * 3600e3).toISOString();
  const { txId } = await deps.ledger.submit(await loadLedgerUser(deps, user.id), 'complaint:grantDisclosure',
    [caseId, grantId, rows[0].fabric_identity, input.scope, sha256Hex(input.reason), expiresAt]);
  await deps.pool.query('insert into disclosure_reasons(grant_id, case_id, reason_enc) values ($1,$2,$3)', [grantId, caseId, sealString(input.reason, deps.cfg.AEGIS_KEK)]);
  return { grantId, txId, expiresAt };
}

export async function changeGrant(deps: AppDeps, user: AuthUser, caseId: string, grantId: string, action: 'approve' | 'revoke') {
  const fn = action === 'approve' ? 'complaint:approveDisclosure' : 'complaint:revokeDisclosure';
  const { txId } = await deps.ledger.submit(await loadLedgerUser(deps, user.id), fn, [caseId, grantId]);
  return { grantId, txId };
}

/** Complainant identity, only with an active IDENTITY grant. Every reveal is logged on-chain. */
export async function revealIdentity(deps: AppDeps, user: AuthUser, caseId: string) {
  if (!(await activeGrants(deps, user, caseId)).identity) throw new ApiError(403, 'FORBIDDEN', 'an approved identity disclosure grant is required');
  const { rows } = await deps.pool.query(
    'select u.username, u.unit_id as unit, u.depot_id as depot from pseudonyms p join users u on u.id = p.user_id where p.case_id = $1', [caseId]);
  if (!rows[0]) throw notFound('complainant');
  await recordAccess(deps, user, caseId, 'IDENTITY');
  return rows[0];
}
