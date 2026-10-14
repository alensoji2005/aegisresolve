import { beforeEach, describe, expect, it } from 'vitest';
import { certHash } from '../src/ctxutil';
import { at, h, Harness, people, T0 } from './harness';

let x: Harness;
beforeEach(() => { x = new Harness(); });

describe('registration, evidence, triage, links, queries', () => {
  it('register sets SUBMITTED, depot DEP-02, 24h SLA, salted cert hash', async () => {
    const c = await x.register();
    expect(c.status).toBe('SUBMITTED');
    expect(c.depot).toBe('DEP-02');
    expect(c.slaDueAt).toBe(at(24).toISOString());
    expect(c.complainantCertHash).toBe(certHash(people.comp.id, c.caseSalt));
  });

  it('register twice -> ALREADY_EXISTS', async () => {
    await x.register();
    await expect(x.register()).rejects.toThrow(/^ALREADY_EXISTS/);
  });

  it('register by INVESTIGATOR -> FORBIDDEN', async () => {
    await expect(x.register('CASE-2026-000001', people.inv)).rejects.toThrow(/^FORBIDDEN/);
  });

  it('register with bad locationRef -> INVALID_ARG', async () => {
    await expect(x.cc.registerCase(x.ctx(people.comp), 'CASE-2026-000001', 'PSN-0123456789ab', h('c'), '[]', 'DEP-2/MAG-01'))
      .rejects.toThrow(/^INVALID_ARG/);
  });

  it('anchorEvidence rejects non-hex hash', async () => {
    await x.register();
    await expect(x.cc.anchorEvidence(x.ctx(people.comp), '11111111-1111-4111-8111-111111111111', 'CASE-2026-000001',
      'zz', h('b'), h('c'), 'image/png', '10')).rejects.toThrow(/^INVALID_ARG/);
  });

  it('anchorEvidence stores and getEvidence returns the anchor', async () => {
    await x.register();
    const id = '11111111-1111-4111-8111-111111111111';
    await x.cc.anchorEvidence(x.ctx(people.comp), id, 'CASE-2026-000001', h('a'), h('b'), h('c'), 'image/png', '10');
    expect(JSON.parse(await x.cc.getEvidence(x.ctx(people.auditor), id))).toMatchObject({ sha256Plain: h('a'), sizeBytes: 10 });
  });

  it('triage HIGH score 0.7 sets slaDueAt = now+24h', async () => {
    const c = await x.triaged('CASE-2026-000001', '0.7');
    expect(c.status).toBe('TRIAGED');
    expect(c.riskLevel).toBe('HIGH');
    expect(c.slaDueAt).toBe(at(24).toISOString());
  });

  it('triage twice -> INVALID_TRANSITION', async () => {
    await x.triaged();
    await expect(x.cc.triage(x.ctx(people.sys), 'CASE-2026-000001', 'STORAGE_ENVIRONMENT', '0.5', h('ai'), '[]'))
      .rejects.toThrow(/^INVALID_TRANSITION/);
  });

  it('triage by non-SYSTEM -> FORBIDDEN', async () => {
    await x.register();
    await expect(x.cc.triage(x.ctx(people.so), 'CASE-2026-000001', 'STORAGE_ENVIRONMENT', '0.5', h('ai'), '[]'))
      .rejects.toThrow(/^FORBIDDEN/);
  });

  it('markDuplicate moves to MERGED_DUPLICATE and records duplicateOf', async () => {
    await x.register('CASE-2026-000001');
    await x.register('CASE-2026-000002');
    const c = JSON.parse(await x.cc.markDuplicate(x.ctx(people.inv), 'CASE-2026-000002', 'CASE-2026-000001'));
    expect(c).toMatchObject({ status: 'MERGED_DUPLICATE', duplicateOf: 'CASE-2026-000001' });
  });

  it('linkRelated links both ways', async () => {
    await x.register('CASE-2026-000001');
    await x.register('CASE-2026-000002');
    await x.cc.linkRelated(x.ctx(people.inv), 'CASE-2026-000001', 'CASE-2026-000002');
    const other = JSON.parse(await x.cc.getCase(x.ctx(people.inv), 'CASE-2026-000002'));
    expect(other.relatedCaseIds).toEqual(['CASE-2026-000001']);
  });

  it('linkLifecycleEvents unknown EVT -> NOT_FOUND', async () => {
    await x.register();
    await expect(x.cc.linkLifecycleEvents(x.ctx(people.inv), 'CASE-2026-000001', '["EVT-000099"]')).rejects.toThrow(/^NOT_FOUND/);
  });

  it('getCaseHistory returns one entry per write in order', async () => {
    await x.triaged();
    const hist = JSON.parse(await x.cc.getCaseHistory(x.ctx(people.auditor), 'CASE-2026-000001'));
    expect(hist.map((e: any) => e.status)).toEqual(['SUBMITTED', 'TRIAGED']);
    expect(hist[1].actor).toBe('SYSTEM:x509::system');
  });

  it('logAccess entries are listed by getAccessLog', async () => {
    await x.register();
    await x.cc.logAccess(x.ctx(people.so), 'CASE-2026-000001', 'FULL');
    const log = JSON.parse(await x.cc.getAccessLog(x.ctx(people.auditor), 'CASE-2026-000001'));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ viewer: people.so.id, scope: 'FULL', role: 'SAFETY_OFFICER' });
  });

  it('ledger state holds only hashes, ids and enums', async () => {
    await x.cc.registerCase(x.ctx(people.comp, T0), 'CASE-2026-000001', 'PSN-0123456789ab', h('humidity complaint'), '[]', 'DEP-02/MAG-01/BAY-04');
    for (const v of x.world.state.values()) expect(v.toString()).not.toContain('humidity');
    const c = JSON.parse(await x.cc.getCase(x.ctx(people.inv), 'CASE-2026-000001'));
    expect(c.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
