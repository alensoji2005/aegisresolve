import { fail } from './ctxutil';
import { Approval, CaseStatus, CoiResult, CoiRule, RiskLevel, Role } from './types';

export const POLICY = {
  slaHours: { LOW: 168, MEDIUM: 72, HIGH: 24, CRITICAL: 6 } as Record<RiskLevel, number>,
  untriagedSlaHours: 24,
  closureQuorum: {
    LOW: ['SAFETY_OFFICER'],
    MEDIUM: ['SAFETY_OFFICER', 'REVIEW_BOARD'],
    HIGH: ['SAFETY_OFFICER', 'REVIEW_BOARD', 'REVIEW_BOARD'],
    CRITICAL: ['SAFETY_OFFICER', 'REVIEW_BOARD', 'REVIEW_BOARD'],
  } as Record<RiskLevel, Role[]>,
  appealWindowDays: 14,
  custodyLookbackDays: 90,
  maxDisclosureDays: 7,
};

export const TERMINAL: CaseStatus[] = ['CLOSED_FINAL', 'MERGED_DUPLICATE'];

const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  SUBMITTED: ['TRIAGED', 'MERGED_DUPLICATE'],
  TRIAGED: ['MERGED_DUPLICATE', 'ASSIGNED'],
  ASSIGNED: ['UNDER_INVESTIGATION'],
  UNDER_INVESTIGATION: ['FINDINGS_SUBMITTED'],
  FINDINGS_SUBMITTED: ['UNDER_INVESTIGATION', 'CLOSED'],
  CLOSED: ['APPEALED', 'CLOSED_FINAL'],
  APPEALED: ['FINDINGS_SUBMITTED', 'CLOSED_FINAL'],
  CLOSED_FINAL: [],
  MERGED_DUPLICATE: [],
};

export function assertTransition(from: CaseStatus, to: CaseStatus): void {
  if (!TRANSITIONS[from].includes(to)) fail('INVALID_TRANSITION', `${from}->${to}`);
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score < 0.35) return 'LOW';
  if (score < 0.6) return 'MEDIUM';
  if (score < 0.8) return 'HIGH';
  return 'CRITICAL';
}

export interface CoiInput {
  investigatorCertHash: string;
  complainantCertHash: string;
  investigatorUnit: string;
  investigatorDepot: string;
  investigatorPseudo: string;
  caseDepot: string;
  implicatedUnits: string[];
  recentActorPseudos: string[];
}

export function checkCoi(i: CoiInput): CoiResult {
  const violations: CoiRule[] = [];
  if (i.investigatorCertHash === i.complainantCertHash) violations.push('R1');
  if (i.implicatedUnits.includes(i.investigatorUnit)) violations.push('R2');
  if (i.recentActorPseudos.includes(i.investigatorPseudo)) violations.push('R3');
  if (i.investigatorDepot === i.caseDepot) violations.push('R4');
  return { passed: violations.length === 0, violations, rulesEvaluated: ['R1', 'R2', 'R3', 'R4'] };
}

/** True when, for every role in the quorum, there are at least that many distinct signers holding it. */
export function quorumMet(level: RiskLevel, approvals: Approval[]): boolean {
  const need = new Map<Role, number>();
  for (const r of POLICY.closureQuorum[level]) need.set(r, (need.get(r) ?? 0) + 1);
  for (const [role, n] of need) {
    const signers = new Set(approvals.filter((a) => a.role === role).map((a) => a.signer));
    if (signers.size < n) return false;
  }
  return true;
}

export function escalationLevel(now: Date, slaDueAt: Date, slaHours: number): 0 | 1 | 2 | 3 {
  const overdue = now.getTime() - slaDueAt.getTime();
  const sla = slaHours * 3600e3;
  if (overdue <= 0) return 0;
  if (overdue < 0.5 * sla) return 1;
  if (overdue < sla) return 2;
  return 3;
}

export function addHours(d: Date, h: number): string {
  return new Date(d.getTime() + h * 3600e3).toISOString();
}
