import { Context, Contract, Info, Transaction } from 'fabric-contract-api';
import {
  actorOf, certHash, check, fail, getJson, key, listByPrefix, parseJsonArray, putJson, RE, requireRole, txTime,
} from './ctxutil';
import { addHours, assertTransition, checkCoi, escalationLevel, POLICY, quorumMet, riskLevelFromScore, TERMINAL } from './rules';
import {
  AccessEntry, Actor, CaseRecord, CaseStatus, CATEGORIES, Category, CoiResult, EvidenceAnchor, LifecycleEvent, Outcome, OUTCOMES,
} from './types';

const DAY = 24 * 3600e3;

async function loadCase(ctx: Context, caseId: string): Promise<CaseRecord> {
  check(RE.caseId.test(caseId), 'caseId');
  const c = await getJson<CaseRecord>(ctx, 'CASE', [caseId]);
  if (!c) fail('NOT_FOUND', caseId);
  return c;
}

function assertOpen(c: CaseRecord): void {
  if (TERMINAL.includes(c.status)) fail('INVALID_TRANSITION', `${c.caseId} is ${c.status}`);
}

function move(c: CaseRecord, to: CaseStatus): void {
  assertTransition(c.status, to);
  c.status = to;
}

async function saveCase(ctx: Context, c: CaseRecord, actor: Actor, eventName = 'CaseUpdated'): Promise<string> {
  c.updatedAt = txTime(ctx).toISOString();
  c.updatedBy = `${actor.role}:${actor.id}`;
  c.version += 1;
  await putJson(ctx, 'CASE', [c.caseId], c);
  ctx.stub.setEvent(eventName, Buffer.from(JSON.stringify({
    caseId: c.caseId, status: c.status, escalationLevel: c.escalationLevel, txId: ctx.stub.getTxID(),
  })));
  return JSON.stringify(c);
}

async function coiFor(ctx: Context, c: CaseRecord, inv: Omit<Actor, 'role'>): Promise<CoiResult> {
  const cutoff = txTime(ctx).getTime() - POLICY.custodyLookbackDays * DAY;
  const events = (await Promise.all(c.linkedEventIds.map((id) => getJson<LifecycleEvent>(ctx, 'EVT', [id]))))
    .filter((e): e is LifecycleEvent => e !== null);
  return checkCoi({
    investigatorCertHash: certHash(inv.id, c.caseSalt),
    complainantCertHash: c.complainantCertHash,
    investigatorUnit: inv.unit,
    investigatorDepot: inv.depot,
    investigatorPseudo: inv.pseudo,
    caseDepot: c.depot,
    implicatedUnits: events.map((e) => e.actorUnit),
    recentActorPseudos: events.filter((e) => Date.parse(e.occurredAt) >= cutoff).map((e) => e.actorPseudo),
  });
}

function requireAssignedInvestigator(ctx: Context, c: CaseRecord): Actor {
  const actor = requireRole(ctx, 'INVESTIGATOR');
  if (!c.investigator || c.investigator.id !== actor.id) fail('FORBIDDEN', 'not the assigned investigator');
  return actor;
}

@Info({ title: 'ComplaintContract', description: 'AegisResolve complaint case lifecycle' })
export class ComplaintContract extends Contract {
  constructor() {
    super('complaint');
  }

  @Transaction(false)
  async ping(_ctx: Context): Promise<string> {
    return 'pong';
  }

  @Transaction()
  async registerCase(ctx: Context, caseId: string, pseudonym: string, contentHash: string, assetRefsJson: string, locationRef: string): Promise<string> {
    const actor = requireRole(ctx, 'COMPLAINANT', 'STORE_OFFICER');
    check(RE.caseId.test(caseId), 'caseId');
    check(RE.pseudonym.test(pseudonym), 'pseudonym');
    check(RE.hash.test(contentHash), 'contentHash');
    check(RE.location.test(locationRef), 'locationRef');
    const assetRefs = parseJsonArray(assetRefsJson, 'assetRefs', RE.lot);
    check(assetRefs.length <= 10, 'assetRefs');
    if (await getJson(ctx, 'CASE', [caseId])) fail('ALREADY_EXISTS', caseId);
    const now = txTime(ctx);
    const salt = ctx.stub.getTxID();
    const c: CaseRecord = {
      docType: 'case', caseId, complainantPseudonym: pseudonym, complainantCertHash: certHash(actor.id, salt), caseSalt: salt,
      status: 'SUBMITTED', category: null, riskScore: null, riskLevel: null, assetRefs: [...new Set(assetRefs)], locationRef,
      depot: locationRef.slice(0, 6), linkedEventIds: [], relatedCaseIds: [], duplicateOf: null, contentHash, aiResultHash: null,
      investigator: null, coi: null, findingsHash: null, outcome: null, approvals: [], closureApprovers: [],
      slaDueAt: addHours(now, POLICY.untriagedSlaHours), escalationLevel: 0, closedAt: null, appealReasonHash: null,
      appealDecisionHash: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: '', version: 0,
    };
    return saveCase(ctx, c, actor, 'CaseRegistered');
  }

  @Transaction()
  async anchorEvidence(ctx: Context, evidenceId: string, caseId: string, sha256Plain: string, sha3Plain: string,
    sha256Cipher: string, mimeType: string, sizeBytes: string): Promise<string> {
    const actor = requireRole(ctx, 'COMPLAINANT', 'STORE_OFFICER', 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD');
    check(RE.uuid.test(evidenceId), 'evidenceId');
    for (const [n, h] of [['sha256Plain', sha256Plain], ['sha3Plain', sha3Plain], ['sha256Cipher', sha256Cipher]]) check(RE.hash.test(h), n);
    check(mimeType.length > 0 && mimeType.length <= 100, 'mimeType');
    const size = Number(sizeBytes);
    check(Number.isInteger(size) && size >= 0, 'sizeBytes');
    assertOpen(await loadCase(ctx, caseId));
    if (await getJson(ctx, 'EVID', [evidenceId])) fail('ALREADY_EXISTS', evidenceId);
    const anchor: EvidenceAnchor = {
      docType: 'evidence', evidenceId, caseId, sha256Plain, sha3Plain, sha256Cipher, mimeType, sizeBytes: size,
      anchoredBy: `${actor.role}:${actor.id}`, anchoredAt: txTime(ctx).toISOString(),
    };
    await putJson(ctx, 'EVID', [evidenceId], anchor);
    ctx.stub.setEvent('EvidenceAnchored', Buffer.from(JSON.stringify({ caseId, evidenceId })));
    return JSON.stringify(anchor);
  }

  @Transaction()
  async triage(ctx: Context, caseId: string, category: string, riskScore: string, aiResultHash: string, relatedCaseIdsJson: string): Promise<string> {
    const actor = requireRole(ctx, 'SYSTEM');
    check(CATEGORIES.includes(category as Category), 'category');
    const score = Number(riskScore);
    check(Number.isFinite(score) && score >= 0 && score <= 1, 'riskScore');
    check(RE.hash.test(aiResultHash), 'aiResultHash');
    const related = parseJsonArray(relatedCaseIdsJson, 'relatedCaseIds', RE.caseId);
    const c = await loadCase(ctx, caseId);
    move(c, 'TRIAGED');
    c.category = category as Category;
    c.riskScore = score;
    c.riskLevel = riskLevelFromScore(score);
    c.aiResultHash = aiResultHash;
    c.relatedCaseIds = [...new Set([...c.relatedCaseIds, ...related])].filter((id) => id !== caseId);
    c.slaDueAt = addHours(txTime(ctx), POLICY.slaHours[c.riskLevel]);
    c.escalationLevel = 0;
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async markDuplicate(ctx: Context, caseId: string, ofCaseId: string): Promise<string> {
    const actor = requireRole(ctx, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD');
    check(caseId !== ofCaseId, 'ofCaseId');
    const target = await loadCase(ctx, ofCaseId);
    assertOpen(target);
    const c = await loadCase(ctx, caseId);
    move(c, 'MERGED_DUPLICATE');
    c.duplicateOf = ofCaseId;
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async linkRelated(ctx: Context, caseId: string, otherId: string): Promise<string> {
    const actor = requireRole(ctx, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD');
    check(caseId !== otherId, 'otherId');
    const c = await loadCase(ctx, caseId);
    const o = await loadCase(ctx, otherId);
    if (!o.relatedCaseIds.includes(caseId)) {
      o.relatedCaseIds.push(caseId);
      await saveCase(ctx, o, actor);
    }
    if (!c.relatedCaseIds.includes(otherId)) c.relatedCaseIds.push(otherId);
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async linkLifecycleEvents(ctx: Context, caseId: string, eventIdsJson: string): Promise<string> {
    const actor = requireRole(ctx, 'INVESTIGATOR', 'STORE_OFFICER');
    const ids = parseJsonArray(eventIdsJson, 'eventIds', RE.event);
    const c = await loadCase(ctx, caseId);
    assertOpen(c);
    for (const id of ids) if (!(await getJson(ctx, 'EVT', [id]))) fail('NOT_FOUND', id);
    c.linkedEventIds = [...new Set([...c.linkedEventIds, ...ids])];
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async assignInvestigator(ctx: Context, caseId: string, investigatorId: string, unit: string, depot: string, pseudo: string): Promise<string> {
    const actor = requireRole(ctx, 'SAFETY_OFFICER', 'REVIEW_BOARD');
    check(investigatorId.length > 0 && unit.length > 0 && depot.length > 0 && pseudo.length > 0, 'investigator');
    const c = await loadCase(ctx, caseId);
    move(c, 'ASSIGNED');
    const inv = { id: investigatorId, unit, depot, pseudo };
    const coi = await coiFor(ctx, c, inv);
    if (!coi.passed) fail('COI_VIOLATION', coi.violations.join(','));
    c.investigator = inv;
    c.coi = coi;
    return saveCase(ctx, c, actor);
  }

  /** Re-runs COI with the investigator's own certificate attributes, so a misreporting API cannot bypass the check. */
  @Transaction()
  async acceptAssignment(ctx: Context, caseId: string): Promise<string> {
    const c = await loadCase(ctx, caseId);
    const actor = requireAssignedInvestigator(ctx, c);
    const self = { id: actor.id, unit: actor.unit, depot: actor.depot, pseudo: actor.pseudo };
    const coi = await coiFor(ctx, c, self);
    if (!coi.passed) fail('COI_VIOLATION', coi.violations.join(','));
    move(c, 'UNDER_INVESTIGATION');
    c.investigator = self;
    c.coi = coi;
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async submitFindings(ctx: Context, caseId: string, findingsHash: string, outcome: string): Promise<string> {
    const c = await loadCase(ctx, caseId);
    const actor = requireAssignedInvestigator(ctx, c);
    check(RE.hash.test(findingsHash), 'findingsHash');
    check(OUTCOMES.includes(outcome as Outcome), 'outcome');
    move(c, 'FINDINGS_SUBMITTED');
    c.findingsHash = findingsHash;
    c.outcome = outcome as Outcome;
    c.approvals = [];
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async recordApproval(ctx: Context, caseId: string, decision: string, findingsHash: string): Promise<string> {
    const actor = requireRole(ctx, 'SAFETY_OFFICER', 'REVIEW_BOARD');
    check(decision === 'APPROVE' || decision === 'REJECT', 'decision');
    const c = await loadCase(ctx, caseId);
    if (c.status !== 'FINDINGS_SUBMITTED') fail('INVALID_TRANSITION', `${c.status} is not under review`);
    if (c.investigator?.id === actor.id || certHash(actor.id, c.caseSalt) === c.complainantCertHash) fail('INELIGIBLE_APPROVER');
    if (findingsHash !== c.findingsHash) fail('STALE_FINDINGS');
    if (decision === 'REJECT') {
      move(c, 'UNDER_INVESTIGATION');
      c.approvals = [];
      return saveCase(ctx, c, actor);
    }
    if (c.approvals.some((a) => a.signer === actor.id)) fail('DUPLICATE_APPROVAL');
    const now = txTime(ctx);
    c.approvals.push({ signer: actor.id, role: actor.role, decision: 'APPROVE', findingsHash, at: now.toISOString() });
    if (quorumMet(c.riskLevel!, c.approvals)) {
      move(c, 'CLOSED');
      c.closedAt = now.toISOString();
      c.closureApprovers = c.approvals.map((a) => a.signer);
      c.slaDueAt = addHours(now, POLICY.appealWindowDays * 24);
      c.escalationLevel = 0;
    }
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async fileAppeal(ctx: Context, caseId: string, reasonHash: string): Promise<string> {
    const actor = requireRole(ctx, 'COMPLAINANT');
    check(RE.hash.test(reasonHash), 'reasonHash');
    const c = await loadCase(ctx, caseId);
    if (certHash(actor.id, c.caseSalt) !== c.complainantCertHash) fail('FORBIDDEN', 'not the complainant');
    assertTransition(c.status, 'APPEALED');
    const now = txTime(ctx);
    if (now.getTime() > Date.parse(c.closedAt!) + POLICY.appealWindowDays * DAY) fail('APPEAL_WINDOW_CLOSED');
    c.status = 'APPEALED';
    c.appealReasonHash = reasonHash;
    c.slaDueAt = addHours(now, POLICY.slaHours[c.riskLevel!]);
    c.escalationLevel = 0;
    return saveCase(ctx, c, actor);
  }

  @Transaction()
  async decideAppeal(ctx: Context, caseId: string, accept: string, reasonHash: string): Promise<string> {
    const actor = requireRole(ctx, 'REVIEW_BOARD');
    check(accept === 'true' || accept === 'false', 'accept');
    check(RE.hash.test(reasonHash), 'reasonHash');
    const c = await loadCase(ctx, caseId);
    if (c.closureApprovers.includes(actor.id)) fail('INELIGIBLE_APPROVER', 'approved the original closure');
    c.appealDecisionHash = reasonHash;
    if (accept === 'true') {
      move(c, 'FINDINGS_SUBMITTED');
      c.approvals = [];
      c.slaDueAt = addHours(txTime(ctx), POLICY.slaHours[c.riskLevel!]);
    } else {
      move(c, 'CLOSED_FINAL');
    }
    return saveCase(ctx, c, actor);
  }

  /** Driven by the off-chain scheduler; all decisions use the transaction timestamp. */
  @Transaction()
  async checkSla(ctx: Context, caseId: string): Promise<string> {
    const actor = requireRole(ctx, 'SYSTEM');
    const c = await loadCase(ctx, caseId);
    if (TERMINAL.includes(c.status)) return JSON.stringify(c);
    const now = txTime(ctx);
    const due = new Date(c.slaDueAt);
    if (c.status === 'CLOSED') {
      if (now <= due) return JSON.stringify(c);
      move(c, 'CLOSED_FINAL');
      return saveCase(ctx, c, actor);
    }
    const hours = c.riskLevel ? POLICY.slaHours[c.riskLevel] : POLICY.untriagedSlaHours;
    const level = Math.max(c.escalationLevel, escalationLevel(now, due, hours)) as CaseRecord['escalationLevel'];
    if (level === c.escalationLevel) return JSON.stringify(c);
    c.escalationLevel = level;
    return saveCase(ctx, c, actor, 'CaseEscalated');
  }

  @Transaction()
  async logAccess(ctx: Context, caseId: string, scope: string): Promise<string> {
    const actor = actorOf(ctx);
    check(scope === 'FULL' || (scope.startsWith('EVIDENCE:') && RE.uuid.test(scope.slice(9))), 'scope');
    await loadCase(ctx, caseId);
    const txId = ctx.stub.getTxID();
    const entry: AccessEntry = { docType: 'access', caseId, viewer: actor.id, role: actor.role, scope, at: txTime(ctx).toISOString(), txId };
    await putJson(ctx, 'ACCESS', [caseId, txId], entry);
    return JSON.stringify(entry);
  }

  @Transaction(false)
  async getCase(ctx: Context, caseId: string): Promise<string> {
    actorOf(ctx);
    return JSON.stringify(await loadCase(ctx, caseId));
  }

  @Transaction(false)
  async getEvidence(ctx: Context, evidenceId: string): Promise<string> {
    actorOf(ctx);
    const e = await getJson<EvidenceAnchor>(ctx, 'EVID', [evidenceId]);
    if (!e) fail('NOT_FOUND', evidenceId);
    return JSON.stringify(e);
  }

  @Transaction(false)
  async getCaseHistory(ctx: Context, caseId: string): Promise<string> {
    actorOf(ctx);
    await loadCase(ctx, caseId);
    const out: { txId: string; at: string; status: CaseStatus; actor: string; escalationLevel: number; version: number }[] = [];
    const it = await ctx.stub.getHistoryForKey(key(ctx, 'CASE', [caseId]));
    try {
      for (let r = await it.next(); !r.done; r = await it.next()) {
        const v = JSON.parse(Buffer.from(r.value.value).toString('utf8')) as CaseRecord;
        out.push({ txId: r.value.txId, at: v.updatedAt, status: v.status, actor: v.updatedBy, escalationLevel: v.escalationLevel, version: v.version });
      }
    } finally {
      await it.close();
    }
    return JSON.stringify(out.sort((a, b) => a.version - b.version));
  }

  @Transaction(false)
  async getAccessLog(ctx: Context, caseId: string): Promise<string> {
    actorOf(ctx);
    return JSON.stringify(await listByPrefix<AccessEntry>(ctx, 'ACCESS', [caseId]));
  }
}
