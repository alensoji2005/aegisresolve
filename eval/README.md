# Evaluation (objectives 12 and 13)

Each script writes Markdown (for the report) and JSON/CSV (for charts) into `eval/results/`.

| What | Command | Output | Needs |
|---|---|---|---|
| Tamper detection: blockchain vs centralised DB (obj. 13) | `pnpm --filter @aegis/api eval:tamper` | `tamper.md`, `tamper.json` | nothing (in-process) |
| Same, including the live Fabric network | `pnpm --filter @aegis/api eval:tamper -- --fabric` | adds a Fabric column | running stack, `LEDGER_MODE=fabric` |
| Ledger throughput and latency | `pnpm --filter @aegis/api eval:bench -- --fabric` | `benchmark.md`, `benchmark.csv` | running Fabric stack (drop `--fabric` for in-process modes only) |
| AI accuracy and duplicate detection | `ai/.venv/bin/python -m ai.evaluate` | `ai_eval.md`, `ai_eval.json` | trained model |
| Access control (every role × every endpoint) | `pnpm --filter @aegis/api test rbac-matrix` | 147 test cases, 0 unauthorised successes | nothing |
| Anomaly detection precision@k vs planted anomalies | `pnpm --filter @aegis/api eval:anomaly` | `anomaly.md` | AI service running |
| Full regression suite | `npm test --prefix chaincode/aegis-cc && pnpm -r test && ai/.venv/bin/python -m pytest ai/tests` | console | nothing |

## How to read the results

- **Tamper detection.** The insider has full access to the application database and evidence store and knows the encryption key. They cover their tracks in every store they control. With the centralised baseline (`LEDGER_MODE=postgres`) that includes the ledger tables, so nothing is detected. With a blockchain, the ledger is held by peers of other organisations and needs both organisations' endorsement, so the edit can't be hidden.
- **Benchmark.** In-process and centralised numbers are a lower bound on overhead, not a fair speed contest: Fabric does endorsement by 2 organisations, Raft ordering and commit validation. Always quote the hardware.
- **AI.** The synthetic test split shares templates with training and scores 1.0; that number is meaningless. Quote the **hand-written challenge set** (`ai/eval/challenge.jsonl`, 50 complaints in free wording) and compare it with the TF-IDF baseline.
- **Usability (SUS)** is not automated: run the 4 tasks in `docs/SETUP_AND_DEMO.md` Part 3 with 5–10 testers and score the standard 10-item SUS questionnaire.
