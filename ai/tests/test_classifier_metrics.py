def test_embedding_classifier_macro_f1(trained):
    assert trained["embed_lr"]["macro_f1"] >= 0.85, trained["embed_lr"]["macro_f1"]


def test_baseline_reported(trained):
    assert "macro_f1" in trained["tfidf_lr"]
