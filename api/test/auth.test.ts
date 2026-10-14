import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeTestApp, T0, type TestApp, totpCode } from './helpers.js';

let t: TestApp;
let alice: Awaited<ReturnType<TestApp['user']>>;
beforeAll(async () => {
  t = await makeTestApp();
  alice = await t.user({ username: 'alice', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-01', password: 'correct horse' });
});
afterAll(() => t.stop());

const login = (username: string, password: string, ip = '10.0.0.1') =>
  t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password }, remoteAddress: ip });

describe('auth', () => {
  it('full login flow with valid TOTP returns access token', async () => {
    const r1 = await login('alice', 'correct horse');
    expect(r1.statusCode).toBe(200);
    const r2 = await t.app.inject({ method: 'POST', url: '/api/v1/auth/mfa/verify', payload: { mfaToken: r1.json().mfaToken, code: totpCode(alice.totpSecret, T0) } });
    expect(r2.statusCode).toBe(200);
    expect(r2.cookies.find((c) => c.name === 'aegis_refresh')?.httpOnly).toBe(true);
    const me = await t.app.inject({ url: '/api/v1/me', headers: auth(r2.json().accessToken) });
    expect(me.json()).toMatchObject({ username: 'alice', role: 'COMPLAINANT' });
  });

  it('wrong TOTP -> 401 INVALID_MFA', async () => {
    const r1 = await login('alice', 'correct horse', '10.0.0.2');
    const r2 = await t.app.inject({ method: 'POST', url: '/api/v1/auth/mfa/verify', payload: { mfaToken: r1.json().mfaToken, code: '000000' } });
    expect(r2.statusCode).toBe(401);
    expect(r2.json().error.code).toBe('INVALID_MFA');
  });

  it('unknown user and wrong password give identical 401 body', async () => {
    const a = await login('nobody', 'x', '10.0.0.3');
    const b = await login('alice', 'wrong', '10.0.0.3');
    expect(a.statusCode).toBe(401);
    expect(a.body).toBe(b.body);
  });

  it('6th login in a minute -> 429', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await login('alice', 'wrong', '10.0.0.9')).statusCode);
    expect(codes.at(-1)).toBe(429);
  });

  it('access token expires after 15 min', async () => {
    expect((await t.app.inject({ url: '/api/v1/me', headers: auth(alice.token) })).statusCode).toBe(200);
    t.clock.advanceHours(0.26);
    expect((await t.app.inject({ url: '/api/v1/me', headers: auth(alice.token) })).statusCode).toBe(401);
    t.clock.set(T0);
  });

  it('no token -> 401', async () => {
    expect((await t.app.inject({ url: '/api/v1/me' })).statusCode).toBe(401);
  });

  it('admin creates investigator; non-admin -> 403', async () => {
    const admin = await t.user({ username: 'admin1', role: 'ADMIN', unit: 'U6' });
    const body = { username: 'inv9', role: 'INVESTIGATOR', unit: 'U4', depot: 'NONE' };
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: auth(alice.token), payload: body })).statusCode).toBe(403);
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: auth(admin.token), payload: body });
    expect(r.statusCode).toBe(201);
    expect(r.json().initialPassword).toBeTruthy();
  });
});
