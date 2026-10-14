import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { open, openString, pseudonymFor, seal, sealString, sha3Hex } from '../src/crypto.js';

const kek = randomBytes(32);

describe('crypto', () => {
  it('seal/open round-trips', () => {
    expect(open(seal(Buffer.from('hello'), kek), kek).toString()).toBe('hello');
  });

  it('flipping one ciphertext byte -> INTEGRITY_ERROR', () => {
    const s = seal(Buffer.from('hello world'), kek);
    s.ciphertext[0] ^= 1;
    expect(() => open(s, kek)).toThrow('INTEGRITY_ERROR');
  });

  it('two seals of same plaintext differ', () => {
    expect(seal(Buffer.from('x'), kek).ciphertext.equals(seal(Buffer.from('x'), kek).ciphertext)).toBe(false);
  });

  it('dekWrapped is 60 bytes', () => expect(seal(Buffer.from('x'), kek).dekWrapped).toHaveLength(60));

  it('sealString round-trips', () => expect(openString(sealString('título', kek), kek)).toBe('título'));

  it('sha3-256 known vector', () =>
    expect(sha3Hex('abc')).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'));

  it('pseudonymFor is stable and differs per caseId', () => {
    const s = randomBytes(32);
    expect(pseudonymFor(s, 'u', 'CASE-2026-000001')).toBe(pseudonymFor(s, 'u', 'CASE-2026-000001'));
    expect(pseudonymFor(s, 'u', 'CASE-2026-000001')).not.toBe(pseudonymFor(s, 'u', 'CASE-2026-000002'));
    expect(pseudonymFor(s, 'u', 'CASE-2026-000001')).toMatch(/^PSN-[0-9a-f]{12}$/);
  });
});

describe('config', () => {
  const k = (n: number) => randomBytes(n).toString('base64');
  const env = { DATABASE_URL: 'postgres://a:b@localhost/x', AEGIS_KEK: k(32), PSEUDONYM_SECRET: k(32), JWT_SECRET: k(64), WALLET_KEK: k(32) };

  it('loads valid env', () => expect(loadConfig(env).AEGIS_KEK).toHaveLength(32));
  it('rejects a 16-byte AEGIS_KEK naming the variable', () =>
    expect(() => loadConfig({ ...env, AEGIS_KEK: k(16) })).toThrow(/AEGIS_KEK/));
});
