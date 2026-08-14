"""Regression coverage for the fully local document knowledge-map model."""

from backend.model.document_graph import LocalDocumentGraphExtractor


def test_document_model_maps_a_dense_cross_domain_sentence_locally() -> None:
    source = (
        "Recent randomized trials indicate that chronic exposure to fine particulate matter "
        "increases systemic inflammation, which may accelerate atherosclerotic plaque formation "
        "and elevate cardiovascular risk among older adults."
    )

    graph = LocalDocumentGraphExtractor().extract(source)

    labels = {concept.label for concept in graph.concepts}
    assert {
        "chronic exposure",
        "fine particulate matter",
        "systemic inflammation",
        "atherosclerotic plaque formation",
        "cardiovascular risk",
    } <= labels
    relation_labels = {(relation.label, relation.evidence[0].quote) for relation in graph.relations}
    assert any(label == "increase" and quote == source for label, quote in relation_labels)
    assert any(label == "accelerate" and quote == source for label, quote in relation_labels)
    assert any(label == "elevate" and quote == source for label, quote in relation_labels)
    assert graph.analysis.mode == "document"
    assert graph.analysis.coverage == "document"
    assert all(concept.evidence[0].quote in source for concept in graph.concepts)
    assert all(relation.evidence[0].quote == source for relation in graph.relations)


def test_document_model_does_not_call_an_external_service() -> None:
    graph = LocalDocumentGraphExtractor().extract("Ada joined Acme in London.")

    assert graph.concepts
    assert graph.analysis.notice.startswith("Built locally")
