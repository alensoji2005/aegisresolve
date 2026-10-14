"""Train the complaint category classifier (embeddings + logistic regression) and a TF-IDF baseline."""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import StratifiedGroupKFold

AI_DIR = Path(__file__).resolve().parent
MODEL_NAME = "BAAI/bge-small-en-v1.5"
VERSION = "clf-1"


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def split(rows: list[dict], seed: int = 42) -> tuple[list[int], list[int], list[int]]:
    """Group-aware stratified ~70/15/15 split: a duplicate group never spans two splits."""
    y = [r["category"] for r in rows]
    groups = [r["dup_group"] or r["id"] for r in rows]
    outer = StratifiedGroupKFold(n_splits=7, shuffle=True, random_state=seed)
    rest, test = next(outer.split(np.zeros(len(rows)), y, groups))
    inner = StratifiedGroupKFold(n_splits=6, shuffle=True, random_state=seed)
    tr, va = next(inner.split(np.zeros(len(rest)), [y[i] for i in rest], [groups[i] for i in rest]))
    return [int(rest[i]) for i in tr], [int(rest[i]) for i in va], [int(i) for i in test]


def embedder():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_NAME, device="cpu")


def train(corpus_path: Path = AI_DIR / "data" / "corpus.jsonl", out_dir: Path = AI_DIR / "models") -> dict:
    rows = load(Path(corpus_path))
    texts = [r["text"] for r in rows]
    y = np.array([r["category"] for r in rows])
    tr, va, te = split(rows)

    model = embedder()
    X = model.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
    embed_lr = LogisticRegression(C=4, class_weight="balanced", max_iter=2000).fit(X[tr], y[tr])

    tfidf = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True)
    T = tfidf.fit_transform(texts)
    tfidf_lr = LogisticRegression(C=4, class_weight="balanced", max_iter=2000).fit(T[tr], y[tr])

    def scores(pred, idx):
        return {"macro_f1": float(f1_score(y[idx], pred, average="macro")),
                "per_class": classification_report(y[idx], pred, output_dict=True, zero_division=0)}

    metrics = {
        "embed_lr": {"val": scores(embed_lr.predict(X[va]), va)["macro_f1"], **scores(embed_lr.predict(X[te]), te)},
        "tfidf_lr": {"val": scores(tfidf_lr.predict(T[va]), va)["macro_f1"], **scores(tfidf_lr.predict(T[te]), te)},
        "sizes": {"train": len(tr), "val": len(va), "test": len(te)},
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump({"embed_lr": embed_lr, "tfidf": tfidf, "tfidf_lr": tfidf_lr, "model_name": MODEL_NAME, "version": VERSION}, out / "classifier.joblib")
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (out / "split.json").write_text(json.dumps({"train": tr, "val": va, "test": te}), encoding="utf-8")
    return metrics


if __name__ == "__main__":
    m = train()
    print(json.dumps({k: v["macro_f1"] for k, v in m.items() if isinstance(v, dict) and "macro_f1" in v}, indent=2))
