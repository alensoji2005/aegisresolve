import { beforeEach, describe, expect, it } from 'vitest';
import { disclosureActive } from '../src/types';
import { at, h, Harness, people } from './harness';

const ID = 'CASE-2026-000001';
const G1 = '11111111-1111-4111-8111-111111111111';
const grant = (x: Harness, scope: string, who = people.rb1, hours = 24) =>
  x.cc.grantDisclosure(x.ctx(who), ID, G1, people.inv2.id, scope, h('reason'), at(hours).toISOString()).then(JSON.parse);

let x: Harness;
beforeEach(async () => { x = new Harness(); await x.register(); });

describe('controlled disclosure', () => {
  it('FULL grant by one board member is active immediately', async () => {
    const d = await grant(x, 'FULL');
    expect(d).toMatchObject({ grantee: people.inv2.id, approvedBy: people.rb1.id, revoked: false });
    expect(disclosureActive(d, at(1))).toBe(true);
    expect(disclosureActive(d, at(25))).toBe(false);
  });

  it('only the review board can grant, and not to themselves', async () => {
    await expect(grant(x, 'FULL', people.so)).rejects.toThrow(/^FORBIDDEN/);
    await expect(x.cc.grantDisclosure(x.ctx(people.rb1), ID, G1, people.rb1.id, 'FULL', h('r'), at(1).toISOString())).rejects.toThrow(/^INVALID_ARG/);
  });

  it('grants are capped at 7 days', async () => {
    await expect(grant(x, 'FULL', people.rb1, 8 * 24)).rejects.toThrow(/^INVALID_ARG: expiresAt/);
  });

  it('IDENTITY needs a second, different board member', async () => {
    const d = await grant(x, 'IDENTITY');
    expect(disclosureActive(d, at(1))).toBe(false);
    await expect(x.cc.approveDisclosure(x.ctx(people.rb1), ID, G1)).rejects.toThrow(/^INELIGIBLE_APPROVER/);
    const ok = JSON.parse(await x.cc.approveDisclosure(x.ctx(people.rb2), ID, G1));
    expect(disclosureActive(ok, at(1))).toBe(true);
  });

  it('revoked grants cannot be approved and are inactive', async () => {
    await grant(x, 'IDENTITY');
    const r = JSON.parse(await x.cc.revokeDisclosure(x.ctx(people.rb3), ID, G1));
    expect(disclosureActive(r, at(1))).toBe(false);
    await expect(x.cc.approveDisclosure(x.ctx(people.rb2), ID, G1)).rejects.toThrow(/^INVALID_TRANSITION/);
  });

  it('lists grants and accepts IDENTITY access-log entries', async () => {
    await grant(x, 'FULL');
    expect(JSON.parse(await x.cc.getDisclosures(x.ctx(people.auditor), ID))).toHaveLength(1);
    expect(JSON.parse(await x.cc.logAccess(x.ctx(people.so), ID, 'IDENTITY')).scope).toBe('IDENTITY');
  });
});
