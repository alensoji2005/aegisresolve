# Ledger performance

Generated 2026-10-15T10:12:53.247Z by `pnpm --filter @aegis/api eval:bench`. 40 writes per concurrency level, 80 reads.
Writes are `complaint:registerCase`; on Fabric each write is endorsed by both organisations, ordered and committed before it returns.

| Ledger | Operation | Concurrency | Throughput (tx/s) | Mean (ms) | p50 (ms) | p95 (ms) | Errors |
|---|---|---|---|---|---|---|---|
| In-process ledger (no network) | write registerCase | 1 | 2576.7 | 0.4 | 0.2 | 1.3 | 0 |
| In-process ledger (no network) | write registerCase | 10 | 4444.4 | 2.2 | 1.7 | 4 | 0 |
| In-process ledger (no network) | write registerCase | 25 | 5981.8 | 3.1 | 3.5 | 4.2 | 0 |
| In-process ledger (no network) | read getCase | 10 | 6247.4 | 1.5 | 1.3 | 3.2 | 0 |
| Centralised DB (embedded Postgres) | write registerCase | 1 | 108.6 | 9.2 | 8.5 | 14.2 | 0 |
| Centralised DB (embedded Postgres) | write registerCase | 10 | 119 | 74.2 | 81.2 | 89.1 | 0 |
| Centralised DB (embedded Postgres) | write registerCase | 25 | 133.4 | 132.9 | 162.4 | 186.6 | 0 |
| Centralised DB (embedded Postgres) | read getCase | 10 | 257.3 | 36.2 | 38.1 | 43.7 | 0 |

Machine-dependent: quote these together with the hardware (e.g. GitHub Codespace, 4 cores / 16 GB).
