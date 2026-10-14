import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, errorText, setAccessToken } from './api';
import { NAV_BY_ROLE } from './routes';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });

describe('apiFetch', () => {
  it('maps a 409 COI_VIOLATION body to ApiError with details and readable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: { code: 'COI_VIOLATION', message: 'x', details: { violations: ['R4'] } } })));
    const err = await apiFetch('/cases/x/assign').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'COI_VIOLATION' });
    expect(errorText(err)).toBe('Blocked by conflict-of-interest rule R4: investigator is based at the case depot');
  });

  it('refreshes once on 401 then retries with the new token', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED' } }))
      .mockResolvedValueOnce(json(200, { accessToken: 'new', user: { id: 'u' } }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', f);
    expect(await apiFetch('/me')).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    expect(new Headers(f.mock.calls[2][1].headers).get('authorization')).toBe('Bearer new');
  });
});

describe('navigation', () => {
  it('complainant has no audit console', () => expect(NAV_BY_ROLE.COMPLAINANT.map((n) => n.path)).not.toContain('/audit'));
});
