"""Internal AI service. Only the API server calls it; every request must carry X-AI-Secret."""
from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from ai.analyze import _models, analyze
from ai.anomaly import score_rows

app = FastAPI(title="AegisResolve AI", docs_url=None, redoc_url=None)


def require_secret(x_ai_secret: str = Header(default="")) -> None:
    expected = os.environ.get("AI_SHARED_SECRET", "")
    if not expected or not hmac.compare_digest(x_ai_secret, expected):
        raise HTTPException(status_code=401, detail="unauthorised")


class AnalyzeIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


@app.on_event("startup")
def warm() -> None:
    if os.environ.get("AI_SKIP_WARMUP") != "1":
        _models()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/analyze", dependencies=[Depends(require_secret)])
def analyze_route(body: AnalyzeIn) -> dict:
    return analyze(body.text)


class AnomalyRow(BaseModel):
    subject: str = Field(min_length=1, max_length=100)
    day: str = Field(min_length=10, max_length=10)
    features: dict[str, float]


class AnomalyIn(BaseModel):
    family: str = Field(pattern=r'^(lifecycle|access|sensor)$')
    rows: list[AnomalyRow] = Field(max_length=50000)


@app.post('/anomaly/score', dependencies=[Depends(require_secret)])
def anomaly_route(body: AnomalyIn) -> dict:
    return {'family': body.family, 'results': score_rows([r.model_dump() for r in body.rows])}
