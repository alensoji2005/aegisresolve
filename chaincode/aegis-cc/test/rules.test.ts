import { describe, expect, it } from 'vitest';
import { assertTransition, checkCoi, CoiInput, escalationLevel, quorumMet, riskLevelFromScore } from '../src/rules';
import { Approval } from '../src/types';

const base: CoiInput = {
  investigatorCertHash: 'a', complainantCertHash: 'b', investigatorUnit: 'U4', investigatorDepot: 'NONE',
  investigatorPseudo: 'PER-1', caseDepot: 'DEP-02', implicatedUnits: ['U1'], recentActorPseudos: ['PER-9'],
};
const ap = (signer: string, role: Approval['role']): Approval => ({ signer, role, decision: 'APPROVE', findingsHash: 'h', at: 't' });
const so = ap('so', 'SAFETY_OFFICER');
const rb1 = ap('rb1', 'REVIEW_BOARD');
const rb2 = ap('rb2', 'REVIEW_BOARD');

describe('rules', () => {
  it('rejects CLOSED -> ASSIGNED', () => expect(() => assertTransition('CLOSED', 'ASSIGNED')).toThrow(/^INVALID_TRANSITION/));
  it('allows FINDINGS_SUBMITTED -> CLOSED', () => expect(() => assertTransition('FINDINGS_SUBMITTED', 'CLOSED')).not.toThrow());

  it.each([[0.34, 'LOW'], [0.35, 'MEDIUM'], [0.59, 'MEDIUM'], [0.6, 'HIGH'], [0.8, 'CRITICAL']])('risk %s -> %s', (s, l) =>
    expect(riskLevelFromScore(s as number)).toBe(l));

  it('flags R1 and R4 together', () =>
    expect(checkCoi({ ...base, investigatorCertHash: 'h', complainantCertHash: 'h', investigatorDepot: 'DEP-02' }).violations).toEqual(['R1', 'R4']));
  it('flags R2 and R3', () =>
    expect(checkCoi({ ...base, investigatorUnit: 'U1', investigatorPseudo: 'PER-9' }).violations).toEqual(['R2', 'R3']));
  it('passes a clean investigator', () =>
    expect(checkCoi(base)).toEqual({ passed: true, violations: [], rulesEvaluated: ['R1', 'R2', 'R3', 'R4'] }));

  it('HIGH quorum needs two distinct board signers', () => {
    expect(quorumMet('HIGH', [so, rb1, { ...rb1 }])).toBe(false);
    expect(quorumMet('HIGH', [so, rb1, rb2])).toBe(true);
  });
  it('MEDIUM quorum is SO + RB', () => {
    expect(quorumMet('MEDIUM', [so])).toBe(false);
    expect(quorumMet('MEDIUM', [rb1, so])).toBe(true);
  });

  const due = new Date('2026-10-14T00:00:00Z');
  it.each([[-1, 0], [1, 1], [13, 2], [24, 3]])('overdue %sh on 24h SLA -> level %s', (h, lvl) =>
    expect(escalationLevel(new Date(due.getTime() + (h as number) * 3600e3), due, 24)).toBe(lvl));
});
