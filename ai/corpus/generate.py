"""Synthetic complaint corpus for AegisResolve (administrative/accountability complaints only, no real data)."""
from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

CATEGORIES = [
    "INVENTORY_DISCREPANCY", "STORAGE_ENVIRONMENT", "PACKAGING_LABELLING_DEFECT", "DOCUMENTATION_CUSTODY_GAP",
    "UNAUTHORISED_ACCESS", "SAFETY_PROCEDURE_VIOLATION", "INSPECTION_OVERDUE", "TRANSPORT_HANDLING_DAMAGE",
    "FACILITY_EQUIPMENT_FAULT", "CONDUCT_PROCESS_GRIEVANCE",
]

TEMPLATES: dict[str, list[str]] = {
    "INVENTORY_DISCREPANCY": [
        "The count for {lot} at {loc} came up {n} units short against the register.",
        "During reconciliation the physical quantity of {lot} did not match the ledger; we found {qty} instead of {qty2}.",
        "There is a count mismatch on {lot}: the issue voucher shows {n} more than what was actually returned to {loc}.",
        "Stock records for {lot} list {qty2} items but only {qty} are present in {loc}.",
        "Monthly stocktake at {loc} shows {lot} missing {n} units with no matching issue record.",
    ],
    "STORAGE_ENVIRONMENT": [
        "The humidity indicator in {loc} has read above {rh}% for {days} days and the packaging on {lot} looks damp.",
        "Temperature in {loc} exceeded the storage limit, reaching {temp} degrees, and {lot} is stored there.",
        "Condensation and damp patches were seen on the walls of {loc}; humidity has stayed high since {date}.",
        "The air conditioning in {loc} stopped and the bay got too warm for {lot}.",
        "Environmental logs for {loc} show repeated humidity excursions over the limit this week.",
    ],
    "PACKAGING_LABELLING_DEFECT": [
        "Several boxes of {lot} at {loc} have torn outer packaging and the seal is broken on {n} crates.",
        "The labels on {lot} are faded and the lot number cannot be read on {n} containers.",
        "Crates of {lot} received at {loc} carry labels that do not match the lot number on the documents.",
        "Packaging on {lot} shows rust on the metal bands and some lids do not close properly.",
        "Two different lot labels were found on the same pallet of {lot} in {loc}.",
    ],
    "DOCUMENTATION_CUSTODY_GAP": [
        "The custody record for {lot} has no signature for the transfer into {loc} on {date}.",
        "There is a gap in the chain of custody for {lot}: no handover document between issue and return.",
        "The movement of {lot} to {loc} was never entered in the register and the transfer form is missing.",
        "Issue paperwork for {lot} is incomplete; the receiving officer field is blank.",
        "Records show {lot} was returned on {date} but no receipt was filed at {loc}.",
    ],
    "UNAUTHORISED_ACCESS": [
        "The door to {loc} was found unlocked and left open overnight with no entry in the access log.",
        "Someone without authorisation entered {loc} on {date}; the visitor log has no record of the entry.",
        "Signs of forced entry were seen on the lock of {loc} this morning.",
        "An access card that should have been revoked was used to open {loc} at night.",
        "Personnel not on the access list were seen inside {loc} without an escort.",
    ],
    "SAFETY_PROCEDURE_VIOLATION": [
        "Staff in {loc} were handling {lot} without following the two-person rule.",
        "Smoking was observed near {loc} in breach of the safety procedure.",
        "Fire extinguishers at {loc} were missing during handling of {lot}, against standing orders.",
        "The safety briefing was skipped before moving {lot} out of {loc}.",
        "Handling of {lot} in {loc} continued after the safety officer ordered a stop.",
    ],
    "INSPECTION_OVERDUE": [
        "The periodic inspection of {lot} is overdue by {days} days according to the schedule.",
        "No inspection has been recorded for {loc} since {date}, well past the required interval.",
        "{lot} has passed its inspection due date and is still listed as serviceable.",
        "The quarterly inspection for {loc} was postponed twice and is now overdue.",
        "Shelf-life review for {lot} was not carried out on time.",
    ],
    "TRANSPORT_HANDLING_DAMAGE": [
        "During transport to {loc} the vehicle braked hard and {n} crates of {lot} were dented.",
        "Crates of {lot} were dropped while unloading at {loc}; the forklift operator reported it.",
        "The pallet of {lot} shifted in the truck and several boxes were crushed on arrival.",
        "{lot} arrived at {loc} with impact damage to the containers after the convoy.",
        "Loading equipment struck the stack of {lot} during transfer and damaged {n} boxes.",
    ],
    "FACILITY_EQUIPMENT_FAULT": [
        "The ventilation fan in {loc} has failed and makes a grinding noise.",
        "Lighting in {loc} is out and the backup generator did not start during the outage.",
        "The forklift assigned to {loc} has a hydraulic leak and was still in use.",
        "The roof of {loc} leaks when it rains and water collects near the door.",
        "The intruder alarm panel for {loc} shows a fault and has not been repaired.",
    ],
    "CONDUCT_PROCESS_GRIEVANCE": [
        "My request about the duty roster at {loc} was ignored for {days} days without explanation.",
        "The supervisor at {loc} was rude to staff during the handover and refused to answer questions.",
        "I raised a concern about workload on {date} and received no response from the office.",
        "Leave approvals at {loc} are handled unfairly and the process is not transparent.",
        "The complaint I filed earlier was closed without anyone contacting me.",
    ],
}

OPENERS = ["", "", "Reporting that ", "I want to report that ", "Please note: ", "Concern raised: ", "For the record, ", "Observed today: "]
CLOSERS = ["", "", " Please investigate.", " This needs attention.", " Requesting an inspection.", " Logged for follow-up.",
           " Kindly look into this.", " Raising it before it gets worse."]
SYNONYMS = {
    "found": ["found", "discovered", "noticed"], "seen": ["seen", "observed", "noticed"], "damaged": ["damaged", "harmed"],
    "missing": ["missing", "absent", "unaccounted for"], "boxes": ["boxes", "cartons"], "staff": ["staff", "personnel"],
    "shows": ["shows", "indicates"], "record": ["record", "entry"],
}


def _lot(rnd: random.Random) -> str:
    return f"LOT-{rnd.choice('AB')}{rnd.randint(1, 12):02d}-2025-{rnd.randint(1, 140):04d}"


def _loc(rnd: random.Random) -> str:
    return f"DEP-{rnd.randint(1, 2):02d}/MAG-{rnd.randint(1, 2):02d}/BAY-{rnd.randint(1, 4):02d}"


def _render(rnd: random.Random, template: str, lot: str, loc: str, date: datetime) -> str:
    qty2 = rnd.randint(40, 400)
    text = template.format(lot=lot, loc=loc, n=rnd.randint(2, 30), qty=qty2 - rnd.randint(1, 30), qty2=qty2, rh=rnd.randint(72, 92),
                           days=rnd.randint(2, 20), temp=rnd.randint(31, 42), date=(date - timedelta(days=rnd.randint(1, 20))).strftime("%d %b"))
    words = text.split(" ")
    for i, w in enumerate(words):
        key = w.strip(".,;:").lower()
        if key in SYNONYMS and rnd.random() < 0.5:
            words[i] = w.replace(key, rnd.choice(SYNONYMS[key]))
    text = " ".join(words)
    opener = rnd.choice(OPENERS)
    if opener:
        text = opener + text[0].lower() + text[1:] if not text.startswith("LOT") and not text.startswith("{") else opener + text
    return text + rnd.choice(CLOSERS)


def _typo(rnd: random.Random, text: str) -> str:
    words = text.split(" ")
    idx = [i for i, w in enumerate(words) if w.isalpha() and len(w) > 4]
    if not idx:
        return text
    i = rnd.choice(idx)
    w = words[i]
    j = rnd.randrange(len(w) - 1)
    words[i] = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    return " ".join(words)


GOLD_RISK = {
    "UNAUTHORISED_ACCESS": "HIGH", "SAFETY_PROCEDURE_VIOLATION": "HIGH", "STORAGE_ENVIRONMENT": "MEDIUM", "INVENTORY_DISCREPANCY": "MEDIUM",
    "DOCUMENTATION_CUSTODY_GAP": "MEDIUM", "TRANSPORT_HANDLING_DAMAGE": "MEDIUM", "PACKAGING_LABELLING_DEFECT": "LOW",
    "INSPECTION_OVERDUE": "LOW", "FACILITY_EQUIPMENT_FAULT": "LOW", "CONDUCT_PROCESS_GRIEVANCE": "LOW",
}


def generate(n: int = 2000, seed: int = 42) -> list[dict]:
    rnd = random.Random(seed)
    start = datetime(2026, 4, 1)
    rows: list[dict] = []
    n_dup = int(n * 0.15)
    per_cat = (n - n_dup) // len(CATEGORIES)
    for cat in CATEGORIES:
        for _ in range(per_cat):
            lot, loc = _lot(rnd), _loc(rnd)
            filed = start + timedelta(days=rnd.randint(0, 180), hours=rnd.randint(0, 23))
            rows.append({"category": cat, "asset": lot, "location": loc, "filed_at": filed,
                         "text": _render(rnd, rnd.choice(TEMPLATES[cat]), lot, loc, filed), "dup_group": None})
    rnd.shuffle(rows)
    # Near-duplicates: same asset/location, different phrasing, filed 0-30 days after the source. Spread evenly over categories.
    by_cat = {c: [r for r in rows if r["category"] == c] for c in CATEGORIES}
    for k in range(n - len(rows)):
        src = rnd.choice(by_cat[CATEGORIES[k % len(CATEGORIES)]])
        filed = src["filed_at"] + timedelta(days=rnd.randint(0, 30), hours=rnd.randint(0, 23))
        group = src["dup_group"] or f"G{len(rows):05d}"
        src["dup_group"] = group
        rows.append({"category": src["category"], "asset": src["asset"], "location": src["location"], "filed_at": filed, "dup_group": group,
                     "text": _render(rnd, rnd.choice(TEMPLATES[src["category"]]), src["asset"], src["location"], filed)})
    for i, r in enumerate(rows):
        r["id"] = f"C{i:05d}"
        if rnd.random() < 0.05:
            r["text"] = _typo(rnd, r["text"])
        r["gold_risk"] = GOLD_RISK[r["category"]]
        r["filed_at"] = r["filed_at"].isoformat() + "Z"
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "data" / "corpus.jsonl"))
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = generate(a.n, a.seed)
    out.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    print(f"wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()
