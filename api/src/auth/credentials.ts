import argon2 from 'argon2';
import { authenticator } from 'otplib';

export const hashPassword = (p: string) => argon2.hash(p, { type: argon2.argon2id });
export const verifyPassword = (hash: string, p: string) => argon2.verify(hash, p).catch(() => false);

export const newTotpSecret = () => authenticator.generateSecret();

export function verifyTotp(secret: string, code: string, now: Date): boolean {
  const a = authenticator.clone({ epoch: now.getTime(), window: 1 });
  return /^\d{6}$/.test(code) && a.check(code, secret);
}

export function totpCode(secret: string, now: Date): string {
  return authenticator.clone({ epoch: now.getTime() }).generate(secret);
}

export const otpauthUrl = (username: string, secret: string) => authenticator.keyuri(username, 'AegisResolve', secret);
