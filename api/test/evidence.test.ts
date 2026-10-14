import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex, sha3Hex } from '../src/crypto.js';
import { LedgerError } from '../src/ledger/ledger.js';
import { auth, complaint, makeTestApp, multipart, PDF, PNG, type TestApp } from './helpers.js';

let t: TestApp;
type U = Awaited<ReturnType<TestApp['user']>>;
let comp: U, so: U, auditor: U;
let caseId: string;

beforeAll(async () => {
  t = await makeTestApp();
  comp = await t.user({ username: 'comp-a', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-02' });
  so = await t.user({ username: 'safety-1', role: 'SAFETY_OFFICER', unit: 'U5' });
  auditor = await t.user({ username: 'audit-1', role: 'AUDITOR', unit: 'U6' });
  caseId = (await t.app.inject({ method: 'POST', url: '/api/v1/cases', headers: auth(comp.token), payload: complaint })).json().caseId;
});
afterAll(() => t.stop());

const upload = (name: string, data: Buffer, token = comp.token) => {
  const m = multipart(name, data);
  return t.app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/evidence`, headers: { ...auth(token), ...m.headers }, payload: m.payload });
};
const verify = (eid: string, token = so.token) => t.app.inject({ url: `/api/v1/cases/${caseId}/evidence/${eid}/verify`, headers: auth(token) });

describe('evidence', () => {
  let eid: string;

  it('png upload -> 201 and ledger anchor hashes match the bytes', async () => {
    const r = await upload('photo.png', PNG);
    expect(r.statusCode).toBe(201);
    eid = r.json().id;
    const anchor = await t.ledger.evaluate<any>({ userId: so.id, role: 'SAFETY_OFFICER', unit: 'U5', depot: 'NONE', pseudo: '' }, 'complaint:getEvidence', [eid]);
    expect(anchor).toMatchObject({ sha256Plain: sha256Hex(PNG), sha3Plain: sha3Hex(PNG), mimeType: 'image/png', sizeBytes: PNG.length });
  });

  it('pdf named .png -> 415, no blob, no anchor', async () => {
    const blobs = t.blobs.items.size;
    const r = await upload('photo.png', PDF);
    expect(r.statusCode).toBe(415);
    expect(t.blobs.items.size).toBe(blobs);
  });

  it('binary junk named .txt -> 415', async () => {
    expect((await upload('notes.txt', Buffer.from([0xff, 0xfe, 0x00, 0xc3]))).statusCode).toBe(415);
  });

  it('26 MB upload -> 413', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]);
    const r = await upload('big.png', big);
    expect(r.statusCode).toBe(413);
  });

  it('anchor failure deletes the blob', async () => {
    const blobs = t.blobs.items.size;
    const real = t.deps.ledger.submit.bind(t.deps.ledger);
    t.deps.ledger.submit = async () => { throw new LedgerError('UNAVAILABLE', 'down'); };
    const r = await upload('photo.png', PNG);
    t.deps.ledger.submit = real;
    expect(r.statusCode).toBe(503);
    expect(t.blobs.items.size).toBe(blobs);
  });

  it('verify all-green on untouched evidence', async () => {
    expect((await verify(eid)).json()).toMatchObject({ cipherHashOk: true, plainSha256Ok: true, plainSha3Ok: true, ledgerMatch: true, ok: true });
  });

  it('flipping one stored byte -> cipherHashOk false', async () => {
    const key = `evidence/${caseId}/${eid}`;
    const orig = Buffer.from(t.blobs.items.get(key)!);
    const bad = Buffer.from(orig);
    bad[0] ^= 1;
    t.blobs.items.set(key, bad);
    expect((await verify(eid)).json()).toMatchObject({ cipherHashOk: false, ok: false });
    t.blobs.items.set(key, orig);
  });

  it('editing the DB hash -> ledgerMatch false', async () => {
    await t.deps.pool.query(`update evidence set sha256_plain = repeat('0', 64) where id = $1`, [eid]);
    expect((await verify(eid)).json()).toMatchObject({ ledgerMatch: false, ok: false });
    await t.deps.pool.query(`update evidence set sha256_plain = $2 where id = $1`, [eid, sha256Hex(PNG)]);
  });

  it('download returns original bytes and logs EVIDENCE access', async () => {
    const r = await t.app.inject({ url: `/api/v1/cases/${caseId}/evidence/${eid}/download`, headers: auth(so.token) });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(PNG)).toBe(true);
    const log = await t.ledger.evaluate<any[]>({ userId: so.id, role: 'AUDITOR', unit: 'U6', depot: 'NONE', pseudo: '' }, 'complaint:getAccessLog', [caseId]);
    expect(log.some((e) => e.scope === `EVIDENCE:${eid}`)).toBe(true);
  });

  it('auditor cannot download (403) but can verify', async () => {
    expect((await t.app.inject({ url: `/api/v1/cases/${caseId}/evidence/${eid}/download`, headers: auth(auditor.token) })).statusCode).toBe(403);
    expect((await verify(eid, auditor.token)).json().ok).toBe(true);
  });

  it('complainant lists own evidence with filename', async () => {
    const list = (await t.app.inject({ url: `/api/v1/cases/${caseId}/evidence`, headers: auth(comp.token) })).json();
    expect(list).toEqual([expect.objectContaining({ id: eid, filename: 'photo.png' })]);
  });
});
