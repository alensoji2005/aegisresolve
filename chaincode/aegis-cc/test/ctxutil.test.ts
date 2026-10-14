import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { certHash, getJson, putJson, requireRole, txTime } from '../src/ctxutil';
import { actor, ctxFor, newWorld } from './fakeContext';

describe('ctxutil', () => {
  it('requireRole rejects wrong role', () => {
    const ctx = ctxFor(newWorld(), actor('AUDITOR'));
    expect(() => requireRole(ctx, 'INVESTIGATOR')).toThrow(/^FORBIDDEN/);
  });

  it('putJson/getJson round-trip with sorted keys', async () => {
    const w = newWorld();
    const ctx = ctxFor(w, actor('SYSTEM'));
    await putJson(ctx, 'T', ['1'], { b: 1, a: 2 });
    expect(await getJson(ctx, 'T', ['1'])).toEqual({ a: 2, b: 1 });
    expect([...w.state.values()][0].toString()).toBe('{"a":2,"b":1}');
  });

  it('txTime returns injected time', () => {
    const t = new Date('2026-01-02T03:04:05.000Z');
    expect(txTime(ctxFor(newWorld(), actor('SYSTEM'), { time: t })).toISOString()).toBe(t.toISOString());
  });

  it('certHash is sha256 of id|salt', () => {
    expect(certHash('x', 's')).toBe(createHash('sha256').update('x|s').digest('hex'));
  });
});
