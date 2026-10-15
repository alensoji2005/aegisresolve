# Anomaly detection

Generated 2026-10-15T10:28:40.666Z by `pnpm --filter @aegis/api eval:anomaly` (Isolation Forest, contamination 0.02, explanations = features with |z| ≥ 2).

| Planted anomaly | Family | Found |
|---|---|---|
| night burst: 9 full case views and 14 evidence downloads between 01:00 and 03:00 (inv2) | access | ✅ |
| six lots issued between 01:00 and 03:00 with no returns (PER-107) | lifecycle | ✅ |
| 48 h humidity excursion (RH 85%) in every bay of the magazine, starting 6 days before seeding | sensor | ✅ |

Flagged in total: 7 (lifecycle 2, access 1, sensor 4). Planted among them: 6. Precision@5: 1.00, precision@10: 0.86.

Flags that are not planted are not necessarily wrong: the synthetic data has natural variation (e.g. busy reconciliation days).

## Top 10 flags

| # | Family | Subject | Day | Score | Planted | Why |
|---|---|---|---|---|---|---|
| 1 | access | inv2 | 2026-10-14 | 0.913 | yes | evidence_downloads 14 vs 0.276 (z 30.71); full_views 9 vs 2.759 (z 4.44); distinct_cases 9 vs 3.034 (z 4.18) |
| 2 | lifecycle | PER-107 | 2026-10-12 | 0.764 | yes | issue_return_imbalance 215 vs 9.4 (z 28.02) |
| 3 | sensor | DEP-02/MAG-01/BAY-01 | 2026-10-10 | 0.761 | yes | out_of_bounds_hours 24 vs 1.714 (z 5.22); max_rh 85 vs 65.129 (z 2.42) |
| 4 | sensor | DEP-02/MAG-01/BAY-04 | 2026-10-10 | 0.761 | yes | out_of_bounds_hours 24 vs 1.714 (z 5.22); max_rh 85 vs 65.086 (z 2.42) |
| 5 | sensor | DEP-02/MAG-01/BAY-02 | 2026-10-10 | 0.761 | yes | out_of_bounds_hours 24 vs 1.714 (z 5.22); max_rh 85 vs 65.007 (z 2.41) |
| 6 | sensor | DEP-02/MAG-01/BAY-03 | 2026-10-10 | 0.761 | yes | out_of_bounds_hours 24 vs 1.714 (z 5.22); max_rh 85 vs 64.743 (z 2.43) |
| 7 | lifecycle | PER-111 | 2026-10-11 | 0.675 |  | distinct_lots 13 vs 1.5 (z 16.26); events 13 vs 1.5 (z 16.26) |
