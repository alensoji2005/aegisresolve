from ai.entities import extract_entities, severity_hits


def test_lot_location_condition():
    text = "LOT-B03-2025-0117 at DEP-02/MAG-01/BAY-04 seal broken"
    ents = extract_entities(text)
    lot = next(e for e in ents if e["type"] == "LOT")
    loc = next(e for e in ents if e["type"] == "LOCATION")
    assert lot["value"] == "LOT-B03-2025-0117"
    assert loc["value"] == "DEP-02/MAG-01/BAY-04" and text[loc["span"][0]:loc["span"][1]] == loc["value"]
    assert {"type": "CONDITION", "value": "seal broken", "span": [42, 53], "source": "gazetteer"} in ents


def test_severity_counts_distinct_terms():
    assert severity_hits(extract_entities("damp, damp and rust; door left open")) == 3


def test_partial_location():
    assert [e["value"] for e in extract_entities("store DEP-01 was fine") if e["type"] == "LOCATION"] == ["DEP-01"]
