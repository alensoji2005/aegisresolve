import { describe, expect, it } from 'vitest';
import { type Action, authorize, type AuthUser, type CaseFacts } from '../src/auth/authorize.js';

const u = (role: AuthUser['role'], depot = 'NONE', id = role): AuthUser => ({ id, username: id, role, unit: 'U1', depot, pseudo: '' });
const c = (over: Partial<CaseFacts> = {}): CaseFacts => ({ depot: 'DEP-02', investigatorUserId: 'inv-a', ownedByUser: false, ...over });

const cases: [string, AuthUser, Action, CaseFacts | undefined, boolean][] = [
  ['complainant creates', u('COMPLAINANT'), 'case:create', undefined, true],
  ['investigator cannot create', u('INVESTIGATOR'), 'case:create', undefined, false],
  ['owner reads summary', u('COMPLAINANT'), 'case:read:summary', c({ ownedByUser: true }), true],
  ['other complainant cannot read', u('COMPLAINANT'), 'case:read:summary', c(), false],
  ['same-depot store officer reads summary', u('STORE_OFFICER', 'DEP-02'), 'case:read:summary', c(), true],
  ['other-depot store officer cannot', u('STORE_OFFICER', 'DEP-01'), 'case:read:summary', c(), false],
  ['assigned investigator reads full', u('INVESTIGATOR', 'NONE', 'inv-a'), 'case:read:full', c(), true],
  ['unassigned investigator no full', u('INVESTIGATOR', 'NONE', 'inv-b'), 'case:read:full', c(), false],
  ['complainant never full', u('COMPLAINANT'), 'case:read:full', c({ ownedByUser: true }), false],
  ['owner uploads evidence', u('COMPLAINANT'), 'evidence:upload', c({ ownedByUser: true }), true],
  ['auditor cannot upload', u('AUDITOR'), 'evidence:upload', c(), false],
  ['safety officer downloads', u('SAFETY_OFFICER'), 'evidence:read', c(), true],
  ['auditor cannot download', u('AUDITOR'), 'evidence:read', c(), false],
  ['auditor verifies', u('AUDITOR'), 'evidence:verify', c(), true],
  ['board assigns', u('REVIEW_BOARD'), 'case:assign', undefined, true],
  ['investigator cannot assign', u('INVESTIGATOR'), 'case:assign', undefined, false],
  ['safety officer reviews', u('SAFETY_OFFICER'), 'case:review', undefined, true],
  ['admin cannot review', u('ADMIN'), 'case:review', undefined, false],
  ['auditor reads audit', u('AUDITOR'), 'audit:read', undefined, true],
  ['investigator no audit', u('INVESTIGATOR'), 'audit:read', undefined, false],
  ['admin manages users', u('ADMIN'), 'user:admin', undefined, true],
  ['board cannot manage users', u('REVIEW_BOARD'), 'user:admin', undefined, false],
];

describe('authorize matrix', () => {
  it.each(cases)('%s', (_n, user, action, facts, expected) => expect(authorize(user, action, facts)).toBe(expected));
});
