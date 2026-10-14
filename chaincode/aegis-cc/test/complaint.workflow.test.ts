import { beforeEach, describe, expect, it } from 'vitest';
import { actor } from './fakeContext';
import { at, h, Harness, people, T0 } from './harness';

const ID = 'CASE-2026-000001';
let x: Harness;
beforeEach(() => { x = new Harness(); });

describe('assignment and COI', () => {
  it('assign blocked by R4 when investigator depot equals case depot', async () => {
    await x.triaged();
    await expect(x.assign(ID, actor('INVESTIGATOR', { id: 'x509::inv3', depot: 'DEP-02' }))).rejects.toThrow('COI_VIOLATION: R4');
  });

  it('assign blocked by R2 when a linked event actorUnit equals investigator unit', async () => {
    await x.triaged();
    await x.event('EVT-000001', 'U4', 'PER-999', at(-24));
    await x.cc.linkLifecycleEvents(x.ctx(people.store), ID, '["EVT-000001"]');
    await expect(x.assign(ID, people.inv)).rejects.toThrow('COI_VIOLATION: R2');
  });

  it('assign blocked by R3 only within 90 days', async () => {
    await x.triaged();
    await x.event('EVT-000001', 'U1', people.inv.pseudo, at(-100 * 24));
    await x.cc.linkLifecycleEvents(x.ctx(people.store), ID, '["EVT-000001"]');
    expect((await x.assign(ID, people.inv)).coi?.passed).toBe(true);

    const y = new Harness();
    await y.triaged();
    await y.event('EVT-000001', 'U1', people.inv.pseudo, at(-10 * 24));
    await y.cc.linkLifecycleEvents(y.ctx(people.store), ID, '["EVT-000001"]');
    await expect(y.assign(ID, people.inv)).rejects.toThrow('COI_VIOLATION: R3');
  });

  it('accept by a different investigator -> FORBIDDEN', async () => {
    await x.triaged();
    await x.assign(ID, people.inv);
    await expect(x.cc.acceptAssignment(x.ctx(people.inv2), ID)).rejects.toThrow(/^FORBIDDEN/);
  });

  it('accept re-checks COI using caller cert attributes', async () => {
    await x.triaged();
    await x.assign(ID, people.inv); // API claimed depot NONE
    const realInv = { ...people.inv, depot: 'DEP-02' }; // the certificate says otherwise
    await expect(x.cc.acceptAssignment(x.ctx(realInv), ID)).rejects.toThrow('COI_VIOLATION: R4');
  });
});

describe('findings and closure', () => {
  it('investigator cannot approve own findings', async () => {
    await x.underReview();
    const asReviewer = { ...people.inv, role: 'REVIEW_BOARD' as const };
    await expect(x.approve(ID, asReviewer)).rejects.toThrow(/^INELIGIBLE_APPROVER/);
  });

  it('stale findings hash -> STALE_FINDINGS', async () => {
    await x.underReview();
    await expect(x.approve(ID, people.so, T0, h('old'))).rejects.toThrow(/^STALE_FINDINGS/);
  });

  it('same signer twice -> DUPLICATE_APPROVAL', async () => {
    await x.underReview(ID, '0.7');
    await x.approve(ID, people.rb1);
    await expect(x.approve(ID, people.rb1)).rejects.toThrow(/^DUPLICATE_APPROVAL/);
  });

  it('MEDIUM closes after SO + RB', async () => {
    await x.underReview(ID, '0.5');
    expect((await x.approve(ID, people.so)).status).toBe('FINDINGS_SUBMITTED');
    const c = await x.approve(ID, people.rb1);
    expect(c.status).toBe('CLOSED');
    expect(c.closureApprovers).toEqual([people.so.id, people.rb1.id]);
  });

  it('HIGH stays open until a second distinct RB', async () => {
    await x.underReview(ID, '0.7');
    await x.approve(ID, people.so);
    expect((await x.approve(ID, people.rb1)).status).toBe('FINDINGS_SUBMITTED');
    expect((await x.approve(ID, people.rb2)).status).toBe('CLOSED');
  });

  it('REJECT returns to UNDER_INVESTIGATION and clears approvals', async () => {
    await x.underReview();
    await x.approve(ID, people.so);
    const c = JSON.parse(await x.cc.recordApproval(x.ctx(people.rb1), ID, 'REJECT', h('findings')));
    expect(c).toMatchObject({ status: 'UNDER_INVESTIGATION', approvals: [] });
  });
});

describe('appeals and SLA', () => {
  async function closedMedium() {
    await x.underReview(ID, '0.5');
    await x.approve(ID, people.so);
    await x.approve(ID, people.rb1);
  }

  it('complainant appeals within 14 days', async () => {
    await closedMedium();
    const c = JSON.parse(await x.cc.fileAppeal(x.ctx(people.comp, at(24)), ID, h('reason')));
    expect(c.status).toBe('APPEALED');
  });

  it('a different complainant cannot appeal', async () => {
    await closedMedium();
    await expect(x.cc.fileAppeal(x.ctx(people.comp2, at(24)), ID, h('reason'))).rejects.toThrow(/^FORBIDDEN/);
  });

  it('appeal after 15 days -> APPEAL_WINDOW_CLOSED', async () => {
    await closedMedium();
    await expect(x.cc.fileAppeal(x.ctx(people.comp, at(15 * 24)), ID, h('reason'))).rejects.toThrow(/^APPEAL_WINDOW_CLOSED/);
  });

  it('original approver cannot decide appeal; another board member can', async () => {
    await closedMedium();
    await x.cc.fileAppeal(x.ctx(people.comp, at(1)), ID, h('reason'));
    await expect(x.cc.decideAppeal(x.ctx(people.rb1, at(2)), ID, 'false', h('d'))).rejects.toThrow(/^INELIGIBLE_APPROVER/);
    const c = JSON.parse(await x.cc.decideAppeal(x.ctx(people.rb3, at(2)), ID, 'false', h('d')));
    expect(c.status).toBe('CLOSED_FINAL');
  });

  it('accepted appeal reopens review with approvals cleared', async () => {
    await closedMedium();
    await x.cc.fileAppeal(x.ctx(people.comp, at(1)), ID, h('reason'));
    const c = JSON.parse(await x.cc.decideAppeal(x.ctx(people.rb3, at(2)), ID, 'true', h('d')));
    expect(c).toMatchObject({ status: 'FINDINGS_SUBMITTED', approvals: [] });
  });

  it('checkSla escalates HIGH case 13h overdue to level 2 and emits CaseEscalated', async () => {
    await x.triaged(ID, '0.7');
    const c = JSON.parse(await x.cc.checkSla(x.ctx(people.sys, at(24 + 13)), ID));
    expect(c.escalationLevel).toBe(2);
    expect(x.world.events.at(-1)).toMatchObject({ name: 'CaseEscalated', payload: { caseId: ID, escalationLevel: 2 } });
  });

  it('checkSla does not write when nothing changed', async () => {
    await x.triaged(ID, '0.7');
    const before = x.world.history.size + [...x.world.history.values()].flat().length;
    await x.cc.checkSla(x.ctx(people.sys, at(1)), ID);
    expect(x.world.history.size + [...x.world.history.values()].flat().length).toBe(before);
  });

  it('checkSla finalises CLOSED case after 14 days', async () => {
    await closedMedium();
    const c = JSON.parse(await x.cc.checkSla(x.ctx(people.sys, at(14 * 24 + 1)), ID));
    expect(c.status).toBe('CLOSED_FINAL');
  });
});
