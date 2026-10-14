import os
from pathlib import Path

import pytest

AI_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def trained():
    """Generates the corpus and trains models once per session if they are missing."""
    from ai.corpus.generate import generate
    from ai.train_classifier import train
    import json

    corpus = AI_DIR / "data" / "corpus.jsonl"
    if not corpus.exists():
        corpus.parent.mkdir(parents=True, exist_ok=True)
        corpus.write_text("\n".join(json.dumps(r) for r in generate()) + "\n", encoding="utf-8")
    metrics_path = AI_DIR / "models" / "metrics.json"
    if not metrics_path.exists() or os.environ.get("RETRAIN") == "1":
        train(corpus)
    return json.loads(metrics_path.read_text(encoding="utf-8"))
