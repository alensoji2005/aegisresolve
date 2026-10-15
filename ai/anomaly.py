"""Explainable anomaly detection: Isolation Forest flags unusual (subject, day) rows; each flag is explained by the
features that deviate most from that subject's own baseline (or the population when the subject has little history)."""
from __future__ import annotations

from collections import defaultdict

import numpy as np
from sklearn.ensemble import IsolationForest

MIN_ROWS = 10
MIN_OWN_HISTORY = 5
Z_EXPLAIN = 2.0


def score_rows(rows: list[dict], contamination: float = 0.02) -> list[dict]:
    """rows: [{subject, day, features: {name: number}}] -> same order, with score, anomalous and explanation."""
    if len(rows) < MIN_ROWS:
        return [{"subject": r["subject"], "day": r["day"], "score": 0.0, "anomalous": False, "explanation": []} for r in rows]
    names = sorted({k for r in rows for k in r["features"]})
    X = np.array([[float(r["features"].get(k, 0.0)) for k in names] for r in rows])
    forest = IsolationForest(n_estimators=200, contamination=contamination, random_state=42).fit(X)
    flags = forest.predict(X) == -1
    scores = -forest.score_samples(X)  # higher = more anomalous

    by_subject: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        by_subject[r["subject"]].append(i)
    pop_mean, pop_std = X.mean(axis=0), X.std(axis=0)

    out = []
    for i, r in enumerate(rows):
        others = [j for j in by_subject[r["subject"]] if j != i]
        if len(others) >= MIN_OWN_HISTORY:
            mean, std, basis = X[others].mean(axis=0), X[others].std(axis=0), "own history"
        else:
            mean, std, basis = pop_mean, pop_std, "all subjects"
        z = (X[i] - mean) / np.where(std > 1e-9, std, 1.0)
        reasons = [{"feature": names[k], "value": round(float(X[i, k]), 3), "baseline": round(float(mean[k]), 3), "z": round(float(z[k]), 2), "basis": basis}
                   for k in np.argsort(-np.abs(z)) if abs(z[k]) >= Z_EXPLAIN][:3]
        # Report a flag only when it can be explained: an unexplainable outlier is not actionable for an investigator.
        anomalous = bool(flags[i] and reasons)
        out.append({"subject": r["subject"], "day": r["day"], "score": round(float(scores[i]), 4), "anomalous": anomalous,
                    "explanation": reasons if anomalous else []})
    return out
