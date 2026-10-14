import { createHash } from 'crypto';
import { ComplaintContract } from '../src/complaint';
import { LifecycleContract } from '../src/lifecycle';
import { Actor, CaseRecord } from '../src/types';
import { actor, ctxFor, FakeWorld, newWorld } from './fakeContext';

export const h = (s: string) => createHash('sha256').update(s).digest('hex');
export const T0 = new Date('2026-10-14T09:00:00Z');
export const at = (hours: number) => new Date(T0.getTime() + hours * 3600e3);

export const people = {
  comp: actor('COMPLAINANT', { id: 'x509::comp1', depot: 'DEP-02', unit: 'U2' }),
  comp2: actor('COMPLAINANT', { id: 'x509::comp2', depot: 'DEP-02', unit: 'U2' }),
  store: actor('STORE_OFFICER', { id: 'x509::store1', depot: 'DEP-02', unit: 'U3' }),
  inv: actor('INVESTIGATOR', { id: 'x509::inv1', unit: 'U4', pseudo: 'PER-201' }),
  inv2: actor('INVESTIGATOR', { id: 'x509::inv2', unit: 'U5', pseudo: 'PER-202' }),
  so: actor('SAFETY_OFFICER', { id: 'x509::safety1', unit: 'U5' }),
  rb1: actor('REVIEW_BOARD', { id: 'x509::board1', unit: 'U6' }),
  rb2: actor('REVIEW_BOARD', { id: 'x509::board2', unit: 'U6' }),
  rb3: actor('REVIEW_BOARD', { id: 'x509::board3', unit: 'U6' }),
  sys: actor('SYSTEM', { id: 'x509::system', unit: 'U6' }),
  auditor: actor('AUDITOR', { id: 'x509::audit1', unit: 'U6' }),
};

export class Harness {
  world: FakeWorld = newWorld();
  cc = new ComplaintContract();
  lc = new LifecycleContract();

  ctx(a: Actor, time: Date = T0) {
    return ctxFor(this.world, a, { time });
  }

  async register(caseId = 'CASE-2026-000001', who: Actor = people.comp, time = T0): Promise<CaseRecord> {
    return JSON.parse(await this.cc.registerCase(this.ctx(who, time), caseId, 'PSN-0123456789ab', h('content'),
      JSON.stringify(['LOT-B03-2025-0117']), 'DEP-02/MAG-01/BAY-04'));
  }

  async triaged(caseId = 'CASE-2026-000001', score = '0.5', time = T0): Promise<CaseRecord> {
    await this.register(caseId, people.comp, time);
    return JSON.parse(await this.cc.triage(this.ctx(people.sys, time), caseId, 'STORAGE_ENVIRONMENT', score, h('ai'), '[]'));
  }

  async event(eventId: string, actorUnit: string, actorPseudo: string, occurredAt: Date, type = 'STORAGE_MOVE') {
    return this.lc.recordEvent(this.ctx(people.sys), eventId, 'LOT-B03-2025-0117', type, '', 'DEP-02/MAG-01/BAY-04', '10',
      actorPseudo, actorUnit, occurredAt.toISOString(), h(eventId));
  }

  async assign(caseId: string, inv: Actor, time = T0): Promise<CaseRecord> {
    return JSON.parse(await this.cc.assignInvestigator(this.ctx(people.so, time), caseId, inv.id, inv.unit, inv.depot, inv.pseudo));
  }

  /** Triaged at T0 with given score, assigned to inv1, accepted, findings submitted. */
  async underReview(caseId = 'CASE-2026-000001', score = '0.5'): Promise<CaseRecord> {
    await this.triaged(caseId, score);
    await this.assign(caseId, people.inv);
    await this.cc.acceptAssignment(this.ctx(people.inv), caseId);
    return JSON.parse(await this.cc.submitFindings(this.ctx(people.inv), caseId, h('findings'), 'SUBSTANTIATED'));
  }

  async approve(caseId: string, who: Actor, time = T0, hash = h('findings')): Promise<CaseRecord> {
    return JSON.parse(await this.cc.recordApproval(this.ctx(who, time), caseId, 'APPROVE', hash));
  }
}
