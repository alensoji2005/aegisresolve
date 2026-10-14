import { createHash } from 'crypto';
import { Context } from 'fabric-contract-api';
import stringify from 'json-stringify-deterministic';
import { Actor, Role, ROLES } from './types';

export function fail(code: string, msg?: string): never {
  throw new Error(code + (msg ? ': ' + msg : ''));
}

export function actorOf(ctx: Context): Actor {
  const ci = ctx.clientIdentity;
  const role = ci.getAttributeValue('role') as Role | null;
  if (!role || !ROLES.includes(role)) fail('FORBIDDEN', `role ${role}`);
  return {
    id: ci.getID(),
    role,
    unit: ci.getAttributeValue('unit') ?? '',
    depot: ci.getAttributeValue('depot') ?? 'NONE',
    pseudo: ci.getAttributeValue('pseudo') ?? '',
  };
}

export function requireRole(ctx: Context, ...roles: Role[]): Actor {
  const actor = actorOf(ctx);
  if (!roles.includes(actor.role)) fail('FORBIDDEN', `role ${actor.role}`);
  return actor;
}

export function txTime(ctx: Context): Date {
  const ts = ctx.stub.getTxTimestamp();
  const s: any = ts.seconds;
  const secs = typeof s === 'number' ? s : typeof s?.toNumber === 'function' ? s.toNumber() : Number(s?.low ?? s);
  return new Date(secs * 1000 + Math.floor((ts.nanos ?? 0) / 1e6));
}

export function key(ctx: Context, type: string, parts: string[]): string {
  return ctx.stub.createCompositeKey(type, parts);
}

export async function getJson<T>(ctx: Context, type: string, parts: string[]): Promise<T | null> {
  const b = await ctx.stub.getState(key(ctx, type, parts));
  return b && b.length ? (JSON.parse(Buffer.from(b).toString('utf8')) as T) : null;
}

export async function putJson(ctx: Context, type: string, parts: string[], value: unknown): Promise<void> {
  await ctx.stub.putState(key(ctx, type, parts), Buffer.from(stringify(value)));
}

export async function listByPrefix<T>(ctx: Context, type: string, parts: string[]): Promise<T[]> {
  const out: T[] = [];
  const it = await ctx.stub.getStateByPartialCompositeKey(type, parts);
  try {
    for (let r = await it.next(); !r.done; r = await it.next()) {
      out.push(JSON.parse(Buffer.from(r.value.value).toString('utf8')) as T);
    }
  } finally {
    await it.close();
  }
  return out;
}

export function certHash(certId: string, salt: string): string {
  return createHash('sha256').update(certId + '|' + salt).digest('hex');
}

export function parseJsonArray(s: string, name: string, pattern?: RegExp): string[] {
  let v: unknown;
  try { v = JSON.parse(s); } catch { fail('INVALID_ARG', `${name} not JSON`); }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || (pattern && !pattern.test(x)))) {
    fail('INVALID_ARG', name);
  }
  return v as string[];
}

export function check(cond: boolean, name: string): void {
  if (!cond) fail('INVALID_ARG', name);
}

export const RE = {
  caseId: /^CASE-\d{4}-\d{6}$/,
  lot: /^LOT-[A-Z]\d{2}-\d{4}-\d{4}$/,
  location: /^DEP-\d{2}\/MAG-\d{2}\/BAY-\d{2}$/,
  event: /^EVT-\d{6}$/,
  hash: /^[0-9a-f]{64}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  pseudonym: /^PSN-[0-9a-f]{12}$/,
};
