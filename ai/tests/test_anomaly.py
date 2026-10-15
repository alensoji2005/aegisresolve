import random

from fastapi.testclient import TestClient

from ai.anomaly import score_rows


def rows():
    rnd = random.Random(1)
    out = []
    for u in ["inv1", "inv2", "safety1", "board1"]:
        for d in range(1, 29):
            out.append({"subject": u, "day": f"2026-09-{d:02d}",
                        "features": {"full_views": rnd.randint(2, 6), "evidence_downloads": rnd.randint(0, 2), "off_hours_ratio": rnd.random() * 0.1}})
    out.append({"subject": "inv2", "day": "2026-09-29", "features": {"full_views": 9, "evidence_downloads": 14, "off_hours_ratio": 1.0}})
    return out


def test_planted_burst_is_flagged_and_explained():
    res = score_rows(rows())
    burst = res[-1]
    assert burst["anomalous"]
    feats = [e["feature"] for e in burst["explanation"]]
    assert "evidence_downloads" in feats and "off_hours_ratio" in feats
    assert burst["explanation"][0]["basis"] == "own history"
    assert sum(r["anomalous"] for r in res) <= 4


def test_too_few_rows_never_flags():
    assert not any(r["anomalous"] for r in score_rows(rows()[:5]))


def test_endpoint(monkeypatch):
    monkeypatch.setenv("AI_SHARED_SECRET", "s")
    monkeypatch.setenv("AI_SKIP_WARMUP", "1")
    from ai.main import app
    c = TestClient(app)
    body = {"family": "access", "rows": rows()}
    assert c.post("/anomaly/score", json=body).status_code == 401
    r = c.post("/anomaly/score", json=body, headers={"x-ai-secret": "s"})
    assert r.status_code == 200 and r.json()["results"][-1]["anomalous"]
    assert c.post("/anomaly/score", json={"family": "bogus", "rows": []}, headers={"x-ai-secret": "s"}).status_code == 422
