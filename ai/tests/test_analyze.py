import json

import numpy as np
from fastapi.testclient import TestClient


def client(monkeypatch):
    monkeypatch.setenv("AI_SHARED_SECRET", "s3cret")
    from ai.main import app
    return TestClient(app)


def test_requires_secret(trained, monkeypatch):
    c = client(monkeypatch)
    assert c.post("/analyze", json={"text": "x"}).status_code == 401
    assert c.post("/analyze", json={"text": "x"}, headers={"x-ai-secret": "wrong"}).status_code == 401


def test_held_out_storage_sample(trained, monkeypatch):
    from ai.train_classifier import AI_DIR, load
    rows = load(AI_DIR / "data" / "corpus.jsonl")
    test_idx = json.loads((AI_DIR / "models" / "split.json").read_text())["test"]
    sample = next(rows[i] for i in test_idx if rows[i]["category"] == "STORAGE_ENVIRONMENT")
    r = client(monkeypatch).post("/analyze", json={"text": sample["text"]}, headers={"x-ai-secret": "s3cret"})
    assert r.status_code == 200
    body = r.json()
    assert body["category"] == "STORAGE_ENVIRONMENT"
    assert len(body["embedding"]) == 384
    assert abs(np.linalg.norm(body["embedding"]) - 1) < 1e-3
    assert body["topKeywords"]
