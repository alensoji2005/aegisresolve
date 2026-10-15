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
| `store1`, `store2` | Store officer (DEP-01 / DEP-02) | Depot-scoped cases, **Depot twin** for their own depot |
| `inv1`, `inv2` | Investigator (external) | Accepting, linking events, signed findings, **Knowledge graph**, **Anomalies**; full access to a case they are not assigned to only through a disclosure grant |
| `inv3` | Investigator **based at DEP-02** | Triggering the conflict-of-interest block |
| `safety1` | Safety officer | Triage queue, assignment, first sign-off, **Depot twin**, **Anomalies** (run scan), receiving an identity grant |
| `board1`–`board3` | Review board | Multi-signature closure, appeal decisions, **Disclosure** tab (grant / approve / revoke) |
| `audit1` | Auditor | Ledger history, reconcile, evidence integrity, access log (incl. identity reveals), **Anomalies**, **Knowledge graph**, **Depot twin** |

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
   docker compose exec -T postgres psql -U aegis -c "update cases set status = ledger_json->>'status';"
   ```

### Step 8 — Depot twin, anomalies and the knowledge graph (`audit1`, 3 min)

1. Open **Depot twin**. Every bay shows its live temperature and humidity (synthetic sensors, refreshed every 30 s). In DEP-02 / MAG-01 the bays have a dashed border: a 48-hour humidity excursion. Click BAY-04 to see the humidity line crossing the red limit.
2. Open **Anomalies** and click **Run scan now**. Point out the three planted anomalies and their explanations:
   - `inv2`: evidence downloads 14 vs a usual 0.3, at night. *"Someone browsing evidence at 2am."*
   - `PER-107`: issued six lots overnight with no returns.
   - The four DEP-02/MAG-01 bays: the humidity excursion.

   "Every flag says why. If the model can't explain a flag, it doesn't raise it."
3. Click `PER-107`. The **Knowledge graph** opens on that person's custody events and lots. Click the lot from step 1 to see its cases, its location and everyone who handled it.

### Step 9 — Controlled disclosure (`board1`, `board2`, `safety1`, 2 min)

1. As `board1`, open the case → **Disclosure** tab → grant `safety1` **Complainant identity** for 2 hours, with a reason. Its status is *awaiting 2nd approval*.
2. As `board2`, click **Approve**. One person alone can never reveal an identity.
3. As `safety1`, open the case; **Reveal identity** now appears. Click it.
4. As `audit1`, look the case up in the **Audit console**. The access log shows *safety1 · identity* on the ledger.

### Closing (1 min)

Recap the four properties and what proves each:
- **Tamper evidence:** the reconcile and verify results, and `eval/results/tamper.md` (blockchain 4/4 attacks detected vs centralised database 0/4).
- **Accountability:** signed transactions, multi-signature closure, the R4 block, and two-person identity disclosure.
- **Privacy:** pseudonyms, encryption, role-based views (147 automated access checks), and time-limited grants.
- **Intelligence:** explainable triage (0.78 macro-F1 on hand-written complaints), duplicate detection, anomaly detection (all planted anomalies found).

Then state the limitations honestly:
- Synthetic data only.
- The API holds users' Fabric keys (custodial wallets).
- The classifier's 1.0 on synthetic data is meaningless; quote the challenge-set number.
- Not built yet: OCR/speech-to-text, governance contract for policy changes, PDF reports.

---

## Part 3b — Evaluation results for the report

Run these in the codespace with the stack up. They write Markdown tables to `eval/results/`; details are in `eval/README.md`.
```bash
pnpm --filter @aegis/api eval:tamper -- --fabric     # blockchain vs centralised DB under insider tampering
pnpm --filter @aegis/api eval:bench -- --fabric      # Fabric throughput and latency
pnpm --filter @aegis/api eval:anomaly                # planted anomalies found? (needs the AI service)
ai/.venv/bin/python -m ai.evaluate                   # classifier + duplicate detection
pnpm --filter @aegis/api test rbac-matrix            # every role x every endpoint
```

---

## Part 4 — Maintenance and troubleshooting

### 4.0 After pulling new code

If `chaincode/aegis-cc` changed, deploy it with the next sequence number, then restart the app:
```bash
git pull
pnpm install
bash network/deploy.sh N
bash scripts/start-app.sh
```
- **N** is one more than your last deploy. A clean reset (4.1) restarts the count at 1, so the first deploy after a reset is 2.
- If you don't know N, try any number. Fabric replies *"requested sequence X is larger than the next available sequence number Y"*; rerun with Y.
- `deploy.sh` restarts stopped Fabric containers first. Database migrations run automatically when the API starts.

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
| `deploy.sh`: *connection refused localhost:7051* | Fabric containers are stopped after a codespace restart: `docker start $(docker ps -aq --filter status=exited)`, wait 10 s, retry (newer `deploy.sh` does this itself) |
| `deploy.sh`: *requested sequence X is larger than the next available sequence number Y* | Rerun with `bash network/deploy.sh Y` |
| Anomalies page empty | Scans run hourly; click **Run scan now** (needs the AI service running) |
| Knowledge graph blank | Enter a start node such as `case:CASE-2026-000001` or `lot:LOT-B03-2025-0117`, or click an insight |
| **Reveal identity** missing | The grant needs a second board member to approve it and must not be expired or revoked |
| Reconcile flags a case from an earlier broken run | Ledger history can't be edited. Do a clean reset (4.1) |

### 4.3 Backup option: offline mode (no Fabric, no Docker)

If Codespaces is unavailable during the presentation, run this on any machine with Node and the Python env:
```bash
set -a; . ./.env; set +a; ai/.venv/bin/python -m uvicorn ai.main:app --port 8001 &
pnpm --filter @aegis/api dev:offline &
pnpm --filter @aegis/web dev
```
It uses an embedded Postgres and an in-memory ledger that runs the same chaincode rules. Everything resets when it stops. Say clearly that the ledger is simulated in this mode.
