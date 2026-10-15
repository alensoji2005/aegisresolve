"""Objective 12 (AI accuracy): classifier on the held-out test split and a hand-written challenge set, plus
duplicate-detection precision/recall using the same scoring rule as the API (api/src/triage/similarity.ts).

Usage: python -m ai.evaluate   -> eval/results/ai_eval.md and ai_eval.json
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix, f1_score

from ai.train_classifier import AI_DIR, load

RESULTS = AI_DIR.parent / "eval" / "results"
DUP, REL, DUP_MAX_DAYS = 0.90, 0.75, 30


def classifier_scores(model, X, y, classes):
    pred = model.predict(X)
    return pred, {
        "macro_f1": round(float(f1_score(y, pred, average="macro")), 4),
        "accuracy": round(float(np.mean(pred == y)), 4),
        "per_class": {c: round(v["f1-score"], 3) for c, v in classification_report(y, pred, output_dict=True, zero_division=0).items() if c in classes},
        "confusion": confusion_matrix(y, pred, labels=classes).tolist(),
    }


def duplicate_scores(rows, emb, pred_cat):
    """Pairwise over the test split: predicted DUPLICATE vs ground-truth shared dup_group."""
    sims = emb @ emb.T
    when = [datetime.fromisoformat(r["filed_at"].rstrip("Z")) for r in rows]
    tp = fp = fn = 0
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            same_asset = rows[i]["asset"] == rows[j]["asset"]
            score = min(1.0, sims[i, j] + 0.05 * same_asset + 0.05 * (rows[i]["location"] == rows[j]["location"]) + 0.03 * (pred_cat[i] == pred_cat[j]))
            predicted = score >= DUP and same_asset and abs((when[i] - when[j]).days) <= DUP_MAX_DAYS
            truth = rows[i]["dup_group"] is not None and rows[i]["dup_group"] == rows[j]["dup_group"]
            tp += predicted and truth
            fp += predicted and not truth
            fn += truth and not predicted
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    tp, fp, fn = int(tp), int(fp), int(fn)
    return {"pairs_true": tp + fn, "tp": tp, "fp": fp, "fn": fn, "precision": round(p, 4), "recall": round(r, 4),
            "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0}


def main() -> None:
    bundle = joblib.load(AI_DIR / "models" / "classifier.joblib")
    from sentence_transformers import SentenceTransformer
    enc = SentenceTransformer(bundle["model_name"], device="cpu")
    model = bundle["embed_lr"]
    classes = list(model.classes_)

    rows = load(AI_DIR / "data" / "corpus.jsonl")
    test = [rows[i] for i in json.loads((AI_DIR / "models" / "split.json").read_text())["test"]]
    Xt = enc.encode([r["text"] for r in test], normalize_embeddings=True, show_progress_bar=False)
    yt = np.array([r["category"] for r in test])
    pred_t, test_scores = classifier_scores(model, Xt, yt, classes)

    challenge = load(AI_DIR / "eval" / "challenge.jsonl")
    Xc = enc.encode([r["text"] for r in challenge], normalize_embeddings=True, show_progress_bar=False)
    yc = np.array([r["category"] for r in challenge])
    _, challenge_scores = classifier_scores(model, Xc, yc, classes)
    Tc = bundle["tfidf"].transform([r["text"] for r in challenge])
    _, challenge_tfidf = classifier_scores(bundle["tfidf_lr"], Tc, yc, classes)

    dup = duplicate_scores(test, Xt, pred_t)
    out = {"model": bundle["version"] + "+" + bundle["model_name"], "test_split": {"n": len(test), **test_scores},
           "challenge_set": {"n": len(challenge), "embed_lr": challenge_scores, "tfidf_lr_baseline": challenge_tfidf}, "duplicates": dup}

    short = [c.split("_")[0][:6] for c in classes]
    cm = challenge_scores["confusion"]
    md = [
        "# AI evaluation", "",
        f"Generated {datetime.now().isoformat(timespec='seconds')} by `python -m ai.evaluate`. Model: `{out['model']}`.", "",
        "| Dataset | n | Macro-F1 | Accuracy |", "|---|---|---|---|",
        f"| Synthetic test split (templated, group-aware) | {len(test)} | {test_scores['macro_f1']} | {test_scores['accuracy']} |",
        f"| **Hand-written challenge set** (embeddings + LR) | {len(challenge)} | **{challenge_scores['macro_f1']}** | {challenge_scores['accuracy']} |",
        f"| Hand-written challenge set (TF-IDF + LR baseline) | {len(challenge)} | {challenge_tfidf['macro_f1']} | {challenge_tfidf['accuracy']} |", "",
        "The synthetic test split is generated from the same templates as training, so it overstates accuracy; quote the challenge-set figure.", "",
        "## Challenge-set confusion matrix (rows = true, columns = predicted)", "",
        "| | " + " | ".join(short) + " |", "|---|" + "---|" * len(short),
        *[f"| {short[i]} | " + " | ".join(str(v) for v in row) + " |" for i, row in enumerate(cm)], "",
        "## Duplicate detection (test split, pairwise)", "",
        f"Rule: score = cosine + 0.05 same lot + 0.05 same location + 0.03 same category; duplicate when score >= {DUP}, same lot and <= {DUP_MAX_DAYS} days apart.", "",
        "| True duplicate pairs | TP | FP | FN | Precision | Recall | F1 |", "|---|---|---|---|---|---|---|",
        f"| {dup['pairs_true']} | {dup['tp']} | {dup['fp']} | {dup['fn']} | {dup['precision']} | {dup['recall']} | {dup['f1']} |",
    ]
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "ai_eval.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    (RESULTS / "ai_eval.json").write_text(json.dumps(out, indent=2, default=lambda o: o.item()), encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
