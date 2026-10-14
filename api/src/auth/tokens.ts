import { jwtVerify, SignJWT } from 'jose';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';

export type TokenType = 'access' | 'mfa' | 'refresh';
const TTL: Record<TokenType, number> = { access: 15 * 60, mfa: 5 * 60, refresh: 8 * 3600 };

export async function signToken(cfg: Config, sub: string, typ: TokenType, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ typ }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuedAt(iat).setExpirationTime(iat + TTL[typ])
    .sign(cfg.JWT_SECRET);
}

export async function verifyToken(cfg: Config, token: string, typ: TokenType, now: Date): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, cfg.JWT_SECRET, { algorithms: ['HS256'], currentDate: now });
    if (payload.typ !== typ || !payload.sub) throw new Error('wrong type');
    return payload.sub;
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'invalid or expired token');
  }
}
