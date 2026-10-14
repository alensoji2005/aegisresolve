"""Entity extraction: exact regexes for synthetic domain IDs plus a severity gazetteer and simple date/quantity patterns."""
from __future__ import annotations

import re

HIGH_SEVERITY = ["unauthorised", "unauthorized", "forced entry", "seal broken", "missing", "leak", "smoke", "rust", "damp",
                 "door left open", "count mismatch", "unlocked"]

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("LOT", re.compile(r"\bLOT-[A-Z]\d{2}-\d{4}-\d{4}\b")),
    ("LOCATION", re.compile(r"\bDEP-\d{2}(?:/MAG-\d{2})?(?:/BAY-\d{2})?\b")),
    ("EVENT", re.compile(r"\bEVT-\d{6}\b")),
    ("CASE", re.compile(r"\bCASE-\d{4}-\d{6}\b")),
    ("DATE", re.compile(r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b")),
    ("QUANTITY", re.compile(r"\b\d+(?:\.\d+)? ?(?:%|units|items|crates|boxes|degrees|days|hours)\b")),
]
_GAZ = re.compile(r"\b(" + "|".join(re.escape(t) for t in sorted(HIGH_SEVERITY, key=len, reverse=True)) + r")\b", re.IGNORECASE)


def extract_entities(text: str) -> list[dict]:
    out: list[dict] = []
    for typ, rx in PATTERNS:
        for m in rx.finditer(text):
            out.append({"type": typ, "value": m.group(0), "span": [m.start(), m.end()], "source": "regex"})
    for m in _GAZ.finditer(text):
        out.append({"type": "CONDITION", "value": m.group(0).lower(), "span": [m.start(), m.end()], "source": "gazetteer"})
    return sorted(out, key=lambda e: e["span"][0])


def severity_hits(entities: list[dict]) -> int:
    return len({e["value"] for e in entities if e["type"] == "CONDITION"})
