# Tamper detection: blockchain vs centralised database

Generated 2026-10-15T10:09:36.425Z by `pnpm --filter @aegis/api eval:tamper`.

Insider model: full write access to the application database and evidence store, knows the encryption key, and covers tracks in every store they control.
Detection uses the system's own audit endpoints (`/audit/reconcile`, `/audit/verify-evidence`).

| Attack | Independent ledger (simulated in-process) | Centralised database (ledger tables in app DB) |
|---|---|---|
| Close a case by editing its status | ✅ detected (reconcile: status) | ❌ undetected |
| Reassign the investigator | ✅ detected (reconcile: investigator) | ❌ undetected |
| Rewrite the complaint text (re-encrypted, hash updated) | ✅ detected (reconcile: content) | ❌ undetected |
| Swap an evidence file (re-encrypted, hashes updated) | ✅ detected (verify-evidence) | ❌ undetected |
| **Detected** | **4/4** | **0/4** |

Baseline before attacks was clean in every mode: yes.
