from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np

from ai.entities import extract_entities, severity_hits

MODELS_DIR = Path(__file__).resolve().parent / "models"


@lru_cache(maxsize=1)
def _models():
    bundle = joblib.load(MODELS_DIR / "classifier.joblib")
    from sentence_transformers import SentenceTransformer
    bundle["embedder"] = SentenceTransformer(bundle["model_name"], device="cpu")
    return bundle


def analyze(text: str) -> dict:
    m = _models()
    emb = m["embedder"].encode([text], normalize_embeddings=True, show_progress_bar=False)[0]
    probs = m["embed_lr"].predict_proba([emb])[0]
    classes = list(m["embed_lr"].classes_)
    best = int(np.argmax(probs))
    category = classes[best]

    # Explanation: TF-IDF terms in this text weighted by the baseline model's coefficients for the predicted class.
    x = m["tfidf"].transform([text])
    coef = m["tfidf_lr"].coef_[list(m["tfidf_lr"].classes_).index(category)]
    contrib = {int(j): float(v * coef[j]) for j, v in zip(x.indices, x.data)}
    vocab = m["tfidf"].get_feature_names_out()
    top = [vocab[j] for j, c in sorted(contrib.items(), key=lambda kv: kv[1], reverse=True) if c > 0][:5]

    entities = extract_entities(text)
    return {
        "category": category,
        "categoryProbs": {c: round(float(p), 4) for c, p in sorted(zip(classes, probs), key=lambda cp: cp[1], reverse=True)},
        "needsHumanTriage": bool(probs[best] < 0.55),
        "topKeywords": top,
        "entities": entities,
        "severityHits": severity_hits(entities),
        "embedding": [float(v) for v in emb],
        "modelVersion": f'{m["version"]}+{m["model_name"]}',
    }
