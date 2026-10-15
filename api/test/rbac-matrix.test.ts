/**
 * Objective 12 (security): every role against every protected endpoint over HTTP.
 * Denied roles must get 403/404 (never a success). Allowed roles must not be refused by authorisation; they may still get
 * 4xx business errors (e.g. 409 wrong state) because the fixture case is only SUBMITTED.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../../chaincode/aegis-cc/src/types.js';
import { auth, complaint, makeTestApp, multipart, PNG, type TestApp } from './helpers.js';

const ROLES = ['COMPLAINANT', 'STORE_OFFICER', 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR', 'ADMIN'] as const;
type R = (typeof ROLES)[number];

let t: TestApp;
const tokens = {} as Record<R, string>;
let caseId: string;
let eid: string;
let invId: string;

beforeAll(async () => {
  t = await makeTestApp();
  for (const role of ROLES) {
    const u = await t.user({ username: role.toLowerCase().replace('_', ''), role, unit: 'U3', depot: role === 'STORE_OFFICER' || role === 'COMPLAINANT' ? 'DEP-02' : 'NONE' });
    tokens[role] = u.token;
    if (role === 'INVESTIGATOR') invId = u.id;
  }
  caseId = (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(tokens.COMPLAINANT), payload: complaint })).json().caseId;
  const m = multipart('photo.png', PNG);
  eid = (await t.app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/evidence`, headers: { ...auth(tokens.COMPLAINANT), ...m.headers }, payload: m.payload })).json().id;
});
afterAll(() => t.stop());

interface Rule { name: string; method: 'GET' | 'POST'; url: () => string; body?: () => object; allowed: Role[]; checkAllowed?: boolean }

const RULES: Rule[] = [
  { name: 'read case', method: 'GET', url: () => `/cases/${caseId}`, allowed: ['COMPLAINANT', 'STORE_OFFICER', 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] },
  { name: 'ledger history', method: 'GET', url: () => `/cases/${caseId}/history`, allowed: ['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] },
  { name: 'AI result', method: 'GET', url: () => `/cases/${caseId}/ai`, allowed: ['SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] },
  { name: 'similar cases', method: 'GET', url: () => `/cases/${caseId}/similar`, allowed: ['SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] },
  { name: 'lifecycle', method: 'GET', url: () => `/cases/${caseId}/lifecycle`, allowed: ['STORE_OFFICER', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] },
  { name: 'evidence list', method: 'GET', url: () => `/cases/${caseId}/evidence`, allowed: ['COMPLAINANT', 'STORE_OFFICER', 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] },
  { name: 'evidence download', method: 'GET', url: () => `/cases/${caseId}/evidence/${eid}/download`, allowed: ['SAFETY_OFFICER', 'REVIEW_BOARD'] },
  { name: 'evidence verify', method: 'GET', url: () => `/cases/${caseId}/evidence/${eid}/verify`, allowed: ['SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'] },
  { name: 'audit reconcile', method: 'GET', url: () => '/audit/reconcile', allowed: ['AUDITOR', 'REVIEW_BOARD'] },
  { name: 'audit access log', method: 'GET', url: () => `/audit/access-log?caseId=${caseId}`, allowed: ['AUDITOR', 'REVIEW_BOARD'] },
  { name: 'investigator list', method: 'GET', url: () => '/investigators', allowed: ['SAFETY_OFFICER', 'REVIEW_BOARD'] },
  { name: 'create user', method: 'POST', url: () => '/admin/users', body: () => ({ username: `u${Math.random().toString(36).slice(2, 8)}`, role: 'AUDITOR', unit: 'U6' }), allowed: ['ADMIN'] },
  { name: 'file complaint', method: 'POST', url: () => '/cases', body: () => complaint, allowed: ['COMPLAINANT', 'STORE_OFFICER'] },
  { name: 'assign investigator', method: 'POST', url: () => `/cases/${caseId}/assign`, body: () => ({ investigatorUserId: invId }), allowed: ['SAFETY_OFFICER', 'REVIEW_BOARD'] },
  { name: 'review findings', method: 'POST', url: () => `/cases/${caseId}/review`, body: () => ({ decision: 'APPROVE' }), allowed: ['SAFETY_OFFICER', 'REVIEW_BOARD'] },
  { name: 'file appeal', method: 'POST', url: () => `/cases/${caseId}/appeal`, body: () => ({ reason: 'Please look at this again.' }), allowed: ['COMPLAINANT'] },
  { name: 'decide appeal', method: 'POST', url: () => `/cases/${caseId}/appeal/decide`, body: () => ({ accept: false, reason: 'No new information.' }), allowed: ['REVIEW_BOARD'] },
  // Role-permitted but only for the assigned investigator / with existing events: assert denials only.
  { name: 'accept assignment', method: 'POST', url: () => `/cases/${caseId}/accept`, allowed: ['INVESTIGATOR'], checkAllowed: false },
  { name: 'submit findings', method: 'POST', url: () => `/cases/${caseId}/findings`, body: () => ({ body: 'Findings text long enough to pass.', outcome: 'SUBSTANTIATED' }), allowed: ['INVESTIGATOR'], checkAllowed: false },
  { name: 'link lifecycle events', method: 'POST', url: () => `/cases/${caseId}/lifecycle-links`, body: () => ({ eventIds: ['EVT-000001'] }), allowed: ['INVESTIGATOR', 'STORE_OFFICER'], checkAllowed: false },
  { name: 'mark duplicate', method: 'POST', url: () => `/cases/${caseId}/duplicate`, body: () => ({ ofCaseId: 'CASE-2026-999999' }), allowed: ['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD'], checkAllowed: false },
];

const matrix = RULES.flatMap((r) => ROLES.map((role) => [r.name, role, r] as const));

describe('RBAC matrix over HTTP', () => {
  it.each(matrix)('%s as %s', async (_n, role, rule) => {
    const res = await t.app.inject({ method: rule.method, url: `/api/v1${rule.url()}`, headers: auth(tokens[role]), payload: rule.body?.() });
    if (!rule.allowed.includes(role)) {
      expect([403, 404], `${rule.name} must be refused for ${role}, got ${res.statusCode}`).toContain(res.statusCode);
    } else if (rule.checkAllowed !== false) {
      expect([401, 403, 404], `${rule.name} must be permitted for ${role}, got ${res.statusCode} ${res.body}`).not.toContain(res.statusCode);
    }
  });
});
