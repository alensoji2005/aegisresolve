import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import type { EvidenceAnchor } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { authorize, type AuthUser } from '../auth/authorize.js';
import { loadCaseFor } from '../cases/service.js';
import { open, openString, seal, sealString, sha256Hex, sha3Hex } from '../crypto.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import type { LedgerUser } from '../ledger/ledger.js';
import { loadLedgerUser } from '../users/service.js';

const EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'application/pdf': ['pdf'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/json': ['json'],
};
const TEXT_BY_EXT: Record<string, string> = { txt: 'text/plain', csv: 'text/csv', json: 'application/json' };
const WAV_ALIASES = ['audio/wav', 'audio/x-wav', 'audio/vnd.wave', 'audio/wave'];

const unsupported = () => new ApiError(415, 'UNSUPPORTED_TYPE', 'file type not allowed or does not match its extension');

/** Detects the real type from magic bytes; the extension must agree. Plain-text types have no magic bytes, so they must decode as UTF-8. */
export async function detectType(filename: string, data: Buffer): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const ft = await fileTypeFromBuffer(data);
  if (ft) {
    const mime = WAV_ALIASES.includes(ft.mime) ? 'audio/wav' : ft.mime;
    if (!EXTENSIONS[mime]?.includes(ext)) throw unsupported();
    return mime;
  }
  const textMime = TEXT_BY_EXT[ext];
  if (!textMime) throw unsupported();
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw unsupported();
  }
  return textMime;
}

export interface EvidenceMeta { id: string; mimeType: string; sizeBytes: number; sha256Plain: string; sha3Plain: string; txId: string | null; createdAt: Date }

export async function uploadEvidence(deps: AppDeps, user: AuthUser, caseId: string, file: { filename: string; data: Buffer }): Promise<EvidenceMeta> {
  const { facts } = await loadCaseFor(deps, user, caseId);
  if (!authorize(user, 'evidence:upload', facts)) throw forbidden();
  const mimeType = await detectType(file.filename, file.data);
  const id = randomUUID();
  const sha256Plain = sha256Hex(file.data);
  const sha3Plain = sha3Hex(file.data);
  const sealed = seal(file.data, deps.cfg.AEGIS_KEK);
  const sha256Cipher = sha256Hex(sealed.ciphertext);
  const objectKey = `evidence/${caseId}/${id}`;

  await deps.blobs.put(objectKey, sealed.ciphertext);
  let txId: string;
  try {
    ({ txId } = await deps.ledger.submit(await loadLedgerUser(deps, user.id), 'complaint:anchorEvidence',
      [id, caseId, sha256Plain, sha3Plain, sha256Cipher, mimeType, String(file.data.length)]));
  } catch (e) {
    await deps.blobs.delete(objectKey);
    throw e;
  }
  const { rows } = await deps.pool.query(
    `insert into evidence(id, case_id, object_key, original_name_enc, mime_type, size_bytes, sha256_plain, sha3_plain, sha256_cipher,
       dek_wrapped, iv, auth_tag, uploaded_by, ledger_tx_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning created_at`,
    [id, caseId, objectKey, sealString(file.filename, deps.cfg.AEGIS_KEK), mimeType, file.data.length, sha256Plain, sha3Plain, sha256Cipher,
      sealed.dekWrapped, sealed.iv, sealed.authTag, user.id, txId]);
  return { id, mimeType, sizeBytes: file.data.length, sha256Plain, sha3Plain, txId, createdAt: rows[0].created_at };
}

export async function listEvidence(deps: AppDeps, user: AuthUser, caseId: string) {
  const { facts } = await loadCaseFor(deps, user, caseId);
  const full = authorize(user, 'case:read:full', facts);
  const { rows } = await deps.pool.query('select * from evidence where case_id = $1 order by created_at', [caseId]);
  return rows.map((r) => ({
    id: r.id, mimeType: r.mime_type, sizeBytes: Number(r.size_bytes), sha256Plain: r.sha256_plain, sha3Plain: r.sha3_plain, txId: r.ledger_tx_id,
    createdAt: r.created_at, filename: full || r.uploaded_by === user.id ? openString(r.original_name_enc, deps.cfg.AEGIS_KEK) : null,
  }));
}

async function evidenceRow(deps: AppDeps, caseId: string, evidenceId: string) {
  const { rows } = await deps.pool.query('select * from evidence where id::text = $1 and case_id = $2', [evidenceId, caseId]);
  if (!rows[0]) throw notFound('evidence');
  return rows[0];
}

export interface VerifyReport { evidenceId: string; caseId: string; cipherHashOk: boolean; plainSha256Ok: boolean; plainSha3Ok: boolean; ledgerMatch: boolean; ok: boolean }

/** Checks stored ciphertext and decrypted plaintext against the on-chain anchor, and the DB row against the anchor. Never throws on tampering. */
export async function verifyEvidenceRow(deps: AppDeps, ledgerUser: LedgerUser, row: any): Promise<VerifyReport> {
  const anchor = await deps.ledger.evaluate<EvidenceAnchor>(ledgerUser, 'complaint:getEvidence', [row.id]);
  let cipher: Buffer | null = null;
  try { cipher = await deps.blobs.get(row.object_key); } catch { cipher = null; }
  const cipherHashOk = !!cipher && sha256Hex(cipher) === anchor.sha256Cipher;
  let plain: Buffer | null = null;
  try {
    if (cipher) plain = open({ ciphertext: cipher, iv: row.iv, authTag: row.auth_tag, dekWrapped: row.dek_wrapped }, deps.cfg.AEGIS_KEK);
  } catch { plain = null; }
  const plainSha256Ok = !!plain && sha256Hex(plain) === anchor.sha256Plain;
  const plainSha3Ok = !!plain && sha3Hex(plain) === anchor.sha3Plain;
  const ledgerMatch = row.sha256_plain === anchor.sha256Plain && row.sha3_plain === anchor.sha3Plain
    && row.sha256_cipher === anchor.sha256Cipher && Number(row.size_bytes) === anchor.sizeBytes && anchor.caseId === row.case_id;
  return { evidenceId: row.id, caseId: row.case_id, cipherHashOk, plainSha256Ok, plainSha3Ok, ledgerMatch,
    ok: cipherHashOk && plainSha256Ok && plainSha3Ok && ledgerMatch };
}

export async function verifyEvidence(deps: AppDeps, user: AuthUser, caseId: string, evidenceId: string): Promise<VerifyReport> {
  const { facts } = await loadCaseFor(deps, user, caseId);
  if (!authorize(user, 'evidence:verify', facts)) throw forbidden();
  return verifyEvidenceRow(deps, await loadLedgerUser(deps, user.id), await evidenceRow(deps, caseId, evidenceId));
}

export async function downloadEvidence(deps: AppDeps, user: AuthUser, caseId: string, evidenceId: string) {
  const { facts } = await loadCaseFor(deps, user, caseId);
  if (!authorize(user, 'evidence:read', facts)) throw forbidden();
  const row = await evidenceRow(deps, caseId, evidenceId);
  await deps.ledger.submit(await loadLedgerUser(deps, user.id), 'complaint:logAccess', [caseId, `EVIDENCE:${row.id}`]);
  const data = open({ ciphertext: await deps.blobs.get(row.object_key), iv: row.iv, authTag: row.auth_tag, dekWrapped: row.dek_wrapped }, deps.cfg.AEGIS_KEK);
  return { data, mimeType: row.mime_type as string, filename: openString(row.original_name_enc, deps.cfg.AEGIS_KEK) };
}
