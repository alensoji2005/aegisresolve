import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export interface Sealed { ciphertext: Buffer; iv: Buffer; authTag: Buffer; dekWrapped: Buffer }

export const sha256Hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const sha3Hex = (b: Buffer | string) => createHash('sha3-256').update(b).digest('hex');

function gcmEncrypt(key: Buffer, plain: Buffer): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv, tag: c.getAuthTag(), ct };
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): Buffer {
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new Error('INTEGRITY_ERROR');
  }
}

/** Envelope encryption: fresh DEK per object, DEK wrapped by the KEK as iv(12)|tag(16)|ct(32). */
export function seal(plain: Buffer, kek: Buffer): Sealed {
  const dek = randomBytes(32);
  const body = gcmEncrypt(dek, plain);
  const w = gcmEncrypt(kek, dek);
  return { ciphertext: body.ct, iv: body.iv, authTag: body.tag, dekWrapped: Buffer.concat([w.iv, w.tag, w.ct]) };
}

export function open(s: Sealed, kek: Buffer): Buffer {
  const w = s.dekWrapped;
  const dek = gcmDecrypt(kek, w.subarray(0, 12), w.subarray(12, 28), w.subarray(28));
  return gcmDecrypt(dek, s.iv, s.authTag, s.ciphertext);
}

/** Single-buffer form for bytea columns: iv(12)|tag(16)|dekWrapped(60)|ciphertext. */
export function sealString(s: string, kek: Buffer): Buffer {
  const x = seal(Buffer.from(s, 'utf8'), kek);
  return Buffer.concat([x.iv, x.authTag, x.dekWrapped, x.ciphertext]);
}

export function openString(b: Buffer, kek: Buffer): string {
  return open({ iv: b.subarray(0, 12), authTag: b.subarray(12, 28), dekWrapped: b.subarray(28, 88), ciphertext: b.subarray(88) }, kek).toString('utf8');
}

/** JSON with recursively sorted object keys, so hashes of the same data are stable. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((v as any)[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export function pseudonymFor(secret: Buffer, userId: string, caseId: string): string {
  return 'PSN-' + createHmac('sha256', secret).update(userId + '|' + caseId).digest('hex').slice(0, 12);
}
