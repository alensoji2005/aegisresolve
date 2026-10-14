# AegisResolve MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, demo-able AegisResolve MVP in about 3 weeks. A complainant files a complaint with evidence. AI triages it. Fabric chaincode enforces the workflow, conflict-of-interest (COI) checks, multi-signature closure, SLA escalation and appeals. An auditor can prove that evidence and records have not been tampered with.

**Architecture:** Hyperledger Fabric 2.5 test-network (2 orgs, channel `aegischannel`) runs one TypeScript chaincode package with `ComplaintContract` and `LifecycleContract`. The Node/Fastify API signs every transaction with the acting user's own Fabric identity (custodial wallet). It stores encrypted content in Postgres and ciphertext evidence in MinIO. After every successful submit it writes the case JSON returned by the chaincode into a Postgres projection; a reconcile endpoint detects any drift. A Python FastAPI service does classification, entity extraction and embeddings. The API owns the risk score, similarity search (pgvector) and lifecycle suggestions, because it owns the data. A React SPA serves each role.

**Tech Stack:** Node 20 LTS, TypeScript, Fastify, `@hyperledger/fabric-gateway`, `fabric-ca-client`, `fabric-contract-api`, Vitest + `unplugin-swc`, PostgreSQL 16 + pgvector, MinIO, Python 3.11, FastAPI, sentence-transformers, scikit-learn, React 18 + Vite + Tailwind + shadcn/ui + TanStack Query.

**Spec:** `docs/AegisResolve_PMD.md`

---

## MVP Feature Set (cut from the PMD)

### In the MVP

| # | Feature | PMD § | Task(s) |
|---|---|---|---|
| F1 | Login with password + TOTP MFA; JWT sessions | 10.1 | 8, 18 |
| F2 | Per-user Fabric X.509 identity with `role/unit/depot/pseudo` attributes; every ledger write signed by the acting user | 5.3, 8.1, 10.1 | 9 |
| F3 | RBAC/ABAC `authorize()` in the API **and** role checks in chaincode | 10.2, 8 | 3–6, 8 |
| F4 | Per-case pseudonymous complainant ID (HMAC); complainant identity never shown | 10.3, 10.4 | 7, 10 |
| F5 | Complaint registration on-chain; content AES-256-GCM encrypted off-chain; content hash anchored | 6, 8.2 | 4, 10 |
| F6 | Evidence upload: type check, SHA-256 + SHA3-256, encryption, MinIO, on-chain anchor, **verify** | 9 | 4, 11 |
| F7 | Case state machine: submit → triage → assign → investigate → findings → k-of-n closure → appeal → final; duplicate merge | 7 | 3–5, 12 |
| F8 | COI rules R1–R4, enforced at assignment and again at acceptance | 8.5 | 3, 5 |
| F9 | Risk-based SLA + automatic escalation (levels 0–3) + appeal window expiry | 7, 8.4 | 3, 5, 12 |
| F10 | AI: category classifier (embedding + LR), entity extraction, explainable risk score | 11.1–11.3 | 13–15 |
| F11 | Duplicate / related / recurring suggestions (pgvector), human-confirmed links | 11.4 | 15, 12 |
| F12 | Lifecycle events on-chain (synthetic) + suggestions for linking events to a case | 8.3, 11.5 | 6, 15, 16 |
| F13 | On-chain access log for full views and evidence downloads | 6.1 | 4, 10, 11 |
| F14 | Audit console: ledger history, verify all evidence, PG ↔ ledger reconcile (tamper detection) | 9, 16 | 17, 20 |
| F15 | Synthetic seed: users, depots, lots, 60 days of lifecycle events, sensor readings with one excursion | 12.1, 15 | 13, 16 |
| F16 | Web UI: complainant (submit wizard, my cases), staff (triage queue, case workspace, review queue), auditor console | 14 | 18–20 |
| F17 | Scripted end-to-end demo against the real Fabric network | 19.1 | 20 |

### Deferred to after the MVP (not in this plan)

OCR and speech-to-text, the knowledge-graph view, the digital-twin board, anomaly detection, controlled-disclosure grants, the `GovernanceContract` (MVP policy is a constant in chaincode), info-request and corrective-action states (corrective action is a field on findings), RFC 3161 timestamps, EXIF metadata, the `PostgresLedger` comparison adapter, Caliper benchmarks, k-anonymised statistics, PDF reports, SUS study. Each of these attaches to an interface this plan defines (`Ledger`, `BlobStore`, AI service routes), so adding them later needs no rework.

### Deliberate simplifications versus the PMD

1. **Projection write-through instead of an event listener.** After each successful `submit`, the API writes the case JSON returned by the chaincode into Postgres. The ledger remains the source of truth, and `/audit/reconcile` catches drift.
2. **No pg-boss.** One in-process `setInterval` ticker runs both the SLA sweep and the triage retry sweep (single API process in the MVP).
3. **Composite-key indexes instead of CouchDB rich queries.** The network runs on LevelDB, which avoids the `-s couchdb` setup.
4. **`INFO_REQUESTED`, `UNDER_REVIEW` and `CORRECTIVE_ACTION` are folded away.** `FINDINGS_SUBMITTED` is the review state.

---

## Global Constraints

- Synthetic data only. Item types are generic (`ITEM-TYPE-01`…). No real munitions, personnel or locations.
- Nothing sensitive on-chain: only IDs, hashes, enums, numbers, ISO timestamps, pseudonyms and certificate IDs.
- Chaincode is deterministic: no `Date.now()`, `Math.random()` or I/O. Time comes from `ctx.stub.getTxTimestamp()`. JSON is written with sorted keys.
- Fabric 2.5.x LTS + Fabric CA 1.5.x, test-network, channel `aegischannel`, chaincode name `aegis-cc`, contract names `complaint` and `lifecycle`.
- Org mapping: COMPLAINANT and STORE_OFFICER → `Org1MSP` ("DepotOrg"). INVESTIGATOR, SAFETY_OFFICER, REVIEW_BOARD, AUDITOR, ADMIN and SYSTEM → `Org2MSP` ("OversightOrg").
- Roles: `COMPLAINANT | STORE_OFFICER | INVESTIGATOR | SAFETY_OFFICER | REVIEW_BOARD | AUDITOR | ADMIN | SYSTEM`.
- Categories: `INVENTORY_DISCREPANCY, STORAGE_ENVIRONMENT, PACKAGING_LABELLING_DEFECT, DOCUMENTATION_CUSTODY_GAP, UNAUTHORISED_ACCESS, SAFETY_PROCEDURE_VIOLATION, INSPECTION_OVERDUE, TRANSPORT_HANDLING_DAMAGE, FACILITY_EQUIPMENT_FAULT, CONDUCT_PROCESS_GRIEVANCE`.
- Policy constants: `slaHours = {LOW:168, MEDIUM:72, HIGH:24, CRITICAL:6}`; untriaged SLA = 24 h; `closureQuorum = {LOW:[SAFETY_OFFICER], MEDIUM:[SAFETY_OFFICER,REVIEW_BOARD], HIGH:[SAFETY_OFFICER,REVIEW_BOARD,REVIEW_BOARD], CRITICAL:[SAFETY_OFFICER,REVIEW_BOARD,REVIEW_BOARD]}`; `appealWindowDays = 14`; `custodyLookbackDays = 90`.
- Risk levels: score `<0.35 LOW`, `<0.6 MEDIUM`, `<0.8 HIGH`, otherwise `CRITICAL`.
- Similarity: duplicate `≥0.90` + same asset + ≤30 days apart; related `≥0.75`; recurring = ≥3 related cases on the same asset or location within 90 days.
- ID formats: case `^CASE-\d{4}-\d{6}$`; lot `^LOT-[A-Z]\d{2}-\d{4}-\d{4}$`; location `^DEP-\d{2}/MAG-\d{2}/BAY-\d{2}$`; event `^EVT-\d{6}$`.
- Crypto: AES-256-GCM, a fresh 256-bit DEK and 96-bit IV per object, the DEK wrapped with `AEGIS_KEK` (AES-256-GCM). Passwords use argon2id. TOTP uses otplib defaults (30 s, 6 digits). Access JWT lasts 15 min; refresh cookie lasts 8 h (httpOnly, SameSite=Strict).
- Evidence: ≤ 25 MB. Allowed detected types: `image/jpeg, image/png, application/pdf, audio/mpeg, audio/wav, text/plain, text/csv, application/json`.
- Embeddings: `BAAI/bge-small-en-v1.5`, 384 dimensions, normalised.
- All commands run in WSL2 Ubuntu from `~/aegis`, a symlink to `/mnt/d/projects/Aegis-Blockchain Munitions`. Fabric scripts break on the space in the Windows path, so always use the symlink.
- Chaincode lives in `chaincode/aegis-cc` as a standalone **npm** project, outside the pnpm workspace, so Fabric's packaging `npm install` works. The API imports its sources by relative path in tests.

## Review Focus

1. **Two approvers sign at the same moment** → Fabric rejects one with an MVCC conflict. The API must retry once and both approvals must land. Test: Task 12, `retries once on MVCC_READ_CONFLICT`.
2. **Evidence whose extension lies about its type, or which exceeds 25 MB** → rejected with 415 / 413, and nothing is stored or anchored. Test: Task 11.
3. **AI service is down when a complaint is filed** → the case is still registered (201), `triage_status='FAILED'`, and the ticker retries up to 3 times. Test: Task 15.
4. **Fabric is unreachable or rejects the write** → the API returns 503 / mapped error and leaves no orphan rows or blobs. Test: Tasks 10 and 11.
5. **A complainant requests another complainant's case ID** → 404, not 403, so the response does not reveal that the case exists. A store officer from a different depot also gets 404. Test: Task 10.

---

## File Structure

```
package.json, pnpm-workspace.yaml (api, web), tsconfig.base.json, .gitignore, .env.example, docker-compose.yml
db/migrations/001_init.sql
network/up.sh, network/deploy.sh, network/down.sh, network/README.md
chaincode/aegis-cc/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                 # exports contracts array
  src/types.ts                 # Role, CaseStatus, Category, RiskLevel, CaseRecord, LifecycleEvent, Approval, CoiResult
  src/rules.ts                 # pure: transitions, policy, riskLevelFromScore, checkCoi, quorumMet, escalationLevel
  src/ctxutil.ts               # requireRole, txTime, putJson/getJson (sorted keys), certHash
  src/complaint.ts             # ComplaintContract
  src/lifecycle.ts             # LifecycleContract
  test/fakeContext.ts          # in-memory stub + identity
  test/rules.test.ts, test/complaint.register.test.ts, test/complaint.workflow.test.ts, test/lifecycle.test.ts
api/
  package.json, tsconfig.json, vitest.config.ts
  src/config.ts, src/db.ts, src/migrate.ts, src/crypto.ts, src/blob.ts
  src/auth/{passwords.ts,totp.ts,tokens.ts,plugin.ts,authorize.ts,routes.ts}
  src/ledger/{ledger.ts,fakeLedger.ts,fabricLedger.ts,errors.ts,identity.ts}
  src/users/{service.ts,routes.ts}
  src/cases/{service.ts,projection.ts,routes.ts}
  src/evidence/{service.ts,routes.ts}
  src/workflow/{routes.ts,ticker.ts}
  src/triage/{risk.ts,similarity.ts,lifecycleSuggest.ts,aiClient.ts,job.ts}
  src/audit/routes.ts
  src/seed/{index.ts,prng.ts,domain.ts,users.ts}
  src/app.ts, src/server.ts
  scripts/demo-smoke.ts
  test/helpers.ts + one test file per module
ai/
  requirements.txt, main.py, analyze.py, entities.py, corpus/generate.py, train_classifier.py
  tests/test_entities.py, tests/test_analyze.py, tests/test_corpus.py
web/
  src/main.tsx, src/api.ts, src/auth.tsx, src/routes.tsx
  src/pages/{Login,SubmitComplaint,MyCases,CaseDetail,TriageQueue,ReviewQueue,AuditConsole}.tsx
  src/components/{RiskBars,LedgerHistory,EvidencePanel,ApprovalProgress,StatusTimeline}.tsx
```

---

## Week 1 — Foundations and chaincode

### Task 1: Repository scaffold, local services, schema

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml`, `db/migrations/001_init.sql`, `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`, `api/src/db.ts`, `api/src/migrate.ts`
- Test: `api/test/migrate.test.ts`

**Interfaces:**
- Produces: `createPool(url: string): pg.Pool`; `migrate(pool: pg.Pool, dir = 'db/migrations'): Promise<string[]>`. It applies unapplied `*.sql` files in sorted order, each in one transaction, records them in `schema_migrations(name text pk, applied_at timestamptz)`, and returns the names it applied. Test DB URL comes from `TEST_DATABASE_URL`.

- [ ] **Step 1:** `git init`. Create `.gitignore`: `node_modules, dist, .env, *.local.json, ai/models, ai/data, .venv, minio-data, pg-data`.
- [ ] **Step 2:** Write `docker-compose.yml`:
  - `postgres`: `pgvector/pgvector:pg16`, port 5432, `POSTGRES_USER/PASSWORD/DB=aegis`, plus an init script that creates `aegis_test`.
  - `minio`: `minio/minio`, `server /data --console-address :9001`, ports 9000/9001.
  - Fill `.env.example` with every variable from PMD §17.3, plus `TEST_DATABASE_URL`, `FABRIC_ORG1_PEER=localhost:7051`, `FABRIC_ORG2_PEER=localhost:9051`, `FABRIC_ORG1_CA=https://localhost:7054`, `FABRIC_ORG2_CA=https://localhost:8054`, `FABRIC_ORGS_DIR=~/fabric-samples/test-network/organizations`.
- [ ] **Step 3:** Write `001_init.sql`. Use the PMD §6.2 tables restricted to: `users, pseudonyms, cases, case_content, case_ai, case_links, evidence, findings, appeals, depots, locations, assets, personnel, lifecycle_events, sensor_readings, access_events`, plus `create extension vector` and `create sequence case_seq`. Changes versus the PMD:
  - `users` gains `pseudo text unique` and `totp_confirmed bool default false`.
  - `cases` gains `pseudonym text not null`, `occurred_at timestamptz`, `outcome text`, `triage_status text not null default 'PENDING' check (triage_status in ('PENDING','DONE','FAILED'))`, `triage_attempts int not null default 0`, `ledger_json jsonb not null`.
  - Every FK column gets an index.
- [ ] **Step 4:** Write a failing test, `migrate.test.ts › applies 001_init and is idempotent`. It drops and recreates the `public` schema in `aegis_test`, then asserts:
  ```ts
  expect(await migrate(pool)).toEqual(['001_init.sql']);
  expect(await migrate(pool)).toEqual([]);
  const { rows } = await pool.query(`select extname from pg_extension where extname='vector'`);
  expect(rows).toHaveLength(1);
  ```
- [ ] **Step 5:** Run `docker compose up -d && pnpm --filter @aegis/api test migrate`. Expected: FAIL (`migrate` is not defined).
- [ ] **Step 6:** Implement `createPool` and `migrate` as specified in the Interfaces block.
- [ ] **Step 7:** Run the same command. Expected: PASS.
- [ ] **Step 8:** Commit: `chore: scaffold monorepo, compose services, initial schema`.

### Task 2: Chaincode skeleton, fake context, Fabric network scripts

**Files:**
- Create: `chaincode/aegis-cc/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/types.ts,src/ctxutil.ts,src/complaint.ts}`, `chaincode/aegis-cc/test/fakeContext.ts`, `chaincode/aegis-cc/test/ctxutil.test.ts`, `network/{up.sh,deploy.sh,down.sh,README.md}`

**Interfaces:**
- Produces in `types.ts`: the exact union types from Global Constraints, plus:
  ```ts
  type CaseStatus = 'SUBMITTED'|'TRIAGED'|'ASSIGNED'|'UNDER_INVESTIGATION'|'FINDINGS_SUBMITTED'|'CLOSED'|'APPEALED'|'CLOSED_FINAL'|'MERGED_DUPLICATE';
  interface Actor { id: string; role: Role; unit: string; depot: string; pseudo: string }   // depot 'NONE' for oversight staff
  interface Approval { signer: string; role: Role; decision: 'APPROVE'; findingsHash: string; at: string }
  interface CoiResult { passed: boolean; violations: ('R1'|'R2'|'R3'|'R4')[]; rulesEvaluated: ['R1','R2','R3','R4'] }
  interface CaseRecord { docType:'case'; caseId; complainantPseudonym; complainantCertHash; caseSalt; status: CaseStatus;
    category: Category|null; riskScore: number|null; riskLevel: RiskLevel|null; assetRefs: string[]; locationRef: string; depot: string;
    linkedEventIds: string[]; relatedCaseIds: string[]; duplicateOf: string|null; contentHash: string; aiResultHash: string|null;
    investigator: Omit<Actor,'role'>|null; coi: CoiResult|null; findingsHash: string|null; outcome: Outcome|null;
    approvals: Approval[]; closureApprovers: string[]; slaDueAt: string; escalationLevel: 0|1|2|3; closedAt: string|null;
    createdAt: string; updatedAt: string; version: number }
  interface LifecycleEvent { docType:'event'; eventId; assetRef; eventType: EventType; fromLocation: string|null; toLocation: string|null;
    quantity: number; actorPseudo: string; actorUnit: string; occurredAt: string; payloadHash: string; recordedBy: string }
  type Outcome = 'SUBSTANTIATED'|'PARTIALLY_SUBSTANTIATED'|'NOT_SUBSTANTIATED';
  type EventType = 'PROCUREMENT'|'RECEIPT'|'INSPECTION'|'STORAGE_MOVE'|'ISSUE'|'RETURN'|'RECONCILIATION'|'DISPOSAL'|'INCIDENT';
  ```
- Produces in `ctxutil.ts`:
  - `actorOf(ctx): Actor`
  - `requireRole(ctx, ...roles: Role[]): Actor` (throws `FORBIDDEN: role <r>`)
  - `txTime(ctx): Date`
  - `getJson<T>(ctx, type: string, keyParts: string[]): Promise<T|null>`
  - `putJson(ctx, type, keyParts, value): Promise<void>` (deterministic, sorted-key JSON)
  - `certHash(certId: string, salt: string): string` (SHA-256 hex of `certId + '|' + salt`)
  - `fail(code: string, msg?: string): never` (throws `Error(code + (msg ? ': ' + msg : ''))`)
- Produces in `test/fakeContext.ts`:
  - `newWorld(): FakeWorld` (shared `state`, `history`, `events`)
  - `ctxFor(world, actor: Actor, opts?: { txId?: string; time?: Date }): Context`
  - The stub implements `getState, putState, createCompositeKey, getStateByPartialCompositeKey, getHistoryForKey, getTxID, getTxTimestamp, setEvent`. `clientIdentity` implements `getID, getMSPID, getAttributeValue`.
- `ComplaintContract` has `ping(ctx): Promise<string>`, which returns `'pong'`. Contract name is `'complaint'`.

- [ ] **Step 1:** Create the npm project: deps `fabric-contract-api@2.5`, `fabric-shim@2.5`, `json-stringify-deterministic`; dev deps `typescript`, `vitest`, `unplugin-swc`, `@swc/core`. Turn on `experimentalDecorators` and `emitDecoratorMetadata`. Scripts: `build: tsc`, `start: fabric-chaincode-node start`, `test: vitest run`. `vitest.config.ts` uses `swc.vite()` so decorator metadata is emitted.
- [ ] **Step 2:** Write the failing test `ctxutil.test.ts`. It asserts:
  - `requireRole(ctxFor(w,{...role:'AUDITOR'}),'INVESTIGATOR')` throws `/^FORBIDDEN/`.
  - `putJson` then `getJson` round-trips.
  - Stored bytes for `{b:1,a:2}` equal `'{"a":2,"b":1}'`.
  - `txTime` returns the `time` passed to `ctxFor`.
  - `certHash('x','s')` equals `sha256('x|s')`.
- [ ] **Step 3:** Run `cd chaincode/aegis-cc && npm test`. Expected: FAIL.
- [ ] **Step 4:** Implement `types.ts`, `ctxutil.ts`, `fakeContext.ts`, `complaint.ts` (only `ping`) and `index.ts` (`export const contracts = [ComplaintContract]`).
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Write the network scripts:
  - `network/up.sh`: `cd ~/fabric-samples/test-network && ./network.sh up createChannel -c aegischannel -ca`.
  - `network/deploy.sh`: takes `$1` = sequence/version. Runs `./network.sh deployCC -c aegischannel -ccn aegis-cc -ccp ~/aegis/chaincode/aegis-cc -ccl typescript -ccv $1 -ccs $1`.
  - `network/down.sh`: `./network.sh down`.
  - `network/README.md`: the install steps from PMD §17.2 steps 1–4 and the symlink `ln -s "/mnt/d/projects/Aegis-Blockchain Munitions" ~/aegis`.
- [ ] **Step 7:** Verify on the real network. Run `network/up.sh && network/deploy.sh 1`, then in test-network with the Org1 env sourced:
  ```bash
  peer chaincode query -C aegischannel -n aegis-cc -c '{"function":"complaint:ping","Args":[]}'
  ```
  Expected output: `pong`.
- [ ] **Step 8:** Commit: `feat(chaincode): skeleton, ctx utilities, fake context, network scripts`.

### Task 3: Pure workflow rules

**Files:**
- Create: `chaincode/aegis-cc/src/rules.ts`
- Test: `chaincode/aegis-cc/test/rules.test.ts`

**Interfaces:**
- Produces:
  - `POLICY` (exact values from Global Constraints, plus `untriagedSlaHours: 24`)
  - `TERMINAL: CaseStatus[] = ['CLOSED_FINAL','MERGED_DUPLICATE']`
  - `assertTransition(from: CaseStatus, to: CaseStatus): void` (throws `INVALID_TRANSITION: A->B`)
  - `riskLevelFromScore(score: number): RiskLevel`
  - `checkCoi(i: CoiInput): CoiResult`
  - `quorumMet(level: RiskLevel, approvals: Approval[]): boolean`
  - `escalationLevel(now: Date, slaDueAt: Date, slaHours: number): 0|1|2|3`
  - `addHours(d: Date, h: number): string` (returns ISO)
  - `CoiInput = { investigatorCertHash; complainantCertHash; investigatorUnit; investigatorDepot; investigatorPseudo; caseDepot; implicatedUnits: string[]; recentActorPseudos: string[] }`
- Allowed transitions (exact list): SUBMITTED→TRIAGED, SUBMITTED→MERGED_DUPLICATE, TRIAGED→MERGED_DUPLICATE, TRIAGED→ASSIGNED, ASSIGNED→UNDER_INVESTIGATION, UNDER_INVESTIGATION→FINDINGS_SUBMITTED, FINDINGS_SUBMITTED→UNDER_INVESTIGATION, FINDINGS_SUBMITTED→CLOSED, CLOSED→APPEALED, CLOSED→CLOSED_FINAL, APPEALED→FINDINGS_SUBMITTED, APPEALED→CLOSED_FINAL.
- COI rules:
  - R1: `investigatorCertHash === complainantCertHash`
  - R2: `implicatedUnits.includes(investigatorUnit)`
  - R3: `recentActorPseudos.includes(investigatorPseudo)`
  - R4: `investigatorDepot === caseDepot`
- Escalation: `overdue = now − due`. If `overdue ≤ 0` → 0; `< 0.5·sla` → 1; `< 1·sla` → 2; otherwise 3.
- `quorumMet` counts **distinct signers** per role. The requirement `[SAFETY_OFFICER, REVIEW_BOARD, REVIEW_BOARD]` needs one SO and two different RB signers.

- [ ] **Step 1:** Write failing tests:
  ```ts
  it('rejects CLOSED -> ASSIGNED', () => expect(() => assertTransition('CLOSED','ASSIGNED')).toThrow(/^INVALID_TRANSITION/));
  it.each([[0.34,'LOW'],[0.35,'MEDIUM'],[0.59,'MEDIUM'],[0.6,'HIGH'],[0.8,'CRITICAL']])('risk %s -> %s', (s,l) => expect(riskLevelFromScore(s)).toBe(l));
  it('flags R1 and R4 together', () => expect(checkCoi({...base, investigatorCertHash:'h', complainantCertHash:'h', investigatorDepot:'DEP-01', caseDepot:'DEP-01'}).violations).toEqual(['R1','R4']));
  it('passes a clean investigator', () => expect(checkCoi(base)).toEqual({passed:true, violations:[], rulesEvaluated:['R1','R2','R3','R4']}));
  it('HIGH quorum needs two distinct board signers', () => {
    expect(quorumMet('HIGH',[so, rb1, rb1dup])).toBe(false);   // rb1dup has the same signer as rb1
    expect(quorumMet('HIGH',[so, rb1, rb2])).toBe(true);
  });
  it.each([[-1,0],[1,1],[13,2],[24,3]])('overdue %h on 24h SLA -> level %i', (h,lvl) =>
    expect(escalationLevel(new Date(due.getTime()+h*3600e3), due, 24)).toBe(lvl));
  ```
- [ ] **Step 2:** Run `npm test rules`. Expected: FAIL.
- [ ] **Step 3:** Implement `rules.ts` as specified in the Interfaces block.
- [ ] **Step 4:** Run `npm test rules`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(chaincode): pure workflow rules`.

### Task 4: ComplaintContract — registration, evidence, triage, links, queries, access log

**Files:**
- Modify: `chaincode/aegis-cc/src/complaint.ts`
- Test: `chaincode/aegis-cc/test/complaint.register.test.ts`

**Interfaces:**
- Consumes: Task 2 `ctxutil` and `fakeContext`; Task 3 `rules`.
- Every argument is a string, as Fabric passes them. JSON arrays are passed as JSON strings. Every submit function returns the updated `CaseRecord` as a JSON string and calls `ctx.stub.setEvent('CaseUpdated', {caseId,status,txId})`.
- `registerCase(ctx, caseId, pseudonym, contentHash, assetRefsJson, locationRef)` — roles COMPLAINANT, STORE_OFFICER.
  - Validates the ID formats.
  - Throws `ALREADY_EXISTS` if the case exists.
  - Sets `caseSalt = ctx.stub.getTxID()` and `complainantCertHash = certHash(actor.id, caseSalt)`.
  - Sets `depot = locationRef.slice(0,6)`, `status SUBMITTED`, `slaDueAt = addHours(now, 24)`, `version 1`.
- `anchorEvidence(ctx, evidenceId, caseId, sha256Plain, sha3Plain, sha256Cipher, mimeType, sizeBytes)` — any role except AUDITOR and ADMIN; the case must not be terminal.
  - Stores key `EVID/[evidenceId]`.
  - Returns the evidence anchor JSON `{docType:'evidence', evidenceId, caseId, sha256Plain, sha3Plain, sha256Cipher, mimeType, sizeBytes:number, anchoredBy, anchoredAt}`.
  - Hashes must match `^[0-9a-f]{64}$`.
- `triage(ctx, caseId, category, riskScore, aiResultHash, relatedCaseIdsJson)` — role SYSTEM.
  - Transition SUBMITTED→TRIAGED.
  - Sets `riskLevel = riskLevelFromScore(score)` and `slaDueAt = addHours(now, slaHours[level])`.
- `markDuplicate(ctx, caseId, ofCaseId)` — INVESTIGATOR, SAFETY_OFFICER, REVIEW_BOARD. The target must exist and be non-terminal.
- `linkRelated(ctx, caseId, otherId)` — same roles. Adds each case to the other's `relatedCaseIds`, without duplicates.
- `linkLifecycleEvents(ctx, caseId, eventIdsJson)` — INVESTIGATOR, STORE_OFFICER. Every `EVT/[id]` must exist, otherwise `NOT_FOUND`.
- `logAccess(ctx, caseId, scope)` — any role. `scope ∈ {'FULL','EVIDENCE:<uuid>'}`. Stores `ACCESS/[caseId, txId]` `{caseId, viewer, role, scope, at}`.
- Evaluate functions:
  - `getCase(ctx, caseId)`
  - `getEvidence(ctx, evidenceId)`
  - `getCaseHistory(ctx, caseId)` returns `[{txId, at, status, actor}]`. `actor` is the `updatedBy` field, which every write sets to `actor.role + ':' + actor.id`.
  - `getAccessLog(ctx, caseId)`

- [ ] **Step 1:** Write failing tests (one `it` each):
  - `register sets SUBMITTED, depot DEP-02, 24h SLA, salted cert hash`
  - `register twice -> ALREADY_EXISTS`
  - `register by INVESTIGATOR -> FORBIDDEN`
  - `register with bad locationRef 'DEP-2/MAG-01' -> INVALID_ARG`
  - `anchorEvidence rejects non-hex hash`
  - `triage HIGH score 0.7 sets slaDueAt = now+24h`
  - `triage twice -> INVALID_TRANSITION`
  - `markDuplicate moves to MERGED_DUPLICATE and records duplicateOf`
  - `linkLifecycleEvents unknown EVT -> NOT_FOUND`
  - `getCaseHistory returns one entry per write in order`
  - `logAccess entries are listed by getAccessLog`
  - `ledger state holds only hashes, ids and enums` — after registering with `contentHash = sha256('humidity complaint')`, assert no `world.state` value contains `'humidity'` and the stored `contentHash` matches `^[0-9a-f]{64}$`.
- [ ] **Step 2:** Run `npm test complaint.register`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions specified in the Interfaces block.
- [ ] **Step 4:** Run `npm test`. Expected: PASS (all chaincode tests).
- [ ] **Step 5:** Commit: `feat(chaincode): case registration, evidence anchors, triage, links, access log`.

### Task 5: ComplaintContract — assignment, findings, closure, appeals, SLA

**Files:**
- Modify: `chaincode/aegis-cc/src/complaint.ts`
- Test: `chaincode/aegis-cc/test/complaint.workflow.test.ts`

**Interfaces:**
- `assignInvestigator(ctx, caseId, investigatorId, unit, depot, pseudo)` — SAFETY_OFFICER, REVIEW_BOARD. Transition TRIAGED→ASSIGNED.
  - Builds `CoiInput`: `implicatedUnits` = `actorUnit` of linked events; `recentActorPseudos` = `actorPseudo` of linked events with `occurredAt ≥ now − 90d`; `investigatorCertHash = certHash(investigatorId, caseSalt)`.
  - Failure: `COI_VIOLATION: R2,R4`. Success: stores `coi`.
- `acceptAssignment(ctx, caseId)` — INVESTIGATOR. Caller ID must equal `investigator.id`, otherwise `FORBIDDEN`. It **re-runs COI with the caller's own certificate attributes**, so a lying API cannot bypass the check. Transition ASSIGNED→UNDER_INVESTIGATION.
- `submitFindings(ctx, caseId, findingsHash, outcome)` — the assigned investigator only. Transition UNDER_INVESTIGATION→FINDINGS_SUBMITTED. Clears `approvals`.
- `recordApproval(ctx, caseId, decision, findingsHash)` — SAFETY_OFFICER, REVIEW_BOARD.
  - Status must be FINDINGS_SUBMITTED.
  - Signer equal to the investigator, or `certHash(signer, salt) === complainantCertHash` → `INELIGIBLE_APPROVER`.
  - `findingsHash` different from the current one → `STALE_FINDINGS`. A repeat signer → `DUPLICATE_APPROVAL`.
  - `decision 'REJECT'` → UNDER_INVESTIGATION, approvals cleared.
  - `'APPROVE'` → append. If `quorumMet` → CLOSED, `closedAt = now`, `closureApprovers = signers`, `slaDueAt = now + 14d`, `escalationLevel 0`.
- `fileAppeal(ctx, caseId, reasonHash)` — COMPLAINANT. `certHash(caller, salt)` must equal `complainantCertHash`, otherwise `FORBIDDEN`. Status must be CLOSED and `now ≤ closedAt + 14d`, otherwise `APPEAL_WINDOW_CLOSED`. Transition CLOSED→APPEALED; `slaDueAt = now + slaHours[level]`.
- `decideAppeal(ctx, caseId, accept, reasonHash)` — REVIEW_BOARD, and the caller must not be in `closureApprovers` (`INELIGIBLE_APPROVER`). `'true'` → FINDINGS_SUBMITTED with approvals cleared; `'false'` → CLOSED_FINAL.
- `checkSla(ctx, caseId)` — SYSTEM.
  - CLOSED and past `slaDueAt` → CLOSED_FINAL.
  - Other non-terminal states: `escalationLevel = max(current, escalationLevel(now, due, slaHours[level ?? 'HIGH'] or 24 when untriaged))`.
  - When the level changes, emit event `CaseEscalated {caseId, level}`.
  - Returns the case.

- [ ] **Step 1:** Write failing tests:
  - `assign blocked by R4 when investigator depot equals case depot`
  - `assign blocked by R2 when a linked event actorUnit equals investigator unit`
  - `assign blocked by R3 only within 90 days` — use event dated 100 days ago: pass; 10 days ago: fail
  - `accept by a different investigator -> FORBIDDEN`
  - `accept re-checks COI using caller cert attributes` — assign with depot 'NONE', but caller's real depot attribute is the case depot → `COI_VIOLATION: R4`
  - `investigator cannot approve own findings -> INELIGIBLE_APPROVER`
  - `stale findings hash -> STALE_FINDINGS`
  - `MEDIUM closes after SO + RB; HIGH stays open until a second distinct RB`
  - `REJECT returns to UNDER_INVESTIGATION and clears approvals`
  - `complainant appeals within 14 days; a different complainant -> FORBIDDEN; after 15 days -> APPEAL_WINDOW_CLOSED`
  - `original approver cannot decide appeal`
  - `checkSla escalates HIGH case 13h overdue to level 2 and emits CaseEscalated`
  - `checkSla finalises CLOSED case after 14 days`
- [ ] **Step 2:** Run `npm test complaint.workflow`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions specified in the Interfaces block.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(chaincode): assignment with COI, findings, quorum closure, appeals, SLA`.

### Task 6: LifecycleContract and deploy

**Files:**
- Create: `chaincode/aegis-cc/src/lifecycle.ts`
- Modify: `chaincode/aegis-cc/src/index.ts`
- Test: `chaincode/aegis-cc/test/lifecycle.test.ts`

**Interfaces:**
- Contract name `'lifecycle'`.
- `recordEvent(ctx, eventId, assetRef, eventType, fromLocation, toLocation, quantity, actorPseudo, actorUnit, occurredAt, payloadHash)` — roles STORE_OFFICER, SYSTEM.
  - Writes `EVT/[eventId]` and the index key `EVTASSET/[assetRef, occurredAt, eventId]` (value `'1'`).
  - Rules: `quantity ≥ 0` integer. An asset with a prior `DISPOSAL` event rejects any later event (`INVALID_TRANSITION`). Empty `fromLocation` / `toLocation` strings are stored as `null`.
- `getEvent(ctx, eventId)`, `getAssetHistory(ctx, assetRef)` returns events sorted by `occurredAt` using the partial composite key.
- `index.ts` exports `[ComplaintContract, LifecycleContract]`.

- [ ] **Step 1:** Write failing tests:
  - `records and retrieves an event`
  - `asset history is ordered by occurredAt`
  - `event after DISPOSAL -> INVALID_TRANSITION`
  - `COMPLAINANT cannot record -> FORBIDDEN`
  - `negative quantity -> INVALID_ARG`
- [ ] **Step 2:** Run `npm test lifecycle`. Expected: FAIL.
- [ ] **Step 3:** Implement `LifecycleContract` as specified in the Interfaces block.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Redeploy with `network/deploy.sh 2`. Query `complaint:ping` and expect `pong`. Then invoke `lifecycle:recordEvent` as Org1 admin. Expected: `FORBIDDEN` — the admin cert has no `role` attribute, which proves role checks run on real peers.
- [ ] **Step 6:** Commit: `feat(chaincode): lifecycle contract`.

---

## Week 2 — API

### Task 7: Config, crypto, blob store

**Files:**
- Create: `api/src/config.ts`, `api/src/crypto.ts`, `api/src/blob.ts`
- Test: `api/test/crypto.test.ts`, `api/test/config.test.ts`

**Interfaces:**
- `loadConfig(env = process.env): Config` — zod-validated. It covers every `.env.example` variable, plus `LEDGER_MODE: 'fabric'|'fake'` (default `'fabric'`), `AI_SERVICE_URL` and `AI_SHARED_SECRET`. Base64 secrets are decoded to Buffers and must be the right length: `AEGIS_KEK` 32, `PSEUDONYM_SECRET` 32, `JWT_SECRET` 64, `WALLET_KEK` 32. Otherwise it throws, naming the variable.
- `sha256Hex(b: Buffer|string): string`, `sha3Hex(b): string`
- `seal(plain: Buffer, kek: Buffer): Sealed` where `Sealed = { ciphertext: Buffer; iv: Buffer; authTag: Buffer; dekWrapped: Buffer }`. `dekWrapped` is `iv(12)|tag(16)|ct(32)`, 60 bytes.
- `open(s: Sealed, kek: Buffer): Buffer` — throws `INTEGRITY_ERROR` on tag failure.
- `sealString(s: string, kek)` returns a single Buffer `iv|tag|dekWrapped(60)|ct`; `openString(b: Buffer, kek): string` reverses it. These are used for the `bytea` columns.
- `pseudonymFor(secret: Buffer, userId: string, caseId: string): string` → `'PSN-' + hmacSha256Hex(userId+'|'+caseId).slice(0,12)`
- `interface BlobStore { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; delete(key: string): Promise<void> }`
- `S3BlobStore(cfg)` uses `@aws-sdk/client-s3` and creates the bucket if it is missing. `MemoryBlobStore` is for tests.

- [ ] **Step 1:** Write failing tests:
  - `seal/open round-trips`
  - `flipping one ciphertext byte -> INTEGRITY_ERROR`
  - `two seals of same plaintext differ in ciphertext`
  - `dekWrapped is 60 bytes`
  - `sha3Hex('abc') === '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'`
  - `pseudonymFor is stable and differs per caseId`
  - `loadConfig rejects a 16-byte AEGIS_KEK naming the variable`
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test crypto config`. Expected: FAIL.
- [ ] **Step 3:** Implement with `node:crypto` (`createCipheriv('aes-256-gcm')`, `createHash('sha3-256')`).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): config, envelope encryption, hashing, pseudonyms, blob store`.

### Task 8: Authentication and authorisation

**Files:**
- Create: `api/src/auth/{passwords.ts,totp.ts,tokens.ts,plugin.ts,authorize.ts,routes.ts}`, `api/src/app.ts`, `api/src/server.ts`, `api/test/helpers.ts`
- Test: `api/test/auth.test.ts`, `api/test/authorize.test.ts`

**Interfaces:**
- `buildApp(deps: AppDeps): FastifyInstance` with `AppDeps = { cfg: Config; pool: pg.Pool; ledger: Ledger; blobs: BlobStore; ai: AiClient; now?: () => Date }`. `Ledger` and `AiClient` are defined in Tasks 9 and 15; until then `helpers.ts` passes typed stubs.
- `test/helpers.ts`:
  - `makeTestApp(overrides?): Promise<{app, deps, login(username): Promise<string /*access token*/>}>` — migrates a fresh `aegis_test` schema, uses `MemoryBlobStore`, a fake AI, and `LEDGER_MODE='fake'`. It uses a no-op ledger stub in this task and switches to `FakeLedger` when Task 9 lands.
  - `createUser(deps, {username, role, unit, depot, pseudo}): Promise<{id, password, totpSecret}>` — totp is already confirmed.
- Routes:
  - `POST /api/v1/auth/login {username,password}` → `{mfaRequired:true, mfaToken}`. `mfaToken` is a JWT with `typ:'mfa'` lasting 5 min.
  - `POST /api/v1/auth/mfa/verify {mfaToken, code}` → `{accessToken, user:{id,role,unit,depot}}` and sets the `aegis_refresh` cookie.
  - `POST /auth/mfa/enroll` → `{otpauthUrl}` (users with `totp_confirmed=false`). `POST /auth/mfa/confirm {code}`.
  - `POST /auth/refresh`, `POST /auth/logout`.
  - A wrong password and an unknown user return the identical `401 {error:{code:'INVALID_CREDENTIALS'}}`.
  - `@fastify/rate-limit`: 5 per minute on login.
- `plugin.ts` decorates `request.user: AuthUser = {id, role, unit, depot, pseudo}` and exposes `requireAuth` / `requireRoles(...roles)`.
- `authorize(user: AuthUser, action: Action, c?: {depot: string; investigatorUserId: string|null; ownedByUser: boolean}): boolean`. Rules for each `Action`:

  | Action | Allowed |
  |---|---|
  | `case:create` | COMPLAINANT, STORE_OFFICER |
  | `case:read:summary` | the owning complainant; a STORE_OFFICER of the same depot; any oversight role |
  | `case:read:full` | the assigned INVESTIGATOR; SAFETY_OFFICER; REVIEW_BOARD; AUDITOR |
  | `evidence:upload` | case owner; same-depot STORE_OFFICER; the assigned INVESTIGATOR |
  | `evidence:read` | same as `case:read:full`, except AUDITOR may only verify, not download |
  | `case:assign` | SAFETY_OFFICER, REVIEW_BOARD |
  | `case:review` | SAFETY_OFFICER, REVIEW_BOARD |
  | `audit:read` | AUDITOR, REVIEW_BOARD |
  | `user:admin` | ADMIN |

  Oversight roles are INVESTIGATOR, SAFETY_OFFICER, REVIEW_BOARD and AUDITOR.

- [ ] **Step 1:** Write failing tests:
  - `full login flow with valid TOTP returns access token`
  - `wrong TOTP -> 401 INVALID_MFA`
  - `unknown user and wrong password give identical 401 body`
  - `6th login in a minute -> 429`
  - `access token expires after 15 min` (inject `now`)
  - `authorize matrix` — table-driven `it.each` over every row in the Interfaces table, with one allowed and one denied example per action
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test auth authorize`. Expected: FAIL.
- [ ] **Step 3:** Implement with `argon2`, `otplib`, `@fastify/jwt`, `@fastify/cookie` and `@fastify/rate-limit`. Errors use the shape `{error:{code,message}}` through one `setErrorHandler`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): password+TOTP auth, JWT, authorize policy`.

### Task 9: Ledger port, Fabric identities, user creation

**Files:**
- Create: `api/src/ledger/{ledger.ts,errors.ts,fakeLedger.ts,fabricLedger.ts,identity.ts}`, `api/src/users/{service.ts,routes.ts}`
- Test: `api/test/ledger.fake.test.ts`, `api/test/users.test.ts`, `api/test/ledger.fabric.int.test.ts` (runs only when `FABRIC_IT=1`)

**Interfaces:**
- `ledger.ts`:
  ```ts
  interface LedgerUser { userId: string; role: Role; unit: string; depot: string; pseudo: string; certPem?: string; keyPem?: string }
  interface Ledger {
    submit<T = unknown>(user: LedgerUser, fn: string, args: string[]): Promise<{ txId: string; result: T }>;   // fn like 'complaint:registerCase'
    evaluate<T = unknown>(user: LedgerUser, fn: string, args: string[]): Promise<T>;
  }
  ```
- `errors.ts`: `class LedgerError extends Error { code: string }`. It is parsed from the chaincode message prefix (`FORBIDDEN | NOT_FOUND | INVALID_ARG | INVALID_TRANSITION | COI_VIOLATION | INELIGIBLE_APPROVER | STALE_FINDINGS | DUPLICATE_APPROVAL | APPEAL_WINDOW_CLOSED | ALREADY_EXISTS | MVCC_READ_CONFLICT | UNAVAILABLE`). `httpStatusFor(code)` maps: FORBIDDEN and INELIGIBLE_APPROVER → 403, NOT_FOUND → 404, INVALID_ARG → 400, UNAVAILABLE → 503, everything else → 409.
- `FakeLedger` (constructor `new FakeLedger(clock: () => Date)`) runs the real contract classes, imported from `../../../chaincode/aegis-cc/src`, against one shared `newWorld()`. It uses `ctxFor(world, {id: 'x509::' + userId, ...user})` and generates sequential txIds `tx-000001`. Chaincode errors become `LedgerError`.
- `FabricLedger(cfg)`:
  - One gRPC client per org peer, with TLS cert from `FABRIC_ORGS_DIR`.
  - For each call, `connect({client, identity:{mspId, credentials:certPem}, signer: signers.newPrivateKeySigner(createPrivateKey(keyPem))})` → `getNetwork('aegischannel').getContract('aegis-cc')`.
  - `submit` uses `submitAsync` + `getStatus()`. A non-successful commit maps to `MVCC_READ_CONFLICT` when the status code is MVCC; gRPC UNAVAILABLE maps to `UNAVAILABLE`.
- `identity.ts`:
  - `orgFor(role): 'Org1MSP'|'Org2MSP'`
  - `enrollUser(cfg, u: {username, role, unit, depot, pseudo}): Promise<{certPem, keyPem, fabricId}>` — uses `fabric-ca-client`. It registers with attributes `role, unit, depot, pseudo` (`ecert:true`), then enrolls with `attr_reqs` for all four. The registrar is the CA admin (`admin/adminpw` from test-network).
  - `loadLedgerUser(deps, userId): Promise<LedgerUser>` — decrypts the wallet with `WALLET_KEK`.
  - `systemUser(deps): Promise<LedgerUser>` — the user named `system`.
- `users/service.ts`: `createUser(deps, input): Promise<{id, initialPassword}>`. It generates a password, hashes it, enrols with Fabric only when `deps.cfg.LEDGER_MODE === 'fabric'`, and seals the key into `wallet_key_enc`. Route `POST /api/v1/admin/users` (requires `user:admin`). `LEDGER_MODE` is `fabric | fake`, default `fabric`; tests use `fake`.

- [ ] **Step 1:** Write failing tests:
  - `FakeLedger register then getCase round-trips`
  - `FakeLedger maps chaincode FORBIDDEN to LedgerError code FORBIDDEN`
  - `httpStatusFor table`
  - `admin creates investigator; non-admin -> 403`
  - `wallet key is stored encrypted (no 'BEGIN PRIVATE KEY' bytes in row)`
  - Integration (`FABRIC_IT=1`): `enrolled COMPLAINANT can registerCase; enrolled AUDITOR gets FORBIDDEN`
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test ledger users`. Expected: FAIL.
- [ ] **Step 3:** Implement the modules specified in the Interfaces block.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then, with the network up, run `FABRIC_IT=1 pnpm --filter @aegis/api test ledger.fabric`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): ledger port, fake and Fabric adapters, CA enrolment, user admin`.

### Task 10: Cases — create, list, read, history

**Files:**
- Create: `api/src/cases/{service.ts,projection.ts,routes.ts}`
- Test: `api/test/cases.test.ts`

**Interfaces:**
- `projectCase(db: pg.PoolClient|pg.Pool, c: CaseRecord): Promise<void>` — upserts `cases` columns from the record and stores the full record in `ledger_json`. `investigator_user_id` comes from the `fabric_identity` lookup (FakeLedger IDs are `x509::<userId>`).
- `createCase(deps, user: AuthUser, input: CreateCaseInput): Promise<{caseId, pseudonym, status, txId}>`. Order of operations:
  1. Allocate `CASE-YYYY-` + 6-digit `nextval('case_seq')`.
  2. Compute the pseudonym.
  3. In one DB transaction, insert `pseudonyms`, a placeholder `cases` row with `ledger_json='{}'` and status `'PENDING_LEDGER'`, and the sealed `case_content` with `content_sha256 = sha256Hex(title+'\n'+description)`.
  4. Commit, then call `ledger.submit('complaint:registerCase', …)`.
  5. On `LedgerError`, delete those rows and rethrow.
  6. On success, `projectCase`, then call `deps.onCaseCreated?.(caseId)`. Task 15 wires triage here.
- `CreateCaseInput` (zod): `title` 5–200, `description` 20–5000, `assetRefs` 0–10 lot IDs, `locationRef` location ID, `occurredAt` ISO not in the future.
- `getCaseView(deps, user, caseId): Promise<CaseSummary|CaseFull>`:
  - Summary: `{caseId, status, category, riskLevel, slaDueAt, outcome, timeline:[{status, at}]}`.
  - Full adds `title, description, assetRefs, locationRef, riskScore, investigator, approvals, escalationLevel, relatedCaseIds, linkedEventIds, coi, ai`.
  - A full view calls `ledger.submit(user,'complaint:logAccess',[caseId,'FULL'])`.
  - Not allowed → `NOT_FOUND`.
- Routes:
  - `POST /api/v1/cases` (201)
  - `GET /api/v1/cases?status&category&risk&cursor&limit` — complainants see their own cases; store officers see their depot; oversight roles see all. Ordered by `created_at desc`.
  - `GET /api/v1/cases/:id`
  - `GET /api/v1/cases/:id/history` — oversight roles only; `ledger.evaluate('complaint:getCaseHistory')`.

- [ ] **Step 1:** Write failing tests:
  - `complainant creates case -> 201, ledger status SUBMITTED, projection matches`
  - `content is stored sealed (no plaintext title in case_content bytes)`
  - `validation: assetRefs 'LOT-1' -> 400`
  - `ledger failure leaves no cases/pseudonyms/case_content rows` — FakeLedger wrapped to throw UNAVAILABLE → 503
  - `complainant B reading complainant A's case -> 404`
  - `store officer of DEP-01 reading DEP-02 case -> 404`
  - `investigator not assigned gets summary only`
  - `safety officer full view writes an ACCESS entry on ledger`
  - `complainant summary never contains investigator or title of other cases`
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test cases`. Expected: FAIL.
- [ ] **Step 3:** Implement the service, projection and routes as specified in the Interfaces block.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): case creation with encrypted content, projection, role-filtered reads`.

### Task 11: Evidence — upload, download, verify

**Files:**
- Create: `api/src/evidence/{service.ts,routes.ts}`
- Test: `api/test/evidence.test.ts`

**Interfaces:**
- `uploadEvidence(deps, user, caseId, file: {filename, data: Buffer}): Promise<EvidenceMeta>`:
  1. `authorize('evidence:upload')`.
  2. `fileTypeFromBuffer`. A plain-text fallback is allowed only when the extension is `.txt/.csv/.json` and the bytes decode as UTF-8. Detected type not allowed, or extension mismatch → `415 UNSUPPORTED_TYPE`.
  3. Hash, seal, `blobs.put('evidence/'+caseId+'/'+id)`.
  4. `ledger.submit('complaint:anchorEvidence')`. On failure, `blobs.delete` and rethrow.
  5. Insert the `evidence` row with `ledger_tx_id` and `original_name_enc`.
- `verifyEvidence(deps, user, caseId, evidenceId): Promise<VerifyReport>` with `VerifyReport = { evidenceId, cipherHashOk, plainSha256Ok, plainSha3Ok, ledgerMatch, ok }`. `ledgerMatch` compares the DB row hashes with `ledger.evaluate('complaint:getEvidence')`. Any decrypt failure sets the plain checks to false and does not throw.
- `downloadEvidence(...)`: `evidence:read`, `logAccess(caseId, 'EVIDENCE:'+id)`, streams plaintext with the original name in `Content-Disposition`.
- Routes:
  - `POST /api/v1/cases/:id/evidence` — `@fastify/multipart`, `limits.fileSize = 25*1024*1024` → 413 when exceeded.
  - `GET /cases/:id/evidence`
  - `GET /cases/:id/evidence/:eid/download`
  - `GET /cases/:id/evidence/:eid/verify` (`case:read:full` or `audit:read`)

- [ ] **Step 1:** Write failing tests:
  - `png upload -> 201, ledger anchor hashes equal sha256/sha3 of bytes`
  - `file named photo.png containing a PDF -> 415, no blob, no anchor`
  - `26 MB upload -> 413`
  - `anchor failure deletes the blob`
  - `verify all-green on untouched evidence`
  - `flip one byte in MemoryBlobStore -> cipherHashOk false, ok false`
  - `update evidence.sha256_plain in DB -> ledgerMatch false`
  - `download logs EVIDENCE access on ledger`
  - `auditor cannot download (403) but can verify`
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test evidence`. Expected: FAIL.
- [ ] **Step 3:** Implement the service and routes as specified in the Interfaces block.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): evidence pipeline with encryption, anchoring and verification`.

### Task 12: Workflow routes and background ticker

**Files:**
- Create: `api/src/workflow/{routes.ts,ticker.ts}`, `api/src/ledger/retry.ts`
- Test: `api/test/workflow.test.ts`, `api/test/ticker.test.ts`

**Interfaces:**
- `withMvccRetry<T>(fn: () => Promise<T>): Promise<T>` retries once on `MVCC_READ_CONFLICT`. Every workflow submit goes through it, then through `projectCase`.
- Routes under `/api/v1/cases/:id` (actor roles are enforced by chaincode; the API pre-checks with `authorize`):

  | Route | Body | Ledger call |
  |---|---|---|
  | `POST /assign` | `{investigatorUserId}` | Loads the investigator's `unit/depot/pseudo/fabric_identity` → `assignInvestigator`. A COI failure returns `409 {error:{code:'COI_VIOLATION', details:{violations:['R4']}}}` |
  | `POST /accept` | — | `acceptAssignment` |
  | `POST /findings` | `{body, outcome, correctiveAction?}` | Seals the body into `findings`; `findingsHash = sha256Hex(JSON.stringify({body, outcome, correctiveAction}))` → `submitFindings` |
  | `POST /review` | `{decision:'APPROVE'|'REJECT'}` | Uses the latest `findings.body_sha256` → `recordApproval`. A CLOSED result sets `cases.outcome` |
  | `POST /appeal` | `{reason}` | Seals into `appeals` → `fileAppeal` |
  | `POST /appeal/decide` | `{accept, reason}` | `decideAppeal` |
  | `POST /duplicate` | `{ofCaseId}` | `markDuplicate`; inserts a confirmed `case_links` DUPLICATE row |
  | `POST /links` | `{linkedCaseId}` | `linkRelated`; inserts a confirmed RELATED row |
  | `POST /lifecycle-links` | `{eventIds}` | `linkLifecycleEvents` |

- `GET /api/v1/investigators` (SAFETY_OFFICER, REVIEW_BOARD) → `[{id, username, unit, depot}]`, used by the assign dialog.
- `ticker.ts`: `runSweeps(deps, now: Date): Promise<{escalated: number; finalised: number; triaged: number}>` and `startTicker(deps, everyMs = 60_000): () => void`.
  - The SLA sweep selects `cases` where `sla_due_at < now and status not in (CLOSED_FINAL, MERGED_DUPLICATE, PENDING_LEDGER)` and runs `checkSla` as `systemUser`, then projects.
  - The triage sweep calls `deps.retryTriage?.(caseId)` for cases with `triage_status in ('PENDING','FAILED') and triage_attempts < 3 and created_at < now - 1 min`. The job is wired in Task 15.

- [ ] **Step 1:** Write failing tests for the full happy path: MEDIUM case → assign → accept → findings → SO approve → RB approve → status CLOSED, outcome set. Add:
  - `assign investigator from same depot -> 409 COI_VIOLATION with R4`
  - `investigator approving -> 403`
  - `retries once on MVCC_READ_CONFLICT` — wrap FakeLedger so the first `recordApproval` throws `MVCC_READ_CONFLICT`; expect success and exactly 2 calls
  - `appeal after 15 days -> 409 APPEAL_WINDOW_CLOSED` (inject clock)
  - ticker: `HIGH case 13h past SLA escalates to 2`, `CLOSED case 15 days old becomes CLOSED_FINAL`
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test workflow ticker`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes, retry helper and ticker as specified in the Interfaces block. `server.ts` starts the ticker.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): workflow transitions, MVCC retry, SLA and triage ticker`.

---

## Week 3 — AI, seed, audit, web, demo

### Task 13: Synthetic complaint corpus and classifier

**Files:**
- Create: `ai/requirements.txt`, `ai/corpus/generate.py`, `ai/train_classifier.py`
- Test: `ai/tests/test_corpus.py`, `ai/tests/test_classifier_metrics.py`

**Interfaces:**
- `generate(n: int = 2000, seed: int = 42) -> list[dict]` writes `ai/data/corpus.jsonl`. Each row has `{id, text, category, asset, location, filed_at, dup_group: str|None, gold_risk: str}`.
  - Categories are balanced (±5 %). At least 4 templates per category × 3–5 paraphrases.
  - 15 % of rows are near-duplicates: same asset, paraphrased, `filed_at` 0–30 days after their source, sharing `dup_group`.
  - 5 % of rows get a typo injected.
- `train(corpus_path, out_dir='ai/models') -> dict` makes a group-aware 70/15/15 stratified split (`StratifiedGroupKFold`-style: `dup_group` or `id` is the group). It fits:
  - `LogisticRegression(C=4, class_weight='balanced', max_iter=2000)` on `bge-small-en-v1.5` normalised embeddings;
  - a baseline TF-IDF(1,2)+LR.

  It saves `classifier.joblib` (with the TF-IDF model, used for keyword explanations) and `metrics.json` `{embed_lr:{macro_f1,...}, tfidf_lr:{...}}`.
- `requirements.txt` pins: fastapi, uvicorn, sentence-transformers, scikit-learn, joblib, spacy, numpy, pytest, httpx.

- [ ] **Step 1:** Write failing tests:
  - `test_corpus`: 2000 rows; every category within 190–210; no `dup_group` spans the train and test split; deterministic for the same seed.
  - `test_classifier_metrics`: after `train`, `metrics['embed_lr']['macro_f1'] >= 0.85`.
- [ ] **Step 2:** Run `python -m venv .venv && . .venv/bin/activate && pip install -r ai/requirements.txt && pytest ai/tests -k "corpus or metrics"`. Expected: FAIL.
- [ ] **Step 3:** Implement `generate` and `train` as specified in the Interfaces block.
- [ ] **Step 4:** Run `python -m ai.corpus.generate && python -m ai.train_classifier && pytest ai/tests -k "corpus or metrics"`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ai): synthetic complaint corpus and classifier training`.

### Task 14: AI service `/analyze`

**Files:**
- Create: `ai/main.py`, `ai/analyze.py`, `ai/entities.py`
- Test: `ai/tests/test_entities.py`, `ai/tests/test_analyze.py`

**Interfaces:**
- `extract_entities(text: str) -> list[dict]`. Each item is `{type: 'LOT'|'LOCATION'|'EVENT'|'CASE'|'DATE'|'QUANTITY'|'CONDITION', value, span: [start, end], source: 'regex'|'spacy'|'gazetteer'}`.
  - Regexes come from Global Constraints. The location regex also accepts the partial forms `DEP-\d{2}(/MAG-\d{2})?(/BAY-\d{2})?`.
  - The gazetteer `HIGH_SEVERITY = ['unauthorised','forced entry','seal broken','missing','leak','smoke','rust','damp','door left open','count mismatch']`.
- `POST /analyze {text}` → `{category, categoryProbs: {cat: p}, needsHumanTriage: bool, topKeywords: [str], entities, severityHits: int, embedding: float[384], modelVersion}`.
  - `needsHumanTriage` is `max(p) < 0.55`.
  - `topKeywords` are the top 5 TF-IDF features weighted by the predicted class's coefficients.
- Requests must carry the header `X-AI-Secret` equal to `AI_SHARED_SECRET`, otherwise 401. `GET /health` → `{ok:true}`.

- [ ] **Step 1:** Write failing tests:
  - `extract_entities('LOT-B03-2025-0117 at DEP-02/MAG-01/BAY-04 seal broken')` finds the LOT, the LOCATION with the exact span, and a CONDITION `'seal broken'`.
  - `/analyze` without the secret → 401.
  - `/analyze` on a held-out STORAGE_ENVIRONMENT sample returns that category, the embedding length is 384, and the embedding norm ≈ 1 (±1e-3).
- [ ] **Step 2:** Run `pytest ai/tests -k "entities or analyze"`. Expected: FAIL.
- [ ] **Step 3:** Implement. Load models once at startup.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then run `uvicorn ai.main:app --port 8001`.
- [ ] **Step 5:** Commit: `feat(ai): analyze endpoint with classification, entities, embeddings`.

### Task 15: Triage pipeline — risk, similarity, lifecycle suggestions

**Files:**
- Create: `api/src/triage/{aiClient.ts,risk.ts,similarity.ts,lifecycleSuggest.ts,job.ts}`
- Modify: `api/src/app.ts` (wire `onCaseCreated` and `retryTriage` to `runTriage`; add routes)
- Test: `api/test/risk.test.ts`, `api/test/similarity.test.ts`, `api/test/triage.test.ts`

**Interfaces:**
- `interface AiClient { analyze(text: string): Promise<AnalyzeResult> }` — `HttpAiClient(cfg)` uses `fetch` with a 20 s timeout. `AnalyzeResult` mirrors Task 14.
- `computeRisk(i: RiskInput): {score: number; level: RiskLevel; factors: {name: string; weight: number; value: number; contribution: number}[]}`:
  - `RiskInput = {category, severityHits, sensorExcursionFraction, recentRelatedCount, assetOverdue: boolean, quantityMismatch: boolean}`.
  - Weights: category 0.30, severity 0.20, sensor 0.20, recurrence 0.15, asset 0.10, quantity 0.05.
  - Values: severity `min(h,3)/3`; recurrence `min(n,3)/3`.
  - Category base: UNAUTHORISED_ACCESS 1.0, SAFETY_PROCEDURE_VIOLATION 0.9, STORAGE_ENVIRONMENT 0.8, INVENTORY_DISCREPANCY 0.8, DOCUMENTATION_CUSTODY_GAP 0.7, TRANSPORT_HANDLING_DAMAGE 0.6, PACKAGING_LABELLING_DEFECT 0.5, INSPECTION_OVERDUE 0.5, FACILITY_EQUIPMENT_FAULT 0.4, CONDUCT_PROCESS_GRIEVANCE 0.3.
  - `level` comes from the chaincode `riskLevelFromScore` (imported by relative path).
- `riskContext(db, caseId): Promise<Omit<RiskInput,'category'|'severityHits'>>`:
  - `sensorExcursionFraction`: hours in the last 7 days before `occurred_at` where the location's temp or RH was out of its bounds ÷ 168.
  - `recentRelatedCount`: RELATED/DUPLICATE suggestions on the same asset or location within 90 days.
  - `assetOverdue`: any referenced asset past `manufactured_on + shelf_life_months`.
  - `quantityMismatch`: any RECONCILIATION event on the assets in the last 30 days with `payload.discrepancy ≠ 0`.
- `findSimilar(db, caseId): Promise<{caseId; linkType: 'DUPLICATE'|'RELATED'; score: number; reasons: string[]}[]>` plus `isRecurring(db, caseId): Promise<boolean>`. Uses pgvector `1 - (embedding <=> $1)`, top 20 within the last 180 days, excluding itself. Boosts: +0.05 same asset, +0.05 same location, +0.03 same category, capped at 1. Thresholds come from Global Constraints. Reasons look like `"cosine 0.93"`, `"same lot LOT-…"`, `"filed 4 days apart"`.
- `suggestLifecycleEvents(db, caseId): Promise<LifecycleEventRow[]>` — events on the case assets, or on assets at the case location when the case has no assets, within ±30 days of `occurred_at`; top 5. Ranking: relevance from `RELEVANCE[category]`, then nearest in time.

  | Category | Relevant event types |
  |---|---|
  | INVENTORY_DISCREPANCY | RECONCILIATION, ISSUE, RETURN |
  | STORAGE_ENVIRONMENT | STORAGE_MOVE, INSPECTION, RECEIPT |
  | PACKAGING_LABELLING_DEFECT | RECEIPT, INSPECTION |
  | DOCUMENTATION_CUSTODY_GAP | ISSUE, RETURN, STORAGE_MOVE |
  | UNAUTHORISED_ACCESS | ISSUE, STORAGE_MOVE |
  | TRANSPORT_HANDLING_DAMAGE | RECEIPT, ISSUE |
  | INSPECTION_OVERDUE | INSPECTION |
  | All others | INCIDENT |

- `runTriage(deps, caseId): Promise<void>`:
  1. Increment `triage_attempts`.
  2. Decrypt the content and call `ai.analyze`.
  3. Store `case_ai` (`category_probs`, `entities`, `embedding`, `model_versions`, `risk_explanation` = factors + `topKeywords` + `needsHumanTriage`), with `result_sha256 = sha256Hex(stable JSON of the stored AI result)`.
  4. Compute similar cases, insert unconfirmed `case_links` suggestions, compute risk.
  5. `ledger.submit(systemUser, 'complaint:triage', [caseId, category, score.toFixed(4), result_sha256, JSON.stringify(duplicateAndRelatedIds)])`, then project.
  6. Set `triage_status='DONE'`. On any error set `'FAILED'` and log it; never throw to the caller.
- Routes:
  - `GET /cases/:id/ai` (`case:read:full`)
  - `GET /cases/:id/similar` → unconfirmed and confirmed links
  - `GET /cases/:id/lifecycle-suggestions`

- [ ] **Step 1:** Write failing tests:
  - `computeRisk STORAGE_ENVIRONMENT, hits 2, sensor 0.5, related 1 -> score 0.5233 (±1e-4), MEDIUM, 6 factors summing to score`
  - `computeRisk saturates severity at 3`
  - similarity: seed 3 cases with hand-made unit embeddings (cosine 0.95 same lot 4 days apart, 0.80 other lot, 0.50) → `[DUPLICATE, RELATED]` in that order, with the third excluded
  - `three RELATED on same location within 90 days -> isRecurring true`
  - triage: `fake AI -> TRIAGED on ledger with aiResultHash equal to case_ai.result_sha256`
  - `AI throws -> case remains SUBMITTED, triage_status FAILED, attempts 1; ticker retries and succeeds`
  - `lifecycle suggestions for INVENTORY_DISCREPANCY rank RECONCILIATION first`
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test risk similarity triage`. Expected: FAIL.
- [ ] **Step 3:** Implement the modules and routes as specified in the Interfaces block.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): AI triage with explainable risk, similarity and lifecycle suggestions`.

### Task 16: Seed — users, domain data, lifecycle replay

**Files:**
- Create: `api/src/seed/{index.ts,prng.ts,domain.ts,users.ts}`
- Modify: `api/package.json` (script `seed: tsx src/seed/index.ts`)
- Test: `api/test/seed.test.ts`

**Interfaces:**
- `mulberry32(seed: number): () => number`
- `seedUsers(deps): Promise<SeedCredential[]>` creates the PMD §15.3 users plus `system` (role SYSTEM, unit U6, depot NONE). Investigators and staff get pseudos `PER-001`… `inv3` has depot `DEP-01`; every other oversight user has depot `NONE`. TOTP is pre-confirmed. It writes `seed/credentials.local.json` as `[{username, role, password, totpSecret}]`.
- `seedDomain(deps, rnd): Promise<{events: number}>` creates, deterministically with seed 42:
  - depots `DEP-01`, `DEP-02`;
  - for each depot, `MAG-01..02` × `BAY-01..04` with bounds `temp 5–30 °C`, `RH ≤ 70 %`;
  - 80 lots `LOT-A01-2025-0001…0040` at DEP-01 and `LOT-B03-2025-0101…0140` at DEP-02, item types `ITEM-TYPE-01..12`, shelf life 24–120 months, 5 lots already past shelf life;
  - 12 personnel pseudos `PER-101..112` across units U1–U3;
  - 60 days ending today of events: RECEIPT for every lot, then Poisson-ish ISSUE, RETURN, STORAGE_MOVE, INSPECTION, plus RECONCILIATION every 14 days with `payload.discrepancy`, nonzero on 3 lots;
  - hourly sensor readings for the last 14 days for every location, with DEP-02/MAG-01 all bays at RH 85 % for 48 h starting 6 days ago.

  Every event is recorded both in `lifecycle_events` and via `ledger.submit(system, 'lifecycle:recordEvent', …)`. `ledger_tx_id` is stored. Event IDs are `EVT-000001`…
- `index.ts` is idempotent: if user `system` exists, it exits with the message `already seeded`.

- [ ] **Step 1:** Write failing test `seed.test.ts` (FakeLedger). It asserts:
  - `seedUsers` returns 14 credentials;
  - running twice → second run reports `already seeded`;
  - the event count matches the DB row count and every row has a `ledger_tx_id`;
  - DEP-02/MAG-01/BAY-02 has exactly 48 readings with `rh_pct > 70`;
  - two runs with seed 42 produce identical event ID → asset maps.
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test seed`. Expected: FAIL.
- [ ] **Step 3:** Implement the seed modules as specified in the Interfaces block.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then, against Fabric: `pnpm --filter @aegis/api seed`. Expected: it completes and prints user and event counts.
- [ ] **Step 5:** Commit: `feat(api): deterministic synthetic seed with ledger replay`.

### Task 17: Audit endpoints

**Files:**
- Create: `api/src/audit/routes.ts`
- Test: `api/test/audit.test.ts`

**Interfaces (all `audit:read`):**
- `GET /api/v1/audit/reconcile` → `{checked: number, mismatches: {caseId, field, ledger, projection}[]}`.
  - For each projected case it evaluates `getCase` and compares `status, risk_level, escalation_level, investigator_user_id`.
  - It recomputes `sha256Hex(title+'\n'+description)` from decrypted `case_content` and compares that with the ledger `contentHash` (field `'content'`).
  - Ledger cases missing from the projection are not discoverable without a key scan; out of scope for the MVP.
- `POST /api/v1/audit/verify-evidence` → `{checked, failures: VerifyReport[]}`, reusing `verifyEvidence`.
- `GET /api/v1/audit/access-log?caseId=` → `ledger.evaluate('complaint:getAccessLog')`.
- `GET /api/v1/audit/cases/:id/history` → same as the case history, but auditor-accessible.

- [ ] **Step 1:** Write failing tests:
  - `clean system -> 0 mismatches`
  - `UPDATE cases SET status='CLOSED' directly -> mismatch on status`
  - `re-seal case_content with altered description -> mismatch on content`
  - `tampered blob -> verify-evidence reports failure`
  - `investigator -> 403`
- [ ] **Step 2:** Run `pnpm --filter @aegis/api test audit`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes as specified in the Interfaces block.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): audit reconcile, evidence verification, access log`.

### Task 18: Web shell, auth, complainant pages

**Files:**
- Create: `web/` (Vite React TS template), `web/src/{main.tsx,api.ts,auth.tsx,routes.tsx}`, `web/src/pages/{Login.tsx,SubmitComplaint.tsx,MyCases.tsx}`, `web/src/components/StatusTimeline.tsx`
- Test: `web/src/api.test.ts`, `web/src/routes.test.tsx`

**Interfaces:**
- `api.ts`:
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` adds the bearer token and on a 401 tries `/auth/refresh` once. Errors throw `ApiError {status, code, message, details}` from the `{error}` body.
  - `uploadEvidence(caseId, file: File): Promise<EvidenceMeta>` uses `FormData`.
- `auth.tsx`: `AuthProvider` and `useAuth(): {user: AuthUser|null; login(u,p): Promise<{mfaToken}>; verify(mfaToken, code): Promise<void>; logout()}`. The access token is held in memory only.
- `routes.tsx`: `NAV_BY_ROLE: Record<Role, {path, label}[]>`:
  - COMPLAINANT → Submit, My cases
  - STORE_OFFICER → Submit, Depot cases
  - INVESTIGATOR → My assignments
  - SAFETY_OFFICER → Triage queue, Review queue
  - REVIEW_BOARD → Review queue
  - AUDITOR → Audit console
  - ADMIN → (none in MVP)

  `RequireRole` guard redirects to `/`.
- Pages:
  - Login: username/password → TOTP code step.
  - SubmitComplaint: 4-step wizard (describe → asset/location inputs with format hints → evidence drag-drop, showing the SHA-256 after each upload → review). The receipt shows case ID, pseudonym and tx ID.
  - MyCases: list + StatusTimeline + outcome + "Appeal" button (enabled when CLOSED and within 14 days).
- Proxy `/api` → `http://localhost:3000` in `vite.config.ts`.

- [ ] **Step 1:** Write failing tests (Vitest + Testing Library):
  - `apiFetch maps {error:{code:'COI_VIOLATION'}} 409 to ApiError with code`
  - `apiFetch refreshes once on 401 then retries`
  - `NAV_BY_ROLE.COMPLAINANT has no Audit console`
- [ ] **Step 2:** Run `pnpm --filter @aegis/web test`. Expected: FAIL.
- [ ] **Step 3:** Implement with Tailwind + shadcn/ui (`button, input, card, dialog, table, badge, tabs, toast`) and TanStack Query.
- [ ] **Step 4:** Run `pnpm --filter @aegis/web test`. Expected: PASS. Then run `pnpm --filter @aegis/web dev`, log in as `comp1`, submit a complaint with one PNG, and confirm the receipt shows a tx ID.
- [ ] **Step 5:** Commit: `feat(web): shell, MFA login, complaint wizard, my cases`.

### Task 19: Web staff pages

**Files:**
- Create: `web/src/pages/{TriageQueue.tsx,CaseDetail.tsx,ReviewQueue.tsx}`, `web/src/components/{RiskBars.tsx,LedgerHistory.tsx,EvidencePanel.tsx,ApprovalProgress.tsx}`
- Test: `web/src/components/ApprovalProgress.test.tsx`, `web/src/components/RiskBars.test.tsx`

**Interfaces:**
- `ApprovalProgress({required: Role[], approvals: Approval[]})` renders `"2 of 3 signatures"` plus each slot (role, signer short ID, time). Slot matching uses the same distinct-signer rule as `quorumMet`.
- `RiskBars({factors})` renders one bar per factor, labelled `name — contribution` (2 decimals), sorted by contribution descending.
- TriageQueue (SAFETY_OFFICER): TRIAGED cases sorted by risk then SLA. The assign dialog lists `/investigators`; a COI 409 shows `"Blocked by conflict-of-interest rule R4: investigator is based at the case depot"`, with one message per rule R1–R4.
- CaseDetail tabs:
  - Overview: category + probabilities, RiskBars, `needsHumanTriage` badge, entities highlighted, SLA + escalation badge.
  - Evidence: list, verify buttons, download.
  - Lifecycle: suggestions with "link" checkboxes; linked events timeline.
  - Related: similar cases with reasons and "confirm duplicate" / "confirm related".
  - Findings: editor with outcome select (investigator).
  - Review: ApprovalProgress + approve/reject (SO/RB).
  - Ledger: LedgerHistory table (tx ID, time, status, actor role).
- ReviewQueue: FINDINGS_SUBMITTED and APPEALED cases, plus an appeal decide dialog.

- [ ] **Step 1:** Write failing tests:
  - `ApprovalProgress shows 2 of 3 for HIGH with SO + one RB`
  - `ApprovalProgress does not count the same RB twice`
  - `RiskBars sorts by contribution`
- [ ] **Step 2:** Run `pnpm --filter @aegis/web test`. Expected: FAIL.
- [ ] **Step 3:** Implement the pages and components as specified in the Interfaces block.
- [ ] **Step 4:** Run `pnpm --filter @aegis/web test`. Expected: PASS. Then click through manually: as `safety1`, assigning `inv3` shows the R4 message, assigning `inv1` succeeds, and so on through closure.
- [ ] **Step 5:** Commit: `feat(web): triage, case workspace, review and appeals`.

### Task 20: Audit console, end-to-end smoke, README

**Files:**
- Create: `web/src/pages/AuditConsole.tsx`, `api/scripts/demo-smoke.ts`, `README.md`
- Modify: `api/package.json` (script `demo:smoke: tsx scripts/demo-smoke.ts`)

**Interfaces:**
- AuditConsole has three panels:
  - **Reconcile:** a button, then a mismatch table; green "0 mismatches" when clean.
  - **Evidence integrity:** "Verify all", then a failures table.
  - **Case lookup:** ledger history + access log for one case ID.
- `demo-smoke.ts` runs against the live stack (`LEDGER_MODE=fabric`, AI service up, seeded). It reads `seed/credentials.local.json` and generates TOTP codes with otplib. It performs PMD §19.1 steps 1–7 over HTTP and asserts after each:
  1. `comp1` files the PMD demo complaint on a seeded DEP-02/MAG-01 lot, uploads a generated PNG → 201.
  2. Polls until `triage_status` DONE (≤ 60 s); risk level ≥ MEDIUM.
  3. `safety1` assigns `inv3` → 409 R4; assigns `inv1` → 200.
  4. `inv1` accepts, links the first lifecycle suggestion, submits findings.
  5. Approvals until CLOSED; `inv1` approving → 403.
  6. `comp1` appeals; `board3` decides reject → CLOSED_FINAL.
  7. Auditor reconcile → 0 mismatches; verify-evidence → 0 failures.

  It prints `DEMO OK` and exits 0. On the first failed assertion it exits 1 with the step number.
- `README.md` covers: prerequisites, the WSL symlink, `network/up.sh`, `network/deploy.sh <n>`, `docker compose up -d`, migrate, `uvicorn`, `pnpm seed`, `pnpm dev` (api + web), `pnpm demo:smoke`, and the manual tamper demo (flip a byte in MinIO via `mc`, `UPDATE cases SET status=...`, then show the audit console).

- [ ] **Step 1:** Write `demo-smoke.ts`. Run it before building AuditConsole: `pnpm --filter @aegis/api demo:smoke`. Expected: `DEMO OK`. Fix any integration defects it exposes, each in its owning module with a regression test there.
- [ ] **Step 2:** Implement AuditConsole. Run the tamper demo by hand. Expected: the console flags both the status edit and the flipped byte.
- [ ] **Step 3:** Write the README. Follow it from `network/down.sh` on a clean state through to `DEMO OK`.
- [ ] **Step 4:** Run all suites: `cd chaincode/aegis-cc && npm test`, `pnpm -r test`, `pytest ai/tests`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat: audit console, end-to-end demo smoke, README`.

---

## Schedule

| Days | Tasks | Milestone |
|---|---|---|
| 1–2 | 1, 2 | Fabric up, `ping` → `pong` |
| 3–5 | 3, 4, 5, 6 | Full chaincode rule set green on fake context and deployed |
| 6–7 | 7, 8, 9 | Real users with Fabric identities sign transactions |
| 8–10 | 10, 11, 12 | Whole workflow works via API (FakeLedger tests + Fabric integration test) |
| 11–13 | 13, 14, 15, 16 | AI triage on seeded synthetic world |
| 14–16 | 17, 18, 19, 20 | UI + `DEMO OK` on live stack |

The critical path is Task 2 (Fabric on Windows/WSL). If the network is still not working by the end of day 2, keep going with `LEDGER_MODE=fake` (Tasks 7–19 do not need the live network) and timebox the Fabric fix alongside.
