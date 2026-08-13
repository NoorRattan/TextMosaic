"""Fully local document-to-knowledge-map extraction.

The bundled spaCy pipeline performs tokenization, tagging, dependency parsing,
and named-entity recognition inside this process. It makes no HTTP requests at
inference time. Graph explanations are deterministic templates; each graph
item carries an exact quote from the submitted source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from backend.api.schemas import AnalysisMetadata, Concept, Evidence, GraphRelation

try:
    import spacy
    from spacy.language import Language
    from spacy.tokens import Doc, Span, Token
except ImportError:  # pragma: no cover - exercised only in an incomplete install
    spacy = None
    Language = Any
    Doc = Any
    Span = Any
    Token = Any


class LocalModelUnavailableError(RuntimeError):
    """Raised when the bundled local document model was not installed."""


@dataclass(frozen=True)
class DocumentGraph:
    """The local model's map plus a transparent capability statement."""

    concepts: list[Concept]
    relations: list[GraphRelation]
    analysis: AnalysisMetadata


@dataclass(frozen=True)
class _Candidate:
    """A local-parser phrase before it is converted into a public concept."""

    start: int
    end: int
    root: Token
    label: str
    kind: str
    priority: int


_ENTITY_KINDS = {
    "PERSON": "person",
    "NORP": "group",
    "FAC": "facility",
    "ORG": "organization",
    "GPE": "place",
    "LOC": "location",
    "PRODUCT": "product",
    "EVENT": "event",
    "WORK_OF_ART": "work",
    "LAW": "law or policy",
    "LANGUAGE": "language",
    "DATE": "date",
    "TIME": "time",
    "MONEY": "amount",
    "PERCENT": "percentage",
    "QUANTITY": "quantity",
    "ORDINAL": "ordinal",
    "CARDINAL": "quantity",
}
_SKIP_LEMMAS = {"thing", "something", "anything", "someone", "which", "that", "it"}
_SUBJECT_DEPS = {"nsubj", "nsubjpass", "csubj"}
_OBJECT_DEPS = {"dobj", "obj", "attr", "oprd", "dative", "pobj"}


def _key(value: str) -> str:
    return re.sub(r"\W+", " ", value.casefold()).strip()


def _compact_quote(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()[:500]


class LocalDocumentGraphExtractor:
    """Build an evidence-only graph with a local dependency/NER model."""

    def __init__(self, nlp: Language | None = None) -> None:
        self._nlp = nlp

    def _pipeline(self) -> Language:
        if self._nlp is not None:
            return self._nlp
        if spacy is None:
            raise LocalModelUnavailableError("The local document model is not installed.")
        try:
            self._nlp = spacy.load("en_core_web_sm")
        except OSError as error:
            raise LocalModelUnavailableError("The local document model is not installed.") from error
        return self._nlp

    def extract(self, source: str) -> DocumentGraph:
        doc = self._pipeline()(source)
        candidates = self._concept_candidates(doc)
        concepts, candidate_concepts = self._to_concepts(candidates)
        relations = self._relations(doc, candidates, candidate_concepts)
        return DocumentGraph(
            concepts=concepts,
            relations=relations,
            analysis=AnalysisMetadata(
                mode="document",
                coverage="document",
                notice=(
                    "Built locally from the bundled language model. Each concept and relationship is "
                    "linked to an exact sentence from your source; no text leaves this service."
                ),
            ),
        )

    def _concept_candidates(self, doc: Doc) -> list[_Candidate]:
        candidates: list[_Candidate] = []
        for entity in doc.ents:
            label = _compact_quote(entity.text)
            if label:
                candidates.append(
                    _Candidate(
                        entity.start_char,
                        entity.end_char,
                        entity.root,
                        label,
                        _ENTITY_KINDS.get(entity.label_, entity.label_.replace("_", " ").lower()),
                        3,
                    )
                )
        for chunk in doc.noun_chunks:
            label = _compact_quote(chunk.text)
            leading = re.match(r"^(?:that|which)\s+", label, flags=re.IGNORECASE)
            start = chunk.start_char
            if leading is not None:
                start += leading.end()
                label = label[leading.end() :]
            if (
                not label
                or len(chunk) > 9
                or chunk.root.lemma_.casefold() in _SKIP_LEMMAS
                or not any(token.pos_ in {"NOUN", "PROPN"} for token in chunk)
            ):
                continue
            candidates.append(
                _Candidate(
                    start,
                    chunk.end_char,
                    chunk.root,
                    label,
                    "concept" if chunk.root.pos_ == "NOUN" else "named concept",
                    1,
                )
            )
        return self._dedupe_candidates(candidates)

    @staticmethod
    def _dedupe_candidates(candidates: list[_Candidate]) -> list[_Candidate]:
        selected: list[_Candidate] = []
        keys: set[str] = set()
        for candidate in sorted(candidates, key=lambda item: (-item.priority, item.start, -(item.end - item.start))):
            normalized = _key(candidate.label)
            overlaps = any(candidate.start < item.end and candidate.end > item.start for item in selected)
            if not normalized or normalized in keys or overlaps:
                continue
            selected.append(candidate)
            keys.add(normalized)
        return sorted(selected, key=lambda item: item.start)[:28]

    @staticmethod
    def _to_concepts(candidates: list[_Candidate]) -> tuple[list[Concept], dict[_Candidate, Concept]]:
        concepts: list[Concept] = []
        by_candidate: dict[_Candidate, Concept] = {}
        for index, candidate in enumerate(candidates, start=1):
            article = "an" if candidate.kind[:1].lower() in "aeiou" else "a"
            concept = Concept(
                id=f"concept-{index}",
                label=candidate.label,
                kind=candidate.kind,
                explanation=f"{candidate.label} is {article} {candidate.kind} identified by the local language model.",
                evidence=[Evidence(quote=candidate.label)],
                confidence=0.82 if candidate.priority == 3 else 0.66,
            )
            concepts.append(concept)
            by_candidate[candidate] = concept
        return concepts, by_candidate

    def _relations(
        self,
        doc: Doc,
        candidates: list[_Candidate],
        concepts: dict[_Candidate, Concept],
    ) -> list[GraphRelation]:
        relationships: list[GraphRelation] = []
        seen: set[tuple[str, str, str]] = set()
        for sentence in doc.sents:
            in_sentence = [
                item
                for item in candidates
                if sentence.start_char <= item.start and item.end <= sentence.end_char
            ]
            if len(in_sentence) < 2:
                continue
            for verb in sentence:
                if verb.pos_ not in {"VERB", "AUX"} or verb.dep_ in {"aux", "auxpass"}:
                    continue
                subjects = self._subject_candidates(verb, in_sentence)
                objects = self._argument_candidates(verb, in_sentence, _OBJECT_DEPS)
                if not subjects:
                    relative_subject = next(
                        (child for child in verb.children if child.lower_ in {"which", "that"}),
                        None,
                    )
                    if relative_subject is not None:
                        subjects = self._nearest_before(relative_subject, in_sentence)
                for subject in subjects:
                    for obj in objects:
                        if subject == obj:
                            continue
                        source = concepts[subject]
                        target = concepts[obj]
                        label = self._relation_label(verb)
                        relation_key = (source.id, target.id, label)
                        if relation_key in seen:
                            continue
                        seen.add(relation_key)
                        quote = _compact_quote(sentence.text)
                        relationships.append(
                            GraphRelation(
                                source=source.id,
                                target=target.id,
                                label=label,
                                explanation=(
                                    f"The local parser connects {source.label} to {target.label} through "
                                    f"the action '{label}'."
                                ),
                                evidence=[Evidence(quote=quote)],
                                confidence=0.72,
                            )
                        )
        return relationships[:56]

    @staticmethod
    def _argument_candidates(verb: Token, candidates: list[_Candidate], dependencies: set[str]) -> list[_Candidate]:
        arguments: list[_Candidate] = []
        argument_tokens = [child for child in verb.children if child.dep_ in dependencies]
        if dependencies == _OBJECT_DEPS:
            for child in verb.children:
                if child.dep_ != "prep" or child.lemma_ in {"after", "before", "during", "within"}:
                    continue
                argument_tokens.extend(grandchild for grandchild in child.children if grandchild.dep_ == "pobj")
        for token in argument_tokens:
            match = min(
                candidates,
                key=lambda candidate: abs(candidate.root.i - token.i),
                default=None,
            )
            if match is not None and abs(match.root.i - token.i) <= 4 and match not in arguments:
                arguments.append(match)
        return arguments

    @classmethod
    def _subject_candidates(cls, verb: Token, candidates: list[_Candidate]) -> list[_Candidate]:
        direct = cls._argument_candidates(verb, candidates, _SUBJECT_DEPS)
        if direct:
            return direct
        if verb.dep_ == "conj" and verb.head.pos_ in {"VERB", "AUX"}:
            return cls._subject_candidates(verb.head, candidates)
        if verb.dep_ == "xcomp" and verb.head.pos_ in {"VERB", "AUX"}:
            return cls._argument_candidates(verb.head, candidates, _OBJECT_DEPS)
        return []

    @staticmethod
    def _nearest_before(token: Token, candidates: list[_Candidate]) -> list[_Candidate]:
        before = [candidate for candidate in candidates if candidate.root.i < token.i]
        return [max(before, key=lambda candidate: candidate.root.i)] if before else []

    @staticmethod
    def _relation_label(verb: Token) -> str:
        particles = [
            child.lemma_
            for child in verb.children
            if child.dep_ == "prt"
            or (child.dep_ == "prep" and child.lemma_ not in {"after", "before", "during", "within"})
        ]
        return " ".join([verb.lemma_, *particles]).replace("-PRON-", "relates to")[:120]
