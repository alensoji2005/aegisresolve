# AegisResolve MVP

AI-assisted, privacy-preserving complaint processing with a permissioned blockchain (Hyperledger Fabric) for tamper-evident, signed case workflows. **Synthetic data only.**

Spec: [docs/AegisResolve_PMD.md](docs/AegisResolve_PMD.md) · Plan: [docs/superpowers/plans/2026-10-14-aegisresolve-mvp.md](docs/superpowers/plans/2026-10-14-aegisresolve-mvp.md)

| Part | Path | Stack |
|---|---|---|
| Chaincode | `chaincode/aegis-cc` | TypeScript, fabric-contract-api (contracts `complaint`, `lifecycle`) |
| API | `api` | Node 20+, Fastify, Fabric Gateway, PostgreSQL + pgvector, MinIO |
| AI service | `ai` | Python 3.10+, FastAPI, sentence-transformers (bge-small), scikit-learn |
| Web | `web` | React, Vite, Tailwind, TanStack Query |

## Setup (once)

```bash
npm install --prefix chaincode/aegis-cc
pnpm install
cp .env.example .env   # fill AEGIS_KEK, PSEUDONYM_SECRET, WALLET_KEK (openssl rand -base64 32), JWT_SECRET (openssl rand -base64 64), AI_SHARED_SECRET
py -3.10 -m venv ai/.venv && ai/.venv/Scripts/python -m pip install -r ai/requirements.txt
ai/.venv/Scripts/python -m ai.corpus.generate && ai/.venv/Scripts/python -m ai.train_classifier
```

## Option A — offline demo (no Docker, no Fabric)

Embedded Postgres (PGlite), in-memory ledger running the real chaincode, in-memory evidence store. It seeds on start, and everything resets when it stops.

```bash
set -a; . ./.env; set +a; ai/.venv/Scripts/python -m uvicorn ai.main:app --port 8001   # terminal 1
pnpm --filter @aegis/api dev:offline                                                   # terminal 2
pnpm --filter @aegis/web dev                                                           # terminal 3 → http://localhost:5173
pnpm --filter @aegis/api demo:smoke                                                    # prints DEMO OK
```

Logins are in `seed/credentials.local.json` (git-ignored). Add each user's `totpSecret` to an authenticator app.

## Option B — full stack (Fabric + Postgres + MinIO)

Needs WSL2 Ubuntu + Docker Desktop. See [network/README.md](network/README.md).

```bash
~/aegis/network/up.sh && ~/aegis/network/deploy.sh 1     # in WSL
docker compose up -d                                       # postgres (pgvector) + minio
# .env: LEDGER_MODE=fabric, FABRIC_ORGS_DIR=<test-network>/organizations
pnpm --filter @aegis/api seed          # enrols every user with Fabric CA and replays lifecycle events on-chain
pnpm --filter @aegis/api dev
pnpm --filter @aegis/web dev
pnpm --filter @aegis/api demo:smoke
```

## Tamper demo

1. Run the demo, then open **Audit console** as `audit1`. *Run reconcile* and *Verify all* should both be green.
2. Edit the database: `update cases set status='CLOSED' where case_id='CASE-2026-000001';`. Reconcile then shows a `status` mismatch against the ledger.
3. Flip one byte of an evidence object in MinIO (`mc cp`, edit, re-upload). *Verify all* then reports `cipherHashOk` failed.

## Tests

```bash
npm test --prefix chaincode/aegis-cc      # 59 chaincode rule/contract tests
pnpm --filter @aegis/api test             # 98 API tests (embedded Postgres, in-memory ledger)
pnpm --filter @aegis/web test
ai/.venv/Scripts/python -m pytest ai/tests
```

## Known limitations (MVP)

- Custodial wallets: the API holds users' Fabric keys, encrypted with `WALLET_KEK`. A production system would use HSMs or smart cards.
- The synthetic, templated corpus makes the classifier score unrealistically high (macro-F1 1.0). Evaluate on a hand-written challenge set before quoting accuracy.
- No TOTP replay protection, and no RFC 3161 timestamps. OCR/STT, the knowledge graph, the digital twin and anomaly detection are deferred (see the plan).
