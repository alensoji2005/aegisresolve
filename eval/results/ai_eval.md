# AI evaluation

Generated 2026-10-15T15:45:07 by `python -m ai.evaluate`. Model: `clf-1+BAAI/bge-small-en-v1.5`.

| Dataset | n | Macro-F1 | Accuracy |
|---|---|---|---|
| Synthetic test split (templated, group-aware) | 285 | 1.0 | 1.0 |
| **Hand-written challenge set** (embeddings + LR) | 50 | **0.7778** | 0.78 |
| Hand-written challenge set (TF-IDF + LR baseline) | 50 | 0.5357 | 0.56 |

The synthetic test split is generated from the same templates as training, so it overstates accuracy; quote the challenge-set figure.

## Challenge-set confusion matrix (rows = true, columns = predicted)

| | CONDUC | DOCUME | FACILI | INSPEC | INVENT | PACKAG | SAFETY | STORAG | TRANSP | UNAUTH |
|---|---|---|---|---|---|---|---|---|---|---|
| CONDUC | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| DOCUME | 1 | 2 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| FACILI | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| INSPEC | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 |
| INVENT | 1 | 0 | 0 | 0 | 3 | 1 | 0 | 0 | 0 | 0 |
| PACKAG | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 2 | 0 |
| SAFETY | 1 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 1 | 0 |
| STORAG | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 |
| TRANSP | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| UNAUTH | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |

## Duplicate detection (test split, pairwise)

Rule: score = cosine + 0.05 same lot + 0.05 same location + 0.03 same category; duplicate when score ≥ 0.9, same lot and ≤ 30 days apart.

| True duplicate pairs | TP | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| 44 | 25 | 0 | 19 | 1.0 | 0.5682 | 0.7246 |
