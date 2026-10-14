# AegisResolve — Product & MVP Definition Document (PMD)

**Project:** AegisResolve: An AI-Assisted, Privacy-Preserving Blockchain Platform for Evidence-Based Complaint Processing and Ammunition Lifecycle Accountability
**Owner:** Alen Varghese Soji (23BCE2206)
**Source:** `AegisResolve_Project_Document.docx` (title, problem statement, 8-layer architecture, workflow, literature, 14 objectives)
**Document date:** 2026-10-14
**Status:** Build-ready specification for the MVP

---

## 0. How to read this document

| Section | Use it for |
|---|---|
| 1–3 | What we are building and why; what is in/out of the MVP |
| 4 | Final technology choices (decided, with reasons) |
| 5 | System architecture: the 8 layers mapped to concrete services |
| 6 | Data model: on-chain vs off-chain, every table and ledger record |
| 7 | Case lifecycle state machine (the heart of the system) |
| 8 | Smart contracts (chaincode): every function and rule |
| 9 | Evidence pipeline (encryption, hashing, timestamps) |
| 10 | Identity, access control, pseudonymity |
| 11 | AI services: every model, input, output, threshold |
| 12 | Lifecycle simulator, knowledge graph, digital twin |
| 13 | REST API contract |
| 14 | Frontend screens per role |
| 15 | Synthetic dataset specification |
| 16 | Evaluation plan (objectives 12–14) |
| 17 | Repo layout, environment setup, commands |
| 18 | Build plan: week-by-week to MVP |
| 19 | Demo script, acceptance criteria, risks |

Everything here uses **synthetic data only** (objective 14). No real munitions data, personnel, or locations are used anywhere.

---

## 1. Product summary

AegisResolve treats every complaint as a **verifiable incident investigation**. A complaint is not a free-text ticket; it is a case bound to:

- the **asset** (ammunition lot / item, by synthetic ID),
- the **storage location** (depot → magazine → bay),
- the **lifecycle/custody events** of that asset (receipt, inspection, issue, return…),
- **personnel** involved (pseudonymised),
- **environmental conditions** (synthetic sensor readings),
- **evidence** (files whose hashes are anchored on a permissioned blockchain).

Its value over a conventional complaint database is four properties, each of which the MVP must demonstrably prove:

1. **Tamper evidence** — any change to a case record or evidence file is detectable.
2. **Accountability** — every state change is signed by an identifiable role holder; closure needs multiple independent signatures; conflicts of interest are blocked by code, not policy.
3. **Privacy** — complainants are pseudonymous; sensitive content never goes on-chain; each role sees only what it needs.
4. **Intelligence** — AI classifies, scores urgency, finds duplicates/related cases, and flags anomalous lifecycle/access patterns, always with an explanation.

### 1.1 Problems addressed (from source doc)

| Problem | Feature that solves it |
|---|---|
| Fragmented records, weak traceability | Case ↔ asset ↔ lifecycle-event linking; knowledge graph |
| Evidence alteration/deletion | SHA-256 + SHA3-256 hashes anchored on Fabric; integrity verification endpoint |
| Delayed investigation/escalation | Chaincode SLA rules + scheduler-triggered escalation |
| Repeated complaints undetected | Embedding similarity + asset/lot matching; recurrence detection |
| Centralised control, limited accountability | Multi-org Fabric network; k-of-n signed closure; COI checks |
| Excessive exposure of sensitive info | Off-chain AES-256-GCM storage; pseudonymous IDs; RBAC+ABAC; controlled disclosure |
| Hard to link complaints to lifecycle events | Lifecycle-event ledger + auto-suggested event links |

---

## 2. Users and roles

| Role | Key permissions | Fabric org |
|---|---|---|
| **Complainant** | Submit complaint, upload evidence, track own case (privacy-safe view), appeal | DepotOrg |
| **Store Officer** | Record lifecycle events, respond to information requests, view cases about own depot (redacted complainant) | DepotOrg |
| **Investigator** | View assigned cases in full (except complainant identity), verify evidence, submit signed findings, propose corrective action | OversightOrg |
| **Safety Officer** | Review high-risk cases, sign closure, approve corrective actions | OversightOrg |
| **Review Board** | Multi-party review, closure signature, appeal decisions | OversightOrg |
| **Auditor** | Read-only: audit trail, integrity verification, access logs, privacy-safe statistics. Never sees complainant identity | AuditOrg (or OversightOrg in MVP) |
| **Administrator** | User/role management, policy parameters (SLA, quorum). **Cannot** alter case data or sign closure | OversightOrg |

Separation-of-duties invariants (enforced in chaincode, not only UI):

- A user can never investigate, review, or close a case they filed.
- The investigator of a case cannot be one of the closure approvers other than their own "findings" signature.
- Administrator cannot hold an approver role on any case.

---

## 3. Scope

### 3.1 MVP (must ship) — maps to objectives

| # | Objective (source) | MVP deliverable |
|---|---|---|
| 1 | Tamper-evident complaint registry | Fabric `ComplaintContract`; every case and status change on-chain |
| 2 | Privacy-preserving identity, RBAC | Login + TOTP MFA; per-user Fabric X.509 identity with role attributes; per-case pseudonymous complainant ID |
| 3 | AI classification & urgency | Category classifier + explainable risk score |
| 4 | Duplicate/related/recurring detection | pgvector similarity + asset/lot rules |
| 5 | Evidence integrity | AES-256-GCM encryption, dual hashing, on-chain anchor, verify button |
| 6 | Link complaints to lifecycle events | `LifecycleContract` + synthetic events + auto-suggested links |
| 7 | Automated registration/assignment/SLA/escalation/appeals | Chaincode state machine + SLA scheduler |
| 8 | COI checks & multi-signature closure | Chaincode-enforced COI rules + k-of-n closure |
| 11 | Privacy-safe status & controlled disclosure | Role-filtered views; complainant outcome summary; disclosure grants logged on-chain |
| 14 | Demonstration on synthetic data | Seed generator + scripted end-to-end demo |

### 3.2 MVP-lite (ship a simple version, enhance later)

| # | Objective | MVP-lite version |
|---|---|---|
| 9 | Knowledge graph & digital twin | Graph built from Postgres relations, rendered with Cytoscape.js; digital twin = depot/bay status board driven by the synthetic sensor simulator |
| 10 | Explainable anomaly detection | Isolation Forest over lifecycle + access events with per-feature deviation explanations |
| 12 | Evaluation | Scripts for AI metrics, Caliper benchmark, tamper tests; usability = SUS questionnaire with 5–10 testers |
| 13 | Comparison vs centralised DB | Same API run against a `PostgresLedger` adapter vs `FabricLedger` adapter; compare tamper-evidence and performance |

### 3.3 Explicitly out of scope for MVP

- Real classified/operational data, real personnel, real depots.
- Hardware IoT sensors (simulated only).
- Hardware security modules / smart-card certificates (custodial software wallets instead; documented limitation).
- Zero-knowledge proofs, homomorphic encryption.
- Mobile apps (responsive web only).
- Production-grade multi-host Fabric deployment (single-host Docker network).

---

## 4. Technology stack (decisions)

Chosen to minimise time-to-MVP while honouring the source architecture (which names Hyperledger Fabric).

| Concern | Choice | Why |
|---|---|---|
| Blockchain | **Hyperledger Fabric 2.5 LTS**, `fabric-samples` test-network, extended to 2 orgs + 1 channel (`aegischannel`) | Named in source doc; permissioned; X.509 identities give real signer identity in chaincode; LTS = stable docs |
| Chaincode | **TypeScript** with `fabric-contract-api` | Same language as API server; one toolchain |
| Fabric client | `@hyperledger/fabric-gateway` (Node) | Current official client (old `fabric-network` SDK is deprecated) |
| API server | **Node.js 20 LTS + TypeScript + Fastify** | Fast, schema-validated routes; native Fabric gateway support |
| AI service | **Python 3.11 + FastAPI** | ML ecosystem; called only by the API server (internal network) |
| Database | **PostgreSQL 16 + pgvector** | Off-chain metadata, users, embeddings, graph edges — one database, no separate vector/graph DB |
| Evidence storage | **MinIO** (S3-compatible) storing **ciphertext only** | Simple Docker container; S3 API; swap to any S3 later |
| Job scheduler | **pg-boss** (Postgres-backed queue in Node) | SLA checks, AI jobs, retries without adding Redis |
| Frontend | **React 18 + Vite + TypeScript + Tailwind + shadcn/ui**, TanStack Query, React Router | Fast to build, good component kit |
| Graph viz | **Cytoscape.js** | Knowledge graph view |
| Charts | **Recharts** | Dashboards |
| Auth | App-managed: **argon2id** passwords + **TOTP** (otplib) + short-lived JWT (access 15 min, refresh 8 h, httpOnly cookie) | Fewer moving parts than Keycloak; meets MFA requirement |
| OCR | **Tesseract 5** via `pytesseract` (+ `pdfplumber` for text PDFs) | Offline, free |
| Speech-to-text | **faster-whisper** (`small` model, CPU int8) | Offline, good accuracy |
| Embeddings | **sentence-transformers `BAAI/bge-small-en-v1.5`** (384-dim) | Small, CPU-friendly, strong retrieval quality |
| Classification | scikit-learn **Logistic Regression on embeddings** (baseline: TF-IDF + LR) | Trainable in seconds on synthetic data; coefficients give explanations |
| NER | Regex/gazetteer for domain IDs + **spaCy `en_core_web_sm`** for dates/quantities | Domain IDs are synthetic & patterned → regex is exact |
| Anomaly detection | scikit-learn **IsolationForest** + z-score feature explanations (optional SHAP) | Simple, explainable |
| Benchmark | **Hyperledger Caliper** | Standard Fabric throughput/latency tool |
| Containers | **Docker Desktop + WSL2 (Ubuntu)** | Fabric binaries & scripts require Linux shell |
| Tests | Vitest (API/chaincode), pytest (AI), Playwright (1–2 E2E flows) | |

> **Windows note:** run *everything* (Fabric scripts, Docker, Node, Python) inside the WSL2 Ubuntu filesystem (`~/aegisresolve`), not on `D:\` via `/mnt/d`. Fabric scripts and Docker bind mounts are slow/broken across the Windows filesystem boundary.

---

## 5. Architecture

### 5.1 Layer → component mapping

| Source layer | Concrete component(s) |
|---|---|
| L1 Users | 7 roles (§2) |
| L2 Secure Application Interface | `web/` React SPA over HTTPS |
| L3 Identity & Access Management | `api/` auth module (argon2id, TOTP, JWT), RBAC/ABAC policy module, Fabric CA enrolment, pseudonym service |
| L4 AI Processing | `ai/` FastAPI service: OCR, STT, classify, extract, embed, similarity, risk score, anomaly |
| L5 Evidence Processing | `api/` evidence module: validation, metadata extraction, encrypt (AES-256-GCM), hash (SHA-256 + SHA3-256), sign, RFC 3161 timestamp |
| L6 Permissioned Blockchain | Fabric network: 2 orgs (DepotOrg, OversightOrg), 1 orderer (Raft), channel `aegischannel`; ledgers = world-state keyspaces per record type |
| L7 Smart Contracts | Chaincode package `aegis-cc` with `ComplaintContract`, `LifecycleContract`, `GovernanceContract` |
| L8 Analytics & Audit | `api/` analytics module + `ai/` anomaly + `sim/` digital twin simulator + web dashboards |

### 5.2 Runtime diagram

```mermaid
flowchart LR
  U[Browser: React SPA] -->|HTTPS + JWT| API[API server<br/>Node/Fastify]
  API -->|internal HTTP| AI[AI service<br/>FastAPI]
  API -->|SQL| PG[(PostgreSQL + pgvector)]
  API -->|S3 ciphertext| S3[(MinIO)]
  API -->|gRPC via fabric-gateway<br/>signed as the acting user| P1[Peer DepotOrg]
  API --> P2[Peer OversightOrg]
  P1 --- ORD[Orderer Raft]
  P2 --- ORD
  P1 -.chaincode.-> CC[aegis-cc]
  P2 -.chaincode.-> CC
  API -->|chaincode events| LIS[Event listener → PG projections]
  SIM[Lifecycle & sensor simulator] -->|API| API
  SCH[pg-boss scheduler] --> API
  API -->|optional| TSA[RFC 3161 TSA]
```

### 5.3 Key architectural rules

1. **The ledger is the source of truth for case state; Postgres is a projection.** The API never updates case status in Postgres directly. It submits a transaction; a chaincode-event listener updates the Postgres read model. This makes "DB edited behind the system's back" detectable (reconciliation job compares PG to ledger).
2. **Nothing sensitive on-chain.** On-chain records contain only IDs, hashes, enums, timestamps, pseudonyms, and signer identities (see §6.1).
3. **Transactions are signed by the acting user's Fabric identity**, not a shared service identity. The API holds each user's private key encrypted (custodial wallet, AES-256-GCM, KEK from env). Chaincode reads `ctx.clientIdentity` and its `role` attribute to authorise. This gives genuine per-person non-repudiation at the ledger level.
4. **Chaincode must be deterministic**: no `Date.now()`, no randomness, no external calls. Use `ctx.stub.getTxTimestamp()` for time. Timers (SLA) are driven externally by the scheduler calling `checkSla(caseId)`; the chaincode decides deterministically whether escalation is due.
5. **A `Ledger` port with two adapters** — `FabricLedger` and `PostgresLedger` (plain tables, no hash chain) — exists solely to satisfy objective 13 (comparison with a centralised DB). Selected by env `LEDGER_BACKEND=fabric|postgres`.

---

## 6. Data model

### 6.1 On-chain (world state, JSON values)

Keys use composite keys `docType~id`.

**Case** (`CASE~{caseId}`)
```json
{
  "docType": "case",
  "caseId": "CASE-2026-000123",
  "complainantPseudonym": "PSN-7f3a9c21e4b0",
  "category": "STORAGE_ENVIRONMENT",
  "riskLevel": "HIGH",
  "riskScore": 0.82,
  "status": "UNDER_INVESTIGATION",
  "assetRefs": ["LOT-A17-2025-0042"],
  "locationRef": "DEP-03/MAG-02/BAY-07",
  "linkedEventIds": ["EVT-000981", "EVT-001004"],
  "relatedCaseIds": ["CASE-2026-000097"],
  "duplicateOf": null,
  "complaintContentHash": "sha256:…",
  "aiResultHash": "sha256:…",
  "investigatorId": "x509::CN=inv.rao::OversightOrg",
  "slaDueAt": "2026-10-17T09:00:00Z",
  "escalationLevel": 0,
  "approvals": [{"role":"SAFETY_OFFICER","signer":"x509::…","at":"…","decision":"APPROVE","findingsHash":"sha256:…"}],
  "createdAt": "…", "updatedAt": "…",
  "version": 7
}
```

**Evidence anchor** (`EVID~{evidenceId}`): `caseId, sha256Plain, sha3Plain, sha256Cipher, mimeType, sizeBytes, uploaderPseudonymOrId, tsaTokenHash|null, anchoredAt`.

**Status transition** — not a separate record: every change is a Fabric transaction; history comes from `ctx.stub.getHistoryForKey("CASE~id")`. Additionally emit chaincode event `CaseTransition {caseId, from, to, actor, txId, at}`.

**Lifecycle event** (`LEVT~{eventId}`): `assetRef, eventType, fromLocation, toLocation, quantity, actorPseudonym, recordedBy, occurredAt, payloadHash`.

**Access log** (`ACCESS~{caseId}~{txId}`): `caseId, viewerId, viewerRole, scope ("SUMMARY"|"FULL"|"EVIDENCE:{id}"), purpose, at`. Written for every FULL view and every evidence decryption (batched: the API writes one access transaction per request; acceptable latency for MVP).

**Disclosure grant** (`DISC~{caseId}~{grantId}`): `granteeId, scope, reason, grantedBy, expiresAt, revoked`.

**Policy** (`POLICY~active`, GovernanceContract): SLA hours per risk level, closure quorum per risk level, COI parameters, similarity thresholds (recorded for audit), policy version.

**Assignment record** in case: investigator + COI check result `{passed: true, rulesEvaluated: [...]}`.

### 6.2 Off-chain (PostgreSQL)

```sql
-- identity
users(id uuid pk, username citext unique, password_hash text, totp_secret_enc bytea,
      role text check (role in ('COMPLAINANT','STORE_OFFICER','INVESTIGATOR','SAFETY_OFFICER','REVIEW_BOARD','AUDITOR','ADMIN')),
      unit_id text not null, depot_id text, fabric_identity text unique, wallet_key_enc bytea,
      active bool default true, created_at timestamptz default now());

-- pseudonym mapping (sealed table: only the pseudonym service reads it)
pseudonyms(pseudonym text pk, user_id uuid not null references users, case_id text not null unique,
           created_at timestamptz default now());

-- case read model (projection of ledger + encrypted content)
cases(case_id text pk, status text not null, category text, risk_level text, risk_score real,
      depot_id text, location_ref text, investigator_user_id uuid references users,
      sla_due_at timestamptz, escalation_level int default 0,
      ledger_version int not null, created_at timestamptz, updated_at timestamptz);

case_content(case_id text pk references cases, title_enc bytea, description_enc bytea,
             dek_wrapped bytea not null, content_sha256 text not null);

case_ai(case_id text pk references cases, category_probs jsonb, entities jsonb,
        risk_explanation jsonb, model_versions jsonb, result_sha256 text not null,
        embedding vector(384));
create index on case_ai using hnsw (embedding vector_cosine_ops);

case_links(case_id text references cases, linked_case_id text references cases,
           link_type text check (link_type in ('DUPLICATE','RELATED','RECURRING')),
           similarity real, reasons jsonb, confirmed_by uuid references users,
           primary key(case_id, linked_case_id));

evidence(id uuid pk, case_id text references cases, object_key text not null,
         original_name_enc bytea, mime_type text, size_bytes bigint,
         sha256_plain text not null, sha3_plain text not null, sha256_cipher text not null,
         dek_wrapped bytea not null, iv bytea not null, auth_tag bytea not null,
         exif_meta jsonb, tsa_token bytea, uploaded_by uuid references users,
         ledger_tx_id text, created_at timestamptz default now());

findings(id uuid pk, case_id text references cases, author uuid references users,
         body_enc bytea, dek_wrapped bytea, body_sha256 text, corrective_action jsonb,
         ledger_tx_id text, created_at timestamptz);

appeals(id uuid pk, case_id text references cases, reason_enc bytea, dek_wrapped bytea,
        status text, ledger_tx_id text, created_at timestamptz);

-- synthetic domain (mirrors ledger lifecycle events for querying)
depots(id text pk, name text, region text);
locations(id text pk, depot_id text references depots, magazine text, bay text,
          temp_min real, temp_max real, rh_max real);
assets(id text pk, lot_no text, item_type text, quantity int, manufactured_on date,
       shelf_life_months int, current_location text references locations, status text);
personnel(pseudo_id text pk, unit_id text, depot_id text, role text);   -- synthetic only
lifecycle_events(id text pk, asset_id text references assets, event_type text,
                 from_location text, to_location text, quantity int, actor_pseudo text,
                 occurred_at timestamptz, payload jsonb, ledger_tx_id text);
sensor_readings(location_id text, ts timestamptz, temp_c real, rh_pct real,
                door_open bool, primary key(location_id, ts));
access_events(id bigserial pk, user_id uuid, action text, resource text, ip inet,
              at timestamptz default now(), ledger_tx_id text);
anomalies(id uuid pk, source text, subject_ref text, score real, explanation jsonb,
          detected_at timestamptz, case_id text null);
```

Every foreign key gets an index. Encrypted columns are `bytea`; plaintext never stored for complaint text, findings, appeals, file names.

### 6.3 Enumerations

- **Category** (administrative/accountability only): `INVENTORY_DISCREPANCY`, `STORAGE_ENVIRONMENT`, `PACKAGING_LABELLING_DEFECT`, `DOCUMENTATION_CUSTODY_GAP`, `UNAUTHORISED_ACCESS`, `SAFETY_PROCEDURE_VIOLATION`, `INSPECTION_OVERDUE`, `TRANSPORT_HANDLING_DAMAGE`, `FACILITY_EQUIPMENT_FAULT`, `CONDUCT_PROCESS_GRIEVANCE`.
- **Risk level:** `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
- **Lifecycle event type:** `PROCUREMENT`, `RECEIPT`, `INSPECTION`, `STORAGE_MOVE`, `ISSUE`, `RETURN`, `RECONCILIATION`, `DISPOSAL`, `INCIDENT`.

---

## 7. Case lifecycle state machine

```mermaid
stateDiagram-v2
  [*] --> SUBMITTED: registerCase
  SUBMITTED --> MERGED_DUPLICATE: markDuplicate (investigator/board confirms)
  SUBMITTED --> TRIAGED: triage (AI result anchored)
  TRIAGED --> ASSIGNED: assignInvestigator (COI check passes)
  ASSIGNED --> UNDER_INVESTIGATION: acceptAssignment
  UNDER_INVESTIGATION --> INFO_REQUESTED: requestInfo
  INFO_REQUESTED --> UNDER_INVESTIGATION: provideInfo
  UNDER_INVESTIGATION --> FINDINGS_SUBMITTED: submitFindings (signed)
  FINDINGS_SUBMITTED --> UNDER_REVIEW: openReview
  UNDER_REVIEW --> UNDER_INVESTIGATION: reviewReject (needs more work)
  UNDER_REVIEW --> CORRECTIVE_ACTION: approveWithAction
  CORRECTIVE_ACTION --> UNDER_REVIEW: actionCompleted
  UNDER_REVIEW --> CLOSED: quorum of closure approvals reached
  CLOSED --> APPEALED: fileAppeal (within appeal window)
  APPEALED --> UNDER_REVIEW: appealAccepted
  APPEALED --> CLOSED_FINAL: appealRejected
  CLOSED --> CLOSED_FINAL: appeal window expires (checkSla)
  MERGED_DUPLICATE --> [*]
  CLOSED_FINAL --> [*]
```

Escalation is orthogonal: `escalationLevel` 0→1→2→3 increments when SLA is breached in any non-terminal state. Level 1 notifies the Safety Officer; level 2 the Review Board; level 3 marks the case `CRITICAL` and freezes reassignment without Board approval.

**Decision points from source doc → implementation**

| Decision | Where decided |
|---|---|
| Duplicate/related? | AI similarity suggests; human confirms → `markDuplicate` / `linkRelated` |
| High-risk? | AI risk score → `triage` sets risk level → policy picks SLA + closure quorum |
| Corrective action required? | Review outcome `approveWithAction` |
| Appeal requested? | Complainant `fileAppeal` within `appealWindowDays` (policy, default 14) |

---

## 8. Smart contracts (chaincode `aegis-cc`)

Three contracts in one package (dual-contract separation per Alsolami et al. 2025: operational vs governance).

### 8.1 Common authorisation helper

```ts
function requireRole(ctx: Context, ...roles: Role[]): Identity {
  const role = ctx.clientIdentity.getAttributeValue('role');      // set at Fabric CA enrolment
  if (!role || !roles.includes(role as Role)) throw new Error(`FORBIDDEN: role ${role}`);
  return { id: ctx.clientIdentity.getID(), role, unit: ctx.clientIdentity.getAttributeValue('unit') };
}
```

CA enrolment attributes per user: `role`, `unit`, `depot`, `uid` (app user UUID) — all with `ecert=true` so they are embedded in the certificate.

### 8.2 `ComplaintContract`

| Function | Caller role(s) | Rules |
|---|---|---|
| `registerCase(caseId, pseudonym, contentHash, assetRefs[], locationRef)` | COMPLAINANT, STORE_OFFICER | caseId unique; status=SUBMITTED; emits `CaseRegistered` |
| `anchorEvidence(evidenceId, caseId, sha256Plain, sha3Plain, sha256Cipher, mime, size, tsaHash)` | case participant | case not terminal; evidenceId unique |
| `triage(caseId, category, riskScore, riskLevel, aiResultHash, relatedCaseIds[])` | system-triage identity (OversightOrg service account — the only non-person identity) | from SUBMITTED; computes `slaDueAt` from policy |
| `markDuplicate(caseId, ofCaseId)` | INVESTIGATOR, REVIEW_BOARD | target exists & not terminal |
| `linkRelated(caseId, otherId, linkType)` | INVESTIGATOR, REVIEW_BOARD | |
| `linkLifecycleEvents(caseId, eventIds[])` | INVESTIGATOR, STORE_OFFICER | events exist |
| `assignInvestigator(caseId, investigatorId, investigatorUnit)` | SAFETY_OFFICER, REVIEW_BOARD | **runs COI check (§8.5)**; stores result |
| `acceptAssignment(caseId)` | the assigned INVESTIGATOR | |
| `requestInfo / provideInfo(caseId, requestHash)` | INVESTIGATOR / COMPLAINANT, STORE_OFFICER | |
| `submitFindings(caseId, findingsHash, correctiveActionHash?)` | assigned INVESTIGATOR | records signer identity + tx id = digital signature |
| `openReview(caseId)` | SAFETY_OFFICER, REVIEW_BOARD | |
| `recordApproval(caseId, decision, findingsHash)` | SAFETY_OFFICER, REVIEW_BOARD | signer ≠ complainant ≠ investigator; one vote per identity; `findingsHash` must equal current findings (prevents approving a stale version); when distinct-role quorum met → CLOSED |
| `approveWithAction(caseId, actionHash, ownerId, dueAt)` / `actionCompleted(caseId, evidenceHash)` | REVIEW_BOARD / STORE_OFFICER | |
| `reviewReject(caseId, reasonHash)` | SAFETY_OFFICER, REVIEW_BOARD | clears approvals |
| `fileAppeal(caseId, reasonHash)` | COMPLAINANT (pseudonym must match) | within appeal window |
| `decideAppeal(caseId, accept, reasonHash)` | REVIEW_BOARD | deciding member must not have approved the original closure |
| `checkSla(caseId)` | system scheduler identity | uses tx timestamp; escalates if overdue; finalises after appeal window |
| `logAccess(caseId, scope, purpose)` | any | append-only |
| `grantDisclosure / revokeDisclosure(caseId, granteeId, scope, reason, expiresAt)` | REVIEW_BOARD | |
| `getCase(caseId)`, `getCaseHistory(caseId)`, `verifyEvidence(evidenceId, sha256)` | role-filtered | queries (evaluate, not submit) |

**Pseudonym ownership proof for complainant actions:** the pseudonym HMAC secret never goes on-chain, so chaincode cannot recompute the pseudonym. Instead the case stores `complainantCertHash = SHA-256(complainant cert ID + caseSalt)`; chaincode recomputes from `ctx.clientIdentity.getID()` + stored salt. So the ledger can verify "same person" without revealing who.

### 8.3 `LifecycleContract`

| Function | Caller | Rules |
|---|---|---|
| `recordEvent(eventId, assetRef, eventType, from, to, qty, actorPseudo, occurredAt, payloadHash)` | STORE_OFFICER, system-simulator | allowed transitions per asset status (e.g., cannot ISSUE a DISPOSED lot); quantity non-negative |
| `getAssetHistory(assetRef)` | INVESTIGATOR, AUDITOR, SAFETY_OFFICER | rich query by assetRef (use CouchDB state DB in test-network: `-s couchdb`) |

### 8.4 `GovernanceContract`

| Function | Caller | Rules |
|---|---|---|
| `setPolicy(policyJson)` | requires **2 distinct REVIEW_BOARD signatures** via propose/approve pair | new version; old versions retained in history (controlled policy update without rewriting history — Logic J. IGPL 2025) |
| `proposePolicy / approvePolicy` | REVIEW_BOARD | |
| `getPolicy()` | any | |

Default policy:

```json
{
  "version": 1,
  "slaHours": {"LOW": 168, "MEDIUM": 72, "HIGH": 24, "CRITICAL": 6},
  "closureQuorum": {"LOW": ["SAFETY_OFFICER"], "MEDIUM": ["SAFETY_OFFICER","REVIEW_BOARD"],
                    "HIGH": ["SAFETY_OFFICER","REVIEW_BOARD","REVIEW_BOARD"],
                    "CRITICAL": ["SAFETY_OFFICER","REVIEW_BOARD","REVIEW_BOARD"]},
  "appealWindowDays": 14,
  "coi": {"custodyLookbackDays": 90, "blockSameUnitAsImplicated": true},
  "similarity": {"duplicate": 0.90, "related": 0.75}
}
```

(Repeated role in a quorum = that many *distinct* signers of that role.)

### 8.5 Conflict-of-interest rules (in `assignInvestigator`)

Fail with `COI_VIOLATION:<rule>` if any holds:

1. **R1 self-complaint:** investigator's cert hash matches `complainantCertHash`.
2. **R2 same unit:** investigator `unit` attribute equals the unit of any personnel pseudonym implicated in linked lifecycle events (event `actorPseudo` → unit is stored on-chain in the `LEVT` record as `actorUnit`).
3. **R3 recent custody:** investigator's own pseudonym appears as `actorPseudo` on any linked asset's events within `custodyLookbackDays`.
4. **R4 depot line management:** investigator `depot` attribute equals case `locationRef` depot (MVP simple rule: investigators must be external to the depot).

Result `{passed, rulesEvaluated:[R1..R4]}` stored on the case — this *is* the audit evidence that a check happened.

### 8.6 Chaincode engineering rules

- Use `@Transaction()` / `@Transaction(false)` decorators; validate every argument (length, enum, regex `^CASE-\d{4}-\d{6}$`, etc.).
- Optimistic concurrency: case JSON carries `version`; read-modify-write in a single tx; Fabric MVCC rejects conflicting concurrent updates — the API retries once on `MVCC_READ_CONFLICT`.
- Deterministic JSON: serialise with sorted keys (`json-stringify-deterministic`) so all endorsing peers produce identical write sets.
- Endorsement policy for `aegis-cc`: `AND('DepotOrgMSP.peer','OversightOrgMSP.peer')` — no single organisation can write alone (decentralised accountability).
- Unit tests with `fabric-shim` mocks (`ChaincodeStub` stubs via `sinon`) for every transition and every COI rule.

---

## 9. Evidence pipeline

```
upload (multipart, ≤ 25 MB) →
  1. validate: magic-byte sniff (file-type lib) ∈ {jpeg,png,pdf,mp3,wav,m4a,txt,csv,json}; reject mismatch with extension
  2. extract metadata: EXIF (exifr) → selected fields stored encrypted; original bytes are never modified (evidence must stay unaltered)
  3. hash plaintext: SHA-256 and SHA3-256 (node:crypto supports 'sha3-256')
  4. encrypt: random 256-bit DEK, 96-bit IV, AES-256-GCM → ciphertext + 128-bit tag
  5. wrap DEK with KEK (AES-256-KW or AES-GCM using KEK from env / file mounted secret)
  6. hash ciphertext (SHA-256) → detects storage-level tampering without decrypting
  7. optional RFC 3161 timestamp on sha256Plain (e.g. FreeTSA); store token; on-chain store hash of token
  8. put ciphertext to MinIO key evidence/{caseId}/{evidenceId}
  9. submit anchorEvidence(...) to Fabric, signed by uploader's identity
 10. enqueue AI jobs (OCR for image/pdf, STT for audio)
```

**Verification (`GET /cases/:id/evidence/:eid/verify`)**: fetch ciphertext → check sha256Cipher → decrypt → check sha256Plain & sha3Plain → compare with on-chain anchor → check TSA token if present → return per-check pass/fail. The audit dashboard has a **"Verify all evidence"** action, and the tamper demo (§19) modifies a byte in MinIO to show detection.

**Digital signatures on findings:** the Fabric transaction signature (user's X.509 key, ECDSA P-256) over `submitFindings(findingsHash)` *is* the digital signature; the UI shows signer, cert serial, tx ID, and a "verify signature" action that validates the stored transaction via `qscc GetTransactionByID`.

**Key management (MVP):** one KEK in `AEGIS_KEK` (base64, 32 bytes) loaded from a Docker secret; per-object DEKs. Documented upgrade path: HashiCorp Vault Transit. Key rotation = re-wrap DEKs only.

---

## 10. Identity, access control, privacy

### 10.1 Authentication
- Register (admin-created accounts only, except complainants may self-register in demo mode) → argon2id hash → forced TOTP enrolment (QR) on first login.
- Login = password + TOTP → access JWT (15 min, contains `sub`, `role`, `unit`, `depot`) + refresh cookie (httpOnly, SameSite=Strict, Secure).
- Rate limit login (5/min/IP + per account lockout after 10 failures, `@fastify/rate-limit`).
- On user creation the API registers & enrols the user with Fabric CA (`role`, `unit`, `depot`, `uid` attributes), stores encrypted private key + cert.

### 10.2 Authorisation (two layers, both mandatory)
- **API layer (RBAC + ABAC):** a single `authorize(user, action, resource)` policy function, table-driven:

| Action | Rule |
|---|---|
| `case:read:summary` | complainant owns pseudonym; store officer depot = case depot; oversight roles any |
| `case:read:full` | assigned investigator; safety officer; review board; active disclosure grant |
| `case:read:identity` | **nobody via UI**; only via `grantDisclosure` with scope `IDENTITY` (two board approvals) |
| `evidence:decrypt` | same as `case:read:full` + logged on-chain |
| `audit:read` | auditor, review board |

- **Chaincode layer:** role checks per §8. A compromised API cannot impersonate another person's ledger signature without their wallet key.

### 10.3 Pseudonymous complainant ID
`pseudonym = "PSN-" + hex(HMAC-SHA256(PSEUDONYM_SECRET, userId || caseId))[0:12]` — unique per case, so a complainant's cases cannot be linked to each other by anyone without the secret. The `pseudonyms` table is readable only by the pseudonym service module (separate Postgres role with `GRANT SELECT` only to that role).

### 10.4 Privacy-safe outcome
Complainant sees: status, timeline of status changes (no actor names), SLA due date, outcome category (`SUBSTANTIATED`, `PARTIALLY_SUBSTANTIATED`, `NOT_SUBSTANTIATED`, `DUPLICATE`), a board-approved outcome summary, appeal button. Never: investigator identity, other complaints, implicated personnel.

### 10.5 Privacy-safe statistics
Aggregates (counts by category/depot/month, median time-to-close) with **k-anonymity suppression**: any cell with count < 5 shown as "<5".

### 10.6 Security baseline
HTTPS (self-signed in dev via mkcert), Helmet headers, CSP, CORS locked to web origin, Zod/JSON-schema validation on every route, parameterised SQL only (use `postgres` / Kysely), no secrets in repo (`.env.example` only), audit log of admin actions on-chain.

---

## 11. AI services (`ai/`)

All endpoints internal-only (API → AI over Docker network, shared secret header). Every response includes `model_version` and an `explanation` object; the API hashes the full AI response and anchors `aiResultHash` on-chain (so AI outputs used in decisions are tamper-evident too).

| Endpoint | Input | Output | Method |
|---|---|---|---|
| `POST /ocr` | file bytes (decrypted in API memory, streamed) | `{text, confidence}` | pdfplumber for text PDFs; else Tesseract (`--oem 1 --psm 3`), OpenCV deskew/threshold preprocessing |
| `POST /stt` | audio | `{text, segments[]}` | faster-whisper `small`, `int8`, language `en` |
| `POST /analyze` | `{text, assetRefs?, locationRef?}` | category probs, entities, risk score+level+explanation, embedding | below |
| `POST /similar` | `{caseId}` | candidate list with scores & reasons | below |
| `POST /anomaly/run` | window | anomalies with explanations | below |

### 11.1 Classification
- Features: `bge-small-en-v1.5` normalised embedding (384-d) of `title + description + OCR/STT text`.
- Model: `LogisticRegression(multi_class='multinomial', C=4, class_weight='balanced')`.
- Baseline for the report: TF-IDF (1–2 grams) + LR.
- Explanation: top-3 class probabilities + top contributing keywords via the TF-IDF model's coefficients (cheap, intuitive) — show both.
- Below max-prob 0.55 → flag `NEEDS_HUMAN_TRIAGE`.
- Target on synthetic test set: macro-F1 ≥ 0.85.

### 11.2 Entity extraction
- Regex (exact for synthetic IDs): lot `LOT-[A-Z]\d{2}-\d{4}-\d{4}`, location `DEP-\d{2}(/MAG-\d{2})?(/BAY-\d{2})?`, event `EVT-\d{6}`, case `CASE-\d{4}-\d{6}`.
- spaCy: `DATE`, `TIME`, `QUANTITY`, `CARDINAL`.
- Keyword gazetteer: conditions (`humidity`, `leak`, `seal broken`, `rust`, `door left open`, `missing`, `count mismatch`…).
- Output `[{type, value, span:[start,end], source:"regex"|"spacy"|"gazetteer"}]`; UI highlights spans.

### 11.3 Urgency / risk score (explainable, deterministic)
Weighted sum, clipped to [0,1], every term reported:

| Factor | Weight | Signal |
|---|---|---|
| Category base risk | 0.30 | table: UNAUTHORISED_ACCESS 1.0, SAFETY_PROCEDURE_VIOLATION 0.9, STORAGE_ENVIRONMENT 0.8, INVENTORY_DISCREPANCY 0.8, … CONDUCT_PROCESS_GRIEVANCE 0.3 |
| Severity keywords | 0.20 | count of high-severity gazetteer terms (saturating at 3) |
| Sensor excursion | 0.20 | linked location had temp/RH out of bounds in last 7 days (fraction of hours out of bounds) |
| Recurrence | 0.15 | number of related cases on same asset/location in 90 days (saturating at 3) |
| Asset state | 0.10 | lot past shelf-life or inspection overdue |
| Quantity mismatch | 0.05 | reconciliation discrepancy on linked asset |

Levels: `<0.35 LOW`, `<0.6 MEDIUM`, `<0.8 HIGH`, else `CRITICAL`. A rule-based score is intentional: auditable and defensible; the evaluation compares it with a gradient-boosted model trained on synthetic labels as an extension.

### 11.4 Duplicate / related / recurring detection
1. Candidate retrieval: pgvector `ORDER BY embedding <=> $1 LIMIT 20` over cases in last 180 days.
2. Score `s = cos_sim + 0.05·[same asset] + 0.05·[same location] + 0.03·[same category]` (cap 1.0).
3. `s ≥ 0.90` and same asset & ≤ 30 days → **DUPLICATE** suggestion; `s ≥ 0.75` → **RELATED**; ≥ 3 RELATED on same asset/location within 90 days → **RECURRING** flag (feeds risk and dashboard).
4. Reasons returned (`["cosine 0.93", "same lot LOT-A17-2025-0042", "filed 4 days apart"]`). Human confirms; only confirmed links go on-chain.
- Target: duplicate precision ≥ 0.9, recall ≥ 0.8 on synthetic set.

### 11.5 Lifecycle event auto-linking
For a new case: query `lifecycle_events` for referenced assets (or assets at referenced location) within ±30 days of the complaint date; rank by event-type relevance to category (e.g., INVENTORY_DISCREPANCY → RECONCILIATION, ISSUE, RETURN). Suggest top 5; investigator confirms → `linkLifecycleEvents`.

### 11.6 Explainable anomaly detection
- Feature windows (daily per location and per user):
  - lifecycle: events/day, issue-return imbalance, quantity variance, off-hours event ratio, moves per lot;
  - access: case FULL-views/day, evidence decryptions/day, distinct cases viewed, off-hours ratio, views of cases not assigned (via disclosure);
  - sensor: door-open minutes, max temp deviation.
- `IsolationForest(n_estimators=200, contamination=0.02, random_state=42)` per feature family.
- Explanation: for each anomaly, features with |z-score| > 2 vs that entity's 30-day baseline, sorted (e.g., "evidence decryptions 14 vs typical 1.2 (z=6.1)"). Optional SHAP TreeExplainer for the report.
- Simulator injects labelled anomalies (§15) → measure precision@k.

---

## 12. Lifecycle simulator, knowledge graph, digital twin

### 12.1 Simulator (`sim/`, Python)
- Generates: 4 depots × 3 magazines × 8 bays; 600 lots across 12 synthetic item types (generic names: `ITEM-TYPE-01`…); 40 synthetic personnel pseudonyms across 6 units.
- Simulates 180 days of lifecycle events (Poisson rates per type) and hourly sensor readings (sinusoidal daily temperature + noise; scripted excursions).
- Writes to Postgres directly and replays lifecycle events to the ledger through the API (`recordEvent`) — batch of ~5k events; use a `system-simulator` identity.
- Injects scenarios with ground truth: humidity excursion in DEP-02/MAG-01, quantity drift on 3 lots, off-hours access burst by one investigator account, a custody chain gap.
- Deterministic with `--seed`.

### 12.2 Knowledge graph
- Nodes: Case, Asset(lot), Location, Depot, LifecycleEvent, PersonnelPseudo, Evidence, Anomaly.
- Edges derived from relational data: `CASE—CONCERNS→ASSET`, `CASE—AT→LOCATION`, `CASE—RELATED/DUPLICATE→CASE`, `CASE—LINKED→EVENT`, `EVENT—ON→ASSET`, `EVENT—BY→PERSONNEL`, `ASSET—STORED_IN→LOCATION`, `ANOMALY—FLAGS→(LOCATION|PERSONNEL|ASSET)`.
- `GET /graph?center=<nodeId>&depth=2` returns Cytoscape JSON built with recursive CTEs. No Neo4j for MVP; if graph queries become painful, migrate later.
- Insight queries shown on dashboard: "assets with ≥ 2 cases", "personnel pseudonyms connected to ≥ 3 cases via events", "locations with sensor anomalies and open cases".

### 12.3 Synthetic digital twin
A **depot board**: grid of magazines/bays coloured by state (normal / sensor excursion / open case / anomaly), live-updated (SSE `GET /twin/stream`) while the simulator replays at accelerated time (1 simulated hour per second). Clicking a bay shows its lots, sensor chart (Recharts), recent events, and cases. This demonstrates "complaint ↔ asset ↔ condition" linkage visually.

---

## 13. REST API (prefix `/api/v1`)

All bodies JSON (except uploads); errors `{error:{code,message,details?}}`; IDs validated; pagination `?cursor=&limit=` (max 100).

**Auth**
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{username,password}` → `{mfaRequired:true, mfaToken}` |
| POST | `/auth/mfa/verify` | `{mfaToken, code}` → access token + refresh cookie |
| POST | `/auth/mfa/enroll` / `/auth/mfa/confirm` | QR otpauth URI |
| POST | `/auth/refresh`, `/auth/logout` | |

**Cases**
| Method | Path | Role |
|---|---|---|
| POST | `/cases` | complainant/store officer — `{title, description, assetRefs[], locationRef, occurredAt}`; returns `{caseId, pseudonym, status}` (AI runs async) |
| GET | `/cases` | role-filtered list; filters status, category, risk, depot |
| GET | `/cases/:id` | summary or full depending on authorisation (full view logs access on-chain) |
| GET | `/cases/:id/history` | ledger history (tx id, actor role, from→to, time) |
| GET | `/cases/:id/ai` | AI result + explanation |
| GET | `/cases/:id/similar` | suggestions |
| POST | `/cases/:id/links` | confirm duplicate/related link |
| GET | `/cases/:id/lifecycle-suggestions` / POST `/cases/:id/lifecycle-links` | |
| POST | `/cases/:id/assign` | `{investigatorUserId}` → 409 `COI_VIOLATION` with rule details |
| POST | `/cases/:id/accept`, `/request-info`, `/provide-info` | |
| POST | `/cases/:id/findings` | `{body, outcome, correctiveAction?}` |
| POST | `/cases/:id/review/open`, `/review/approve`, `/review/reject`, `/review/approve-with-action` | |
| POST | `/cases/:id/actions/complete` | |
| POST | `/cases/:id/appeal`, `/appeal/decide` | |
| POST | `/cases/:id/disclosures`, DELETE `/cases/:id/disclosures/:gid` | |

**Evidence**
| POST | `/cases/:id/evidence` | multipart |
| GET | `/cases/:id/evidence` | metadata list |
| GET | `/cases/:id/evidence/:eid/download` | decrypt-stream; logs access on-chain |
| GET | `/cases/:id/evidence/:eid/verify` | integrity report |

**Lifecycle / assets**: `GET /assets/:id`, `GET /assets/:id/history` (ledger), `POST /lifecycle-events` (store officer/simulator), `GET /locations/:id/sensors?from&to`.

**Analytics & audit**: `GET /analytics/summary` (k-anon), `GET /analytics/anomalies`, `GET /graph`, `GET /twin/state`, `GET /twin/stream` (SSE), `GET /audit/access-log?caseId`, `POST /audit/verify-all`, `GET /audit/reconcile` (PG projection vs ledger diff), `GET /audit/report?from&to` (PDF via `pdfkit`).

**Admin**: `POST /admin/users`, `PATCH /admin/users/:id`, `GET /policy`, `POST /policy/proposals`, `POST /policy/proposals/:id/approve`.

---

## 14. Frontend screens

| Screen | Roles | Key elements |
|---|---|---|
| Login + MFA | all | TOTP enrol QR |
| Submit complaint (wizard) | complainant, store officer | 1 describe → 2 select asset/location (searchable) → 3 upload evidence (drag-drop, shows hash after upload) → 4 review → receipt with **case ID, pseudonym, tx ID** |
| My cases | complainant | privacy-safe status timeline, SLA date, outcome, appeal button |
| Case workspace | investigator, safety officer, board | tabs: Overview (AI category/risk with explanation bars), Evidence (verify badges), Lifecycle (suggested + linked events timeline), Related cases, Findings editor, Review & approvals (quorum progress “2 of 3 signatures”), Ledger history (tx IDs) |
| Triage queue | safety officer | unassigned cases by risk; assign dialog showing COI result per candidate |
| Review board queue | board | cases awaiting approval / appeals |
| Asset explorer | investigator, auditor | asset ledger history |
| Knowledge graph | investigator, auditor | Cytoscape, filters by node type |
| Digital twin board | safety officer, auditor | depot grid, live |
| Anomaly dashboard | safety officer, auditor | ranked anomalies with explanations; "open case from anomaly" |
| Audit console | auditor | access log, verify-all evidence, PG↔ledger reconciliation, report export |
| Statistics | auditor, board | k-anonymised charts |
| Admin | admin | users, roles, policy proposals |

Accessibility: shadcn/Radix primitives (keyboard + ARIA), colour never the only indicator of state (icons + labels on twin board).

---

## 15. Synthetic dataset specification

### 15.1 Complaints corpus (for AI training/evaluation)
- **2,000 complaints**, 10 categories (~200 each), generated by templates + paraphrase variation:
  - Templates per category with slots: `{lot}`, `{location}`, `{qty}`, `{date}`, `{condition}`, `{personnel_role}`.
  - Paraphrase: 3–5 phrasings per template, synonym substitution, sentence reordering, 5% typo injection, varied length (20–250 words).
  - Optionally expand with an LLM paraphraser offline, then manually spot-check 100 samples; record generation method in the report.
- Labels: `category`, `gold_risk_level` (assigned by rule + manual adjustment on 200 samples), `duplicate_group_id` (15% of complaints are near-duplicates of another: same asset, re-phrased, filed 0–30 days later), `related_group_id` (10%).
- Split 70/15/15 stratified; **group-aware split** so a duplicate group never spans train/test.
- Evidence samples: 50 synthetic images (rendered labels/forms with text → OCR test, generated with Pillow), 20 short TTS audio clips (generated offline with a TTS engine) with ground-truth transcripts → WER test.

### 15.2 Lifecycle & sensor data
Per §12.1, with injected anomaly ground truth file `sim/output/ground_truth.json`.

### 15.3 Users (seed)
| username | role | unit | depot |
|---|---|---|---|
| comp1, comp2 | COMPLAINANT | U1, U2 | DEP-01, DEP-02 |
| store1, store2 | STORE_OFFICER | U1, U3 | DEP-01, DEP-03 |
| inv1, inv2, inv3 | INVESTIGATOR | U4, U5, U1 | — , —, DEP-01 (inv3 exists to trigger COI) |
| safety1 | SAFETY_OFFICER | U5 | — |
| board1, board2, board3 | REVIEW_BOARD | U6 | — |
| audit1 | AUDITOR | U6 | — |
| admin1 | ADMIN | U6 | — |

Seed passwords are generated into `seed/credentials.local.json` (git-ignored) at seed time.

---

## 16. Evaluation plan (objectives 12 & 13)

| Dimension | Metric | Method | MVP target |
|---|---|---|---|
| AI classification | macro-F1, per-class P/R, confusion matrix | held-out test set; embedding-LR vs TF-IDF-LR | ≥ 0.85 |
| Duplicate detection | precision, recall, F1 at thresholds; PR curve | pairs from test set | P ≥ 0.9, R ≥ 0.8 |
| Risk scoring | weighted κ vs gold risk, accuracy per level | | κ ≥ 0.6 |
| OCR | character error rate | 50 synthetic images | CER ≤ 5% |
| STT | word error rate | 20 clips | WER ≤ 10% |
| Anomaly | precision@10, recall of injected anomalies | ground_truth.json | P@10 ≥ 0.7 |
| Blockchain performance | TPS, avg/p95 latency for `registerCase`, `anchorEvidence`, `recordApproval`, `getCase` | **Hyperledger Caliper**, 1–50 workers, fixed-rate & fixed-load | report numbers; aim ≥ 50 TPS write on laptop |
| Tamper evidence | detection rate | 4 attacks: (a) modify evidence bytes in MinIO, (b) edit `cases.status` in Postgres, (c) replace AI result row, (d) delete a case row → verify/reconcile must flag 100%; run same attacks on `PostgresLedger` mode → shows they go **undetected** | 100% vs 0% |
| Access control | negative tests | automated suite: every role × every action matrix; plus chaincode called with wrong identity | 0 unauthorised successes |
| Privacy | leakage checks | grep ledger dump for any plaintext/PII; complainant identity reachable only via disclosure | 0 leaks |
| Smart-contract rules | COI, quorum, SLA, appeal window | unit + integration tests | all pass |
| Usability | SUS score, task completion time | 5–10 testers, 4 tasks (submit, triage+assign, review+close, audit verify) | SUS ≥ 68 |
| Comparison (obj. 13) | table: tamper detection, non-repudiation, decentralised control, latency, throughput, storage overhead | `LEDGER_BACKEND=fabric` vs `postgres` with identical API & workload | qualitative + quantitative table |

Deliver as `eval/` scripts producing CSVs + charts into `eval/results/` for the report.

---

## 17. Repository, environment, commands

### 17.1 Layout (monorepo, pnpm workspaces for JS)

```
aegisresolve/
  network/            # Fabric: scripts wrapping fabric-samples test-network, CA attribute enrolment, Caliper config
  chaincode/aegis-cc/ # TypeScript contracts + tests
  api/                # Fastify server: modules auth, cases, evidence, ledger (FabricLedger|PostgresLedger), ai-client, analytics, audit, admin, jobs
  ai/                 # FastAPI: ocr, stt, analyze, similar, anomaly; train/ scripts; models/ (git-ignored)
  sim/                # simulator + synthetic corpus generator
  web/                # React app
  eval/               # evaluation scripts, Caliper benchmarks, tamper tests
  db/migrations/      # SQL migrations (node-pg-migrate or dbmate)
  docker-compose.yml  # postgres, minio, api, ai, web (Fabric network started separately by network/ scripts)
  .env.example
  docs/
```

### 17.2 One-time setup (Windows 11)

1. Install **WSL2 + Ubuntu 24.04**; install **Docker Desktop** with WSL integration enabled for Ubuntu.
2. In Ubuntu:
   ```bash
   sudo apt update && sudo apt install -y git curl jq build-essential tesseract-ocr ffmpeg python3.11 python3.11-venv
   ```
3. Node 20 via `nvm`, then `corepack enable` (pnpm).
4. Fabric binaries & samples (pin 2.5.x and CA 1.5.x):
   ```bash
   curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh && chmod +x install-fabric.sh
   ./install-fabric.sh --fabric-version 2.5.x --ca-version 1.5.x docker samples binary
   ```
   (replace `x` with the latest 2.5 / 1.5 patch at setup time and record it in `network/VERSIONS`).
5. Start network with CA + CouchDB, create channel, deploy chaincode:
   ```bash
   cd fabric-samples/test-network
   ./network.sh up createChannel -c aegischannel -ca -s couchdb
   ./network.sh deployCC -c aegischannel -ccn aegis-cc -ccp ~/aegisresolve/chaincode/aegis-cc -ccl typescript
   ```
   Rename Org1/Org2 to DepotOrg/OversightOrg in our wrapper scripts (or keep Org1/Org2 MSP IDs and alias them in config — simplest for MVP; document it).
6. `docker compose up -d postgres minio` → run migrations → `pnpm --filter api dev`, `uvicorn ai.main:app --reload`, `pnpm --filter web dev`.
7. Seed: `pnpm seed` (users + Fabric enrolment) → `python -m sim.generate --seed 42` → `python -m sim.replay`.
8. Train AI: `python -m ai.train.classifier && python -m ai.train.anomaly`.

### 17.3 Environment variables (`.env.example`)

```
DATABASE_URL=postgres://aegis:aegis@localhost:5432/aegis
S3_ENDPOINT=http://localhost:9000  S3_BUCKET=aegis-evidence  S3_ACCESS_KEY=  S3_SECRET_KEY=
AEGIS_KEK=            # base64 32 bytes
PSEUDONYM_SECRET=     # base64 32 bytes
JWT_SECRET=           # base64 64 bytes
WALLET_KEK=           # base64 32 bytes (encrypts users' Fabric private keys)
LEDGER_BACKEND=fabric # fabric | postgres
FABRIC_PEER_ENDPOINT=localhost:7051  FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
FABRIC_TLS_CERT_PATH=  FABRIC_CHANNEL=aegischannel  FABRIC_CHAINCODE=aegis-cc
FABRIC_CA_URL=https://localhost:7054  FABRIC_CA_ADMIN=  FABRIC_CA_ADMIN_PW=
AI_SERVICE_URL=http://localhost:8001  AI_SHARED_SECRET=
TSA_URL=https://freetsa.org/tsr   # optional; empty disables
```

---

## 18. Build plan — fastest path to MVP

Principle: get one **vertical slice** working end-to-end in week 2 (submit → hash → ledger → view history), then widen. Fabric setup is the riskiest item; do it first.

| Week | Goal | Deliverables / Definition of done |
|---|---|---|
| **1 — Foundations** | Environment + skeletons | WSL2/Docker/Fabric test-network running with CA+CouchDB; monorepo scaffold; Postgres+MinIO in compose; migrations; Fastify skeleton with health check; React shell with routing; FastAPI skeleton. **DoD:** `deployCC` of a hello-world `registerCase/getCase` contract and the API invoking it |
| **2 — Vertical slice** | Submit & anchor | Auth (password+TOTP, JWT); Fabric CA enrolment per user with attributes; custodial wallet; `registerCase`, `anchorEvidence`; evidence pipeline (encrypt/hash/MinIO); chaincode event listener → PG projection; complainant submit wizard + My Cases; case history view with tx IDs; evidence verify endpoint. **DoD:** demo steps 1–3 of §19 work |
| **3 — Workflow contracts** | Full state machine | All `ComplaintContract` transitions; COI rules; quorum closure; appeals; `GovernanceContract` policy; SLA scheduler (pg-boss every minute → `checkSla`); investigator/safety/board screens. Chaincode unit tests for every rule. **DoD:** case goes SUBMITTED → CLOSED_FINAL via UI; COI violation demonstrably blocked |
| **4 — AI** | Intelligence | Synthetic corpus generator; classifier + baseline training; entity extraction; risk score; embeddings in pgvector; similarity suggestions; OCR + STT jobs; AI result anchoring; explanation UI. **DoD:** new complaint auto-triaged with explanation; duplicate suggested |
| **5 — Lifecycle, graph, twin, anomaly** | Accountability layer | Simulator + replay to `LifecycleContract`; asset history; lifecycle auto-link suggestions; knowledge graph view; digital twin board with SSE; anomaly detection + dashboard; access logging on-chain; controlled disclosure. **DoD:** demo steps 4–9 work |
| **6 — Audit, evaluation, polish** | Prove it | Audit console (verify-all, reconcile, report PDF); `PostgresLedger` adapter; tamper test suite; Caliper benchmark; AI metrics scripts; RBAC matrix tests; k-anon stats; SUS sessions; bug fixes; README + demo video. **DoD:** §16 table filled with real numbers |

**If time is tighter (3-week cut):** keep weeks 1–3 + classifier/risk/similarity from week 4 + tamper tests & Caliper from week 6. Defer STT, digital twin (replace with static depot table), anomaly detection, PDF reports.

### 18.1 Work breakdown order inside the API (dependencies)
`config → db → crypto (encrypt/hash/wrap) → auth → fabric-ca enrol + wallet → ledger port (FabricLedger) → event listener/projection → cases → evidence → ai-client → jobs (pg-boss) → analytics/graph/twin → audit → PostgresLedger`.

---

## 19. Demo script, acceptance criteria, risks

### 19.1 End-to-end demo (≈10 minutes)

1. `comp1` logs in (password + TOTP), files: *"Humidity indicator in DEP-02/MAG-01/BAY-04 showed 85% for two days; packaging on LOT-B03-2025-0117 looks damp."* uploads a photo. Receipt shows case ID, pseudonym, tx ID, evidence SHA-256.
2. AI triage appears in seconds: `STORAGE_ENVIRONMENT` (0.91), risk HIGH (0.78) with factor bars (sensor excursion detected from twin data), related case suggested (filed by `comp2` last week on same lot).
3. Auditor opens ledger history: every step with signer role + tx ID. Clicks **Verify evidence** → all checks green.
4. `safety1` tries to assign `inv3` → **blocked: COI R4 (same depot)**. Assigns `inv1` → COI passed record shown.
5. `inv1` reviews linked lifecycle events (auto-suggested RECEIPT and STORAGE_MOVE), knowledge graph shows the lot connected to 2 cases and a sensor anomaly; submits signed findings with corrective action.
6. Closure needs 3 signatures (HIGH): `safety1` approves, `board1` approves; `inv1` attempting to approve is rejected by chaincode; `board2` approves → CLOSED.
7. `comp1` sees privacy-safe outcome, files appeal; `board3` (not an original approver) decides.
8. SLA demo: a seeded case with 6h CRITICAL SLA is past due → scheduler escalates to level 2, notification shown.
9. **Tamper demo:** in a terminal, flip one byte of an evidence object in MinIO and update `cases.status` directly in Postgres → audit console flags both. Switch `LEDGER_BACKEND=postgres`, repeat → no detection. (This is the objective-13 comparison in one slide.)
10. Anomaly dashboard shows the injected off-hours evidence-access burst with explanation.

### 19.2 MVP acceptance criteria
- [ ] All 7 roles can log in with MFA; role-inappropriate routes return 403 and chaincode rejects wrong-role identities.
- [ ] No plaintext complaint text, names, or file contents exist on the ledger (verified by ledger dump scan).
- [ ] Every status change is a Fabric transaction signed by the acting user's identity; history viewable.
- [ ] Evidence verify detects any byte-level change; reconcile detects any PG projection change.
- [ ] COI rules R1–R4 each covered by a passing test and blocked in the UI.
- [ ] HIGH/CRITICAL cases cannot close without the policy quorum of distinct eligible signers.
- [ ] SLA breach escalates without human action.
- [ ] Complainant cannot see investigator identity; investigator cannot see complainant identity without a disclosure grant.
- [ ] AI returns category, risk with factor explanation, entities, similar cases for every new case; metrics meet §16 targets on synthetic test set.
- [ ] Caliper report and tamper comparison table produced.

### 19.3 Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Fabric setup on Windows is fiddly | Blocks everything | Do it in week 1 inside WSL2 filesystem; use unmodified test-network scripts; keep `PostgresLedger` adapter so API/UI work continues if Fabric breaks |
| TypeScript chaincode packaging errors | Delays | Start from `fabric-samples/asset-transfer-basic/chaincode-typescript` as the template |
| Non-deterministic chaincode → endorsement mismatch | Tx failures | No `Date.now()`/random; deterministic JSON; peer-side unit tests |
| Custodial keys weaken non-repudiation | Academic critique | Document clearly as MVP limitation; upgrade path = browser-held keys / HSM / smart cards |
| Synthetic data inflates AI metrics | Overstated results | Group-aware splits, paraphrase diversity, report on a hand-written 50-complaint challenge set too |
| Whisper/Tesseract slow on CPU | UX lag | Async jobs; `small` model int8; show "processing" state |
| Domain sensitivity | Ethics | Synthetic, generic item types only; system handles administrative accountability, contains no technical munitions data |
| Scope creep (8 layers, 14 objectives) | Miss MVP | Strict §3 scope; 3-week cut-list in §18 |

### 19.4 Future work (post-MVP)
Fabric private data collections for inter-org confidential fields; HSM/smart-card user keys; Vault-managed KEKs; real IoT ingestion (MQTT); Neo4j for larger graphs; GNN-based anomaly detection; ZK proofs for privacy-safe statistics; multi-host Fabric deployment with BFT ordering (Fabric 3.x); mobile client.

---

## Appendix A — Traceability: source doc → this PMD

| Source item | PMD section |
|---|---|
| Layer 1 users | §2 |
| Layer 2 interface | §14 |
| Layer 3 IAM (certificates, MFA, RBAC, ABAC, pseudonym, need-to-know) | §10, §8.1 |
| Layer 4 AI (OCR, STT, classification, entities, similarity, duplicates, urgency, XAI anomaly) | §11 |
| Layer 5 evidence (validation, metadata, encryption, signatures, SHA-256/SHA-3, timestamps) | §9 |
| Layer 6 Fabric ledgers (complaint, lifecycle, evidence hashes, transitions, signatures, access logs, approvals) | §6.1, §8 |
| Layer 7 contracts (registration, assignment, COI, SLA, escalation, multi-sig closure, appeals, disclosure) | §7, §8 |
| Layer 8 analytics (knowledge graph, digital twin, repeated failure, anomaly dashboard, audit reports, privacy-safe stats) | §11.6, §12, §10.5, §13 |
| On-chain vs off-chain split | §5.3, §6 |
| 21-step workflow + 4 decision points | §7 |
| Objectives 1–14 | §3, §16 |
| Literature (Kumar 2026 Fabric grievance; Alsolami 2025 dual contract/RBAC; Reno & Roy 2025 off-chain storage; IGPL 2025 contract updates; Future Internet 2025 sensor patterns) | §4, §8.4, §9, §12 |
