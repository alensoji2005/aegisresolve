from collections import Counter

from ai.corpus.generate import CATEGORIES, generate
from ai.train_classifier import split


def test_size_and_balance():
    rows = generate(2000, 42)
    assert len(rows) == 2000
    counts = Counter(r["category"] for r in rows)
    assert set(counts) == set(CATEGORIES)
    assert all(190 <= c <= 210 for c in counts.values()), counts


def test_near_duplicates_share_asset_and_group():
    rows = generate(2000, 42)
    groups = {}
    for r in rows:
        if r["dup_group"]:
            groups.setdefault(r["dup_group"], []).append(r)
    assert sum(len(g) for g in groups.values()) >= 300
    assert all(len({r["asset"] for r in g}) == 1 for g in groups.values())


def test_deterministic():
    assert generate(200, 7) == generate(200, 7)


def test_no_dup_group_spans_train_and_test():
    rows = generate(2000, 42)
    tr, va, te = split(rows)
    g = lambda idx: {rows[i]["dup_group"] for i in idx if rows[i]["dup_group"]}
    assert not (g(tr) & g(te)) and not (g(va) & g(te)) and not (g(tr) & g(va))
    assert 0.12 <= len(te) / len(rows) <= 0.18
