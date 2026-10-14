# AegisResolve: Setup and Presentation Guide

How to get AegisResolve running on a real Hyperledger Fabric network in GitHub Codespaces, and how to present it. Run every command in the **codespace terminal** (bash, prompt `@you ➜ /workspaces/aegisresolve`), not in Windows PowerShell.

---

## Part 1 — One-time setup

### 1.1 Put the code on GitHub (on your PC)

1. On github.com, create a **private** repository named `aegisresolve`, with no README.
2. In the project folder on your PC:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/aegisresolve.git
   git push -u origin master
   ```
   Secrets are git-ignored and never uploaded: `.env`, `seed/credentials.local.json`, the trained models and evidence files.

If the remote already exists, a plain `git push` is enough.

### 1.2 Create the codespace

1. On the repo page: **Code** → **Codespaces** → **⋯** → **New with options**.
2. Choose branch `master`, configuration **AegisResolve**, and machine **4-core / 16 GB**. Click **Create codespace**.
3. Setup runs on its own and takes about 10–15 minutes. It installs Node, Python and Fabric, trains the AI model, and writes `.env` with fresh secrets.
4. Wait for **`Setup done`** in the terminal.

If setup failed or you closed the window during it, run `bash scripts/setup-codespace.sh` again.

### 1.3 Start the blockchain and load demo data

```bash
bash scripts/start-fabric.sh
```

This takes a few minutes. It does the following:
- Starts Fabric: 2 organisations (DepotOrg, OversightOrg), certificate authorities, an orderer and the channel `aegischannel`.
- Deploys the `aegis-cc` chaincode.
- Starts Postgres.
- Seeds 14 users, each with its own Fabric certificate, plus 2 depots, 80 lots, about 800 lifecycle events (all written on-chain) and 14 days of sensor data.

It ends with **`Fabric is up and seeded`**.

---

## Part 2 — Every session

### 2.1 Start the app

```bash
bash scripts/start-app.sh
```

Leave this terminal open. The script restarts any stopped containers, then starts the AI service (port 8001), the API (3000) and the web UI (5173). It's ready when you see:
- `Server listening at http://127.0.0.1:3000`
- `Uvicorn running on http://127.0.0.1:8001`

Open the UI from the **Ports** tab: click the globe icon next to **5173 (Web UI)**.

### 2.2 Check everything works (second terminal, `+`)

```bash
pnpm --filter @aegis/api demo:smoke
```

It must end with **`DEMO OK`**. It runs the whole workflow through the API in about a minute. Run it before every presentation.

### 2.3 Log in

Passwords are random per seed. Get a username's password and current login code:

```bash
bash scripts/login.sh safety1
```

Enter the code within about 30 seconds; run the command again for a new one. To use an authenticator app instead, add the user's `totpSecret` from `seed/credentials.local.json` with **enter a setup key**.

| User | Role | Use it to show |
|---|---|---|
| `comp1`, `comp2` | Complainant | Filing a complaint, private case view, appeal |
| `store1`, `store2` | Store officer (DEP-01 / DEP-02) | Depot-scoped view |
| `inv1`, `inv2` | Investigator (external) | Accepting, linking events, signed findings |
| `inv3` | Investigator **based at DEP-02** | Triggering the conflict-of-interest block |
| `safety1` | Safety officer | Triage queue, assignment, first sign-off |
| `board1`–`board3` | Review board | Multi-signature closure, appeal decisions |
| `audit1` | Auditor | Ledger history, reconcile, evidence integrity |

Tip: open each user in a separate browser profile or incognito window so you don't have to keep logging out.

### 2.4 When you finish

Stop the codespace (github.com/codespaces → **⋯** → **Stop**) to save free hours. Next time, open it and run `bash scripts/start-app.sh` again; the data survives a stop.

---

## Part 3 — Presentation script (about 12 minutes)

**Before you start:** do a clean reset (Part 4.1), run `demo:smoke` once, and have these ready:
- the UI tab;
- a terminal;
- a small test image to upload, any JPG or PNG.

### Opening (1 min) — the problem

"Ammunition lifecycle complaints are handled on paper, by email, and in isolated databases. Records can be altered, repeated complaints go unnoticed, and investigations can be steered. AegisResolve treats each complaint as a verifiable investigation: evidence is anchored on a permissioned blockchain, every action is signed by the person who took it, AI triages each case, and complainants stay anonymous."

Show the architecture: React UI → Fastify API → Hyperledger Fabric (2 orgs) + Postgres + AI service. Explain that only hashes, IDs and statuses go on-chain; the text and files are encrypted off-chain.

### Step 1 — File a complaint (`comp2`, 2 min)

1. **Submit complaint**, then fill in:
   - Title: `Damp packaging in magazine 1`
   - Description: `Humidity indicator in DEP-02/MAG-01/BAY-04 showed 85% for two days; packaging on LOT-B03-2025-0117 looks damp and one seal is broken.`
   - When: two days ago
   - Location: `DEP-02/MAG-01/BAY-04`
   - Lot: `LOT-B03-2025-0117`
2. Upload the image and submit.
3. On the receipt, point out:
   - the **case ID**;
   - the **pseudonym**: investigators never see who filed it, and it differs for every case;
   - the **ledger transaction ID**;
   - the evidence **SHA-256**: the file is encrypted with AES-256-GCM and only its hash goes on the blockchain.

### Step 2 — AI triage (`safety1`, 2 min)

1. Open the **Triage queue** and the new case. Within a few seconds it moves to **TRIAGED**.
2. Show:
   - **Category** with its probabilities;
   - **Risk score** with one bar per factor. The sensor-excursion bar comes from real (synthetic) humidity readings for that bay, and the reconciliation-discrepancy bar from on-chain lifecycle data;
   - **Keywords** and extracted **entities** (lot, location, conditions);
   - the **Related** tab, which lists earlier similar complaints with the reasons.

   "This is explainable: every number that drove the risk level is visible, and the hash of the AI result is anchored on-chain."

### Step 3 — Conflict-of-interest block (`safety1`, 1 min)

1. In **Assign investigator**, pick **inv3** and click **Assign**. You get the error *"Blocked by conflict-of-interest rule R4: investigator is based at the case depot"*.

   "This rule lives in the smart contract, not the UI. Even a compromised server can't assign them. When the investigator accepts, the contract re-checks the rules against their own certificate."
2. Assign **inv1** instead.

### Step 4 — Investigation (`inv1`, 2 min)

1. Open **My assignments**, then the case, then **Accept assignment**.
2. On the **Lifecycle** tab, tick a suggested event and click **Link selected**.

   "The system suggests custody events on this lot within 30 days, ranked by relevance."
3. On **Findings & review**, write findings, choose an outcome, and click **Sign and submit findings**.

   "The findings hash is signed with inv1's own Fabric key."

### Step 5 — Multi-signature closure (2 min)

1. As `safety1`: **Review queue** → case → **Findings & review**. The panel shows *"0 of 2 signatures"* (*"0 of 3"* for HIGH risk). Click **Approve**.
2. Optionally, as `inv1`, try to approve. It's rejected: an investigator can't sign off their own work.
3. As `board1`: **Approve**. The case is **CLOSED** (for HIGH risk, `board2` must approve too).
4. Open the **Ledger** tab: every step, its transaction ID and the role that signed it.

### Step 6 — Privacy and appeal (`comp2`, 1 min)

1. As `comp2`, open **My cases**. The complainant sees the status, timeline and outcome, but not the investigator, the internal notes, or anyone's identity.
2. File an appeal.
3. As `board3`, decide it. `board1` can't, because they approved the original closure.

### Step 7 — Tamper detection (`audit1` + terminal, 2 min)

1. As `audit1`, open the **Audit console**. Click **Run reconcile** and **Verify all**; both are green.
2. In the terminal, act as an insider editing the database directly:
   ```bash
   docker compose exec -T postgres psql -U aegis -c "update cases set status='CLOSED_FINAL' where case_id='CASE-2026-000001';"
   ```
   Run reconcile again. A red row shows **status: ledger SUBMITTED / database CLOSED_FINAL** (use whatever case ID you filed in step 1).
3. Tamper with an evidence file on disk:
   ```bash
   f=$(ls data/blobs/evidence/*/* | head -1); printf 'x' | dd of="$f" bs=1 seek=0 conv=notrunc 2>/dev/null; echo "tampered $f"
   ```
   Click **Verify all**. The file fails `cipherHashOk`.

   "A conventional database can't tell you this happened. Here the blockchain is the reference copy, so any edit is caught."
4. Undo the status edit (or do a clean reset afterwards):
   ```bash
   docker compose exec -T postgres psql -U aegis -c "update cases c set status = ledger_json->>'status' from cases x where c.case_id = x.case_id;"
   ```

### Closing (1 min)

Recap the four properties and what proves each:
- **Tamper evidence:** the reconcile and verify results.
- **Accountability:** signed transactions, multi-signature closure, and the R4 block.
- **Privacy:** pseudonyms, encryption, and role-based views.
- **Intelligence:** explainable triage and duplicate detection.

Then state the limitations honestly:
- Synthetic data only.
- The API holds users' Fabric keys (custodial wallets).
- The classifier score is inflated by the templated training data.
- OCR, the knowledge graph and anomaly detection are planned next.

---

## Part 4 — Maintenance and troubleshooting

### 4.1 Clean reset (fresh blockchain + database)

Stop `start-app.sh` with Ctrl-C, then:
```bash
bash network/down.sh; docker compose down -v; rm -rf data/blobs; bash scripts/start-fabric.sh
bash scripts/start-app.sh
```
A reset creates new passwords, so use `scripts/login.sh` again.

### 4.2 Common problems

| Symptom | Fix |
|---|---|
| `ECONNREFUSED ...:5432` | Postgres is stopped: `docker compose up -d` (or just run `start-app.sh`) |
| `ECONNREFUSED ...:3000` in `demo:smoke` | The API isn't running or crashed. Check the `start-app.sh` terminal |
| `seed/credentials.local.json` not found | Seed hasn't run: `pnpm --filter @aegis/api seed` |
| Seed says `already seeded` but the credentials file is missing | Do a clean reset (4.1) |
| `peer` or `fabric-samples` not found | Rerun `bash scripts/setup-codespace.sh` |
| Login code rejected | Codes last 30 s; run `scripts/login.sh` again. Make sure you're using the codespace's credentials, not a copy on your PC |
| Case stuck at SUBMITTED | The AI service isn't running (check the uvicorn lines). The API retries triage every minute, up to 3 times |
| Chaincode changed | `bash network/deploy.sh N` with N one higher than the last deploy, then restart `start-app.sh` |
| Reconcile flags a case from an earlier broken run | Ledger history can't be edited. Do a clean reset (4.1) |

### 4.3 Backup option: offline mode (no Fabric, no Docker)

If Codespaces is unavailable during the presentation, run this on any machine with Node and the Python env:
```bash
set -a; . ./.env; set +a; ai/.venv/bin/python -m uvicorn ai.main:app --port 8001 &
pnpm --filter @aegis/api dev:offline &
pnpm --filter @aegis/web dev
```
It uses an embedded Postgres and an in-memory ledger that runs the same chaincode rules. Everything resets when it stops. Say clearly that the ledger is simulated in this mode.
