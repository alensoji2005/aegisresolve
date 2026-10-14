/**
 * End-to-end demo against a running stack (API + AI service, seeded). Prints DEMO OK or exits 1 at the failing step.
 * Usage: pnpm --filter @aegis/api demo:smoke   (BASE_URL defaults to http://localhost:3000)
 */
import { readFile } from 'node:fs/promises';
import { totpCode } from '../src/auth/credentials.js';
import { CREDENTIALS_PATH } from '../src/seed/index.js';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000') + '/api/v1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const creds: { username: string; password: string; totpSecret: string }[] = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));

let step = 0;
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`DEMO FAILED at step ${step}: ${msg}`);
    process.exit(1);
  }
}

async function call(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const tokens = new Map<string, string>();
async function as(username: string): Promise<string> {
  const c = creds.find((x) => x.username === username)!;
  const l = await call(null, 'POST', '/auth/login', { username, password: c.password });
  check(l.status === 200, `login ${username}: ${l.status}`);
  const v = await call(null, 'POST', '/auth/mfa/verify', { mfaToken: l.json.mfaToken, code: totpCode(c.totpSecret, new Date()) });
  check(v.status === 200, `mfa ${username}: ${v.status}`);
  tokens.set(username, v.json.accessToken);
  return v.json.accessToken;
}

step = 1;
const comp = await as('comp2');
const created = await call(comp, 'POST', '/cases', {
  title: 'Damp packaging in DEP-02 magazine 1',
  description: 'Humidity indicator in DEP-02/MAG-01/BAY-04 showed 85% for two days; packaging on LOT-B03-2025-0117 looks damp and one seal is broken.',
  assetRefs: ['LOT-B03-2025-0117'], locationRef: 'DEP-02/MAG-01/BAY-04', occurredAt: new Date(Date.now() - 2 * 864e5).toISOString(),
});
check(created.status === 201, `create case: ${created.status} ${JSON.stringify(created.json)}`);
const id: string = created.json.caseId;
const fd = new FormData();
fd.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
const up = await call(comp, 'POST', `/cases/${id}/evidence`, fd);
check(up.status === 201, `upload evidence: ${up.status}`);
console.log(`1. ${id} filed as ${created.json.pseudonym}, evidence ${up.json.sha256Plain.slice(0, 16)}…`);

step = 2;
const so = await as('safety1');
let view: any;
for (let i = 0; i < 60; i++) {
  view = (await call(so, 'GET', `/cases/${id}`)).json;
  if (view.status === 'TRIAGED') break;
  await new Promise((r) => setTimeout(r, 1000));
}
check(view.status === 'TRIAGED', `triage did not finish (triageStatus ${view.triageStatus})`);
check(['MEDIUM', 'HIGH', 'CRITICAL'].includes(view.riskLevel), `risk level ${view.riskLevel}`);
console.log(`2. triaged: ${view.category} risk ${view.riskLevel} (${view.riskScore})`);

step = 3;
const investigators = (await call(so, 'GET', '/investigators')).json as { id: string; username: string }[];
const inv3 = investigators.find((i) => i.username === 'inv3')!;
const inv1 = investigators.find((i) => i.username === 'inv1')!;
const blocked = await call(so, 'POST', `/cases/${id}/assign`, { investigatorUserId: inv3.id });
check(blocked.status === 409 && blocked.json.error.details.violations.includes('R4'), `inv3 should be blocked by R4: ${JSON.stringify(blocked.json)}`);
check((await call(so, 'POST', `/cases/${id}/assign`, { investigatorUserId: inv1.id })).status === 200, 'assign inv1');
console.log('3. inv3 blocked by COI R4; inv1 assigned');

step = 4;
const inv = await as('inv1');
check((await call(inv, 'POST', `/cases/${id}/accept`)).status === 200, 'accept');
const lc = (await call(inv, 'GET', `/cases/${id}/lifecycle`)).json;
check(lc.suggested.length > 0, 'no lifecycle suggestions');
check((await call(inv, 'POST', `/cases/${id}/lifecycle-links`, { eventIds: [lc.suggested[0].id] })).status === 200, 'link event');
const findings = await call(inv, 'POST', `/cases/${id}/findings`, {
  body: 'Humidity in MAG-01 exceeded the 70% limit for 48 hours; packaging on the lot absorbed moisture.',
  outcome: 'SUBSTANTIATED', correctiveAction: 'Repair dehumidifier; re-inspect lot.',
});
check(findings.status === 200, `findings: ${findings.status}`);
console.log(`4. accepted, linked ${lc.suggested[0].id} (${lc.suggested[0].eventType}), findings signed`);

step = 5;
check((await call(inv, 'POST', `/cases/${id}/review`, { decision: 'APPROVE' })).status === 403, 'investigator must not approve');
let status = '';
for (const who of ['safety1', 'board1', 'board2']) {
  const r = await call(tokens.get(who) ?? (await as(who)), 'POST', `/cases/${id}/review`, { decision: 'APPROVE' });
  check(r.status === 200, `approve as ${who}: ${r.status}`);
  status = r.json.status;
  if (status === 'CLOSED') break;
}
check(status === 'CLOSED', `not closed after approvals: ${status}`);
console.log('5. closed after quorum; investigator approval rejected');

step = 6;
check((await call(comp, 'POST', `/cases/${id}/appeal`, { reason: 'Bay 3 had the same problem and was not inspected.' })).json?.status === 'APPEALED', 'appeal');
const decided = await call(await as('board3'), 'POST', `/cases/${id}/appeal/decide`, { accept: false, reason: 'Bay 3 checked separately; no change to outcome.' });
check(decided.json?.status === 'CLOSED_FINAL', `appeal decision: ${JSON.stringify(decided.json)}`);
console.log('6. appeal filed and rejected by an independent board member -> CLOSED_FINAL');

step = 7;
const audit = await as('audit1');
const rec = (await call(audit, 'GET', '/audit/reconcile')).json;
check(rec.mismatches.length === 0, `reconcile mismatches: ${JSON.stringify(rec.mismatches)}`);
const ev = (await call(audit, 'POST', '/audit/verify-evidence')).json;
check(ev.failures.length === 0, `evidence failures: ${JSON.stringify(ev.failures)}`);
console.log(`7. audit: ${rec.checked} cases reconciled, ${ev.checked} evidence files verified`);

console.log('DEMO OK');
