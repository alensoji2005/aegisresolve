export type Role =
  | 'COMPLAINANT' | 'STORE_OFFICER' | 'INVESTIGATOR' | 'SAFETY_OFFICER'
  | 'REVIEW_BOARD' | 'AUDITOR' | 'ADMIN' | 'SYSTEM';

export const ROLES: Role[] = [
  'COMPLAINANT', 'STORE_OFFICER', 'INVESTIGATOR', 'SAFETY_OFFICER',
  'REVIEW_BOARD', 'AUDITOR', 'ADMIN', 'SYSTEM',
];

export type CaseStatus =
  | 'SUBMITTED' | 'TRIAGED' | 'ASSIGNED' | 'UNDER_INVESTIGATION' | 'FINDINGS_SUBMITTED'
  | 'CLOSED' | 'APPEALED' | 'CLOSED_FINAL' | 'MERGED_DUPLICATE';

export type Category =
  | 'INVENTORY_DISCREPANCY' | 'STORAGE_ENVIRONMENT' | 'PACKAGING_LABELLING_DEFECT'
  | 'DOCUMENTATION_CUSTODY_GAP' | 'UNAUTHORISED_ACCESS' | 'SAFETY_PROCEDURE_VIOLATION'
  | 'INSPECTION_OVERDUE' | 'TRANSPORT_HANDLING_DAMAGE' | 'FACILITY_EQUIPMENT_FAULT'
  | 'CONDUCT_PROCESS_GRIEVANCE';

export const CATEGORIES: Category[] = [
  'INVENTORY_DISCREPANCY', 'STORAGE_ENVIRONMENT', 'PACKAGING_LABELLING_DEFECT',
  'DOCUMENTATION_CUSTODY_GAP', 'UNAUTHORISED_ACCESS', 'SAFETY_PROCEDURE_VIOLATION',
  'INSPECTION_OVERDUE', 'TRANSPORT_HANDLING_DAMAGE', 'FACILITY_EQUIPMENT_FAULT',
  'CONDUCT_PROCESS_GRIEVANCE',
];

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Outcome = 'SUBSTANTIATED' | 'PARTIALLY_SUBSTANTIATED' | 'NOT_SUBSTANTIATED';
export const OUTCOMES: Outcome[] = ['SUBSTANTIATED', 'PARTIALLY_SUBSTANTIATED', 'NOT_SUBSTANTIATED'];

export type EventType =
  | 'PROCUREMENT' | 'RECEIPT' | 'INSPECTION' | 'STORAGE_MOVE' | 'ISSUE'
  | 'RETURN' | 'RECONCILIATION' | 'DISPOSAL' | 'INCIDENT';

export const EVENT_TYPES: EventType[] = [
  'PROCUREMENT', 'RECEIPT', 'INSPECTION', 'STORAGE_MOVE', 'ISSUE',
  'RETURN', 'RECONCILIATION', 'DISPOSAL', 'INCIDENT',
];

/** Identity of the transaction submitter, read from X.509 attributes. depot is 'NONE' for oversight staff. */
export interface Actor { id: string; role: Role; unit: string; depot: string; pseudo: string }

export interface Approval { signer: string; role: Role; decision: 'APPROVE'; findingsHash: string; at: string }

export type CoiRule = 'R1' | 'R2' | 'R3' | 'R4';
export interface CoiResult { passed: boolean; violations: CoiRule[]; rulesEvaluated: CoiRule[] }

export interface CaseRecord {
  docType: 'case';
  caseId: string;
  complainantPseudonym: string;
  complainantCertHash: string;
  caseSalt: string;
  status: CaseStatus;
  category: Category | null;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  assetRefs: string[];
  locationRef: string;
  depot: string;
  linkedEventIds: string[];
  relatedCaseIds: string[];
  duplicateOf: string | null;
  contentHash: string;
  aiResultHash: string | null;
  investigator: Omit<Actor, 'role'> | null;
  coi: CoiResult | null;
  findingsHash: string | null;
  outcome: Outcome | null;
  approvals: Approval[];
  closureApprovers: string[];
  slaDueAt: string;
  escalationLevel: 0 | 1 | 2 | 3;
  closedAt: string | null;
  appealReasonHash: string | null;
  appealDecisionHash: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface EvidenceAnchor {
  docType: 'evidence';
  evidenceId: string;
  caseId: string;
  sha256Plain: string;
  sha3Plain: string;
  sha256Cipher: string;
  mimeType: string;
  sizeBytes: number;
  anchoredBy: string;
  anchoredAt: string;
}

export interface LifecycleEvent {
  docType: 'event';
  eventId: string;
  assetRef: string;
  eventType: EventType;
  fromLocation: string | null;
  toLocation: string | null;
  quantity: number;
  actorPseudo: string;
  actorUnit: string;
  occurredAt: string;
  payloadHash: string;
  recordedBy: string;
}

export interface AccessEntry { docType: 'access'; caseId: string; viewer: string; role: Role; scope: string; at: string; txId: string }

export interface Disclosure {
  docType: 'disclosure';
  caseId: string;
  grantId: string;
  grantee: string;            // certificate id of the person given access
  scope: 'FULL' | 'IDENTITY';
  reasonHash: string;
  grantedBy: string;
  approvedBy: string | null;  // FULL: the granter; IDENTITY: a second, different board member
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

export function disclosureActive(d: Disclosure, now: Date): boolean {
  return !d.revoked && d.approvedBy !== null && now.getTime() < Date.parse(d.expiresAt);
}
