import hashlib
import json
import math
import re
import threading
from collections import Counter
from time import perf_counter

import numpy as np
from fastembed import TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder
from rank_bm25 import BM25Okapi

from .config import EDITION, EMBEDDING_MODEL, RERANKER_MODEL, Settings
from .models import Chunk, Evidence

STOPWORDS = set(
    "a an the is are was were be been being i my me you your we our they their it its "
    "this that these those do does did can could would should will what which how why "
    "when where who with and or of to for from in on at by as if then than about please "
    "tell explain rules rule srd using use have has had am".split()
)


def tokenize(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOPWORDS]


def reciprocal_rank_fusion(rankings: list[list[int]], k: int = 60) -> dict[int, float]:
    combined: dict[int, float] = {}
    for ranking in rankings:
        for rank, index in enumerate(ranking, start=1):
            combined[index] = combined.get(index, 0.0) + 1 / (k + rank)
    return combined


def named_definitions(query: str, chunks: list[Chunk], eligible: list[int]) -> list[int]:
    """Find explicit glossary terms so composite queries retain each definition."""
    normalized = " " + " ".join(re.findall(r"[a-z0-9]+", query.casefold())) + " "
    matches = []
    seen = set()
    for i in eligible:
        chunk = chunks[i]
        if chunk.category != "Rules Glossary":
            continue
        title = re.sub(r"\s*\[[^]]+\]", "", chunk.title).casefold()
        term = " ".join(re.findall(r"[a-z0-9]+", title))
        if term and f" {term} " in normalized and term not in seen:
            matches.append((i, int("[" in chunk.title), len(term.split()), len(term)))
            seen.add(term)
    # Prefer specific names over short generic terms; leave space for context.
    return [
        i
        for i, _, _, _ in sorted(matches, key=lambda item: (-item[1], -item[2], -item[3], item[0]))[
            :4
        ]
    ]


def core_rule_queries(query: str) -> list[tuple[str, str]]:
    """Map everyday descriptions to SRD headings, without supplying an answer.

    Damage sources often dominate similarity scores. Reserve the general rules
    needed to interpret death/zero HP before considering a particular hazard.
    Keep the mapping visible in the trace and restricted to the eligible corpus.
    """
    death = re.search(r"\b(die|dies|died|dying|dead|death|killed)\b", query, re.I)
    # A damage die is a dice term, not a character's death.
    damage_die = re.search(
        r"\b(damage|hit|one|single|a|the) die\b|\bdie (size|roll)\b", query, re.I
    )
    zero_hp = re.search(r"\b(0|zero)\s*(hp|hit points?)\b", query, re.I)
    burning = re.search(r"\b(burning|on fire)\b", query, re.I)
    damage_type = re.search(
        r"\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b",
        query,
        re.I,
    )
    if not zero_hp and (not death or damage_die):
        return [("Rules Glossary", "Burning [Hazard]")] if burning else []
    headings = []
    if death and not damage_die:
        headings.append(("Rules Glossary", "Dead"))
    if damage_type and death and not damage_die:
        headings.append(("Rules Glossary", "Damage Types"))
    # A named spell about the dead still gets its own retrieval slots. General
    # damage/death questions need both the outcome and the instant-death exception.
    if zero_hp or (death and damage_type):
        headings.extend(
            [
                ("Playing the Game", "Falling Unconscious"),
                ("Playing the Game", "Instant Death"),
                ("Playing the Game", "Death Saving Throws"),
            ]
        )
    if burning:
        headings.append(("Rules Glossary", "Burning [Hazard]"))
    return headings


def core_rule_anchors(query: str, chunks: list[Chunk], eligible: list[int]) -> list[int]:
    anchors = []
    for category, title in core_rule_queries(query):
        # Headings can span several chunks. Prefer the beginning of the rule;
        # continuations remain candidates through normal retrieval.
        matches = [
            i for i in eligible if chunks[i].category == category and chunks[i].title == title
        ]
        count = (
            2
            if title == "Death Saving Throws"
            and re.search(r"\b(0|zero)\s*(hp|hit points?)\b", query, re.I)
            else 1
        )
        anchors.extend(matches[:count])
    return anchors


class Retriever:
    def __init__(self, settings: Settings):
        self.settings = settings
        directory = settings.index_dir
        corpus = (directory / "chunks.jsonl").read_bytes()
        self.manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if hashlib.sha256(corpus).hexdigest() != self.manifest["corpus_sha256"]:
            raise ValueError("Corpus checksum mismatch. Run rulekeeper ingest to rebuild.")
        self.chunks = [Chunk.model_validate_json(line) for line in corpus.splitlines() if line]
        self.by_id = {c.id: c for c in self.chunks}
        self.lexical = BM25Okapi([tokenize(f"{c.title} {c.title} {c.text}") for c in self.chunks])
        # Positive Robertson IDF preserves matches even when a term occurs in
        # exactly half of a small corpus (classic log-odds IDF would be zero).
        frequencies = Counter(word for document in self.lexical.doc_freqs for word in document)
        self.lexical.idf = {
            word: math.log1p((len(self.chunks) - count + 0.5) / (count + 0.5))
            for word, count in frequencies.items()
        }
        self.vectors = None
        if (directory / "embeddings.npy").exists():
            self.vectors = np.load(directory / "embeddings.npy", allow_pickle=False)
            if self.vectors.shape != (len(self.chunks), 384):
                raise ValueError("Embedding shape does not match the corpus; rebuild the index.")
            if self.manifest.get("embedding_model") != EMBEDDING_MODEL:
                raise ValueError(
                    "Embedding model differs from the indexed model; rebuild the index."
                )
        self._encoder = None
        self._reranker = None
        self._lock = threading.Lock()

    def _models(self, *, rerank: bool) -> None:
        with self._lock:
            if self._encoder is None:
                self._encoder = TextEmbedding(
                    EMBEDDING_MODEL,
                    cache_dir=str(self.settings.model_cache),
                    threads=self.settings.model_threads,
                )
            if rerank and self._reranker is None:
                self._reranker = TextCrossEncoder(
                    RERANKER_MODEL,
                    cache_dir=str(self.settings.model_cache),
                    threads=self.settings.model_threads,
                )

    def search(
        self,
        query: str,
        *,
        mode: str = "hybrid",
        category: str | None = None,
        edition: str = EDITION,
        limit: int = 6,
        rerank: bool | None = None,
    ) -> tuple[list[Evidence], dict]:
        started = perf_counter()
        if mode not in {"lexical", "dense", "hybrid"}:
            raise ValueError("Unknown retrieval mode")
        eligible = np.array(
            [
                i
                for i, c in enumerate(self.chunks)
                if c.edition == edition and (not category or c.category == category)
            ],
            dtype=int,
        )
        if not len(eligible) or not tokenize(query):
            return [], {"mode": mode, "candidate_count": 0, "retrieval_ms": 0}
        do_rerank = (self.settings.rerank if rerank is None else rerank) and mode == "hybrid"
        search_query = re.sub(r"\bhp\b", "Hit Points", query, flags=re.I)
        lexical_scores = self.lexical.get_scores(tokenize(search_query))
        dense_scores = np.zeros(len(self.chunks))
        lexical_rank = eligible[np.argsort(-lexical_scores[eligible], kind="stable")][:40].tolist()
        lexical_rank = [i for i in lexical_rank if lexical_scores[i] > 0]
        dense_rank: list[int] = []
        if mode in {"dense", "hybrid"}:
            if self.vectors is None:
                raise ValueError(
                    "Semantic index is missing. Run rulekeeper ingest without --no-embed."
                )
            self._models(rerank=do_rerank)
            query_vector = np.array(list(self._encoder.query_embed([search_query]))[0])
            query_vector /= max(float(np.linalg.norm(query_vector)), 1e-12)
            dense_scores = self.vectors @ query_vector
            dense_rank = eligible[np.argsort(-dense_scores[eligible], kind="stable")][:40].tolist()
        rankings = [lexical_rank] if mode == "lexical" else [dense_rank]
        if mode == "hybrid":
            rankings = [lexical_rank, dense_rank]
        fused = reciprocal_rank_fusion(rankings)
        candidates = sorted(fused, key=lambda i: (-fused[i], i))[:24]
        anchors = (
            named_definitions(query, self.chunks, eligible.tolist()) if mode == "hybrid" else []
        )
        core_anchors = (
            core_rule_anchors(query, self.chunks, eligible.tolist()) if mode == "hybrid" else []
        )
        definition_anchors = anchors
        # Keep at least one slot for a named spell, hazard, or other retrieved
        # context. General-rule anchors never bypass edition/category filtering.
        anchors = list(dict.fromkeys(core_anchors + anchors))[: max(0, limit - 1)]
        for i in anchors:
            fused.setdefault(i, 0.0)
        candidates = anchors + [i for i in candidates if i not in anchors][: 24 - len(anchors)]
        rerank_scores: dict[int, float] = {}
        if do_rerank and candidates:
            scores = list(
                self._reranker.rerank(
                    search_query,
                    [f"{self.chunks[i].title}. {self.chunks[i].text}" for i in candidates],
                )
            )
            rerank_scores = dict(zip(candidates, (float(s) for s in scores), strict=True))
            candidates.sort(key=lambda i: (-rerank_scores[i], -fused[i]))
        # A cross-encoder can prefer a special spell effect over the definitions
        # needed to reason about two named conditions. Preserve those premises.
        candidates = anchors + [i for i in candidates if i not in anchors]
        # Avoid filling the context with overlapping pieces of the same rule.
        chosen: list[int] = []
        for i in candidates:
            c = self.chunks[i]
            if any(
                self.chunks[j].title == c.title and self.chunks[j].page_start == c.page_start
                for j in chosen
            ):
                continue
            chosen.append(i)
            if len(chosen) == limit:
                break
        evidence = [
            Evidence(
                **self.chunks[i].model_dump(),
                citation=n,
                score=round(fused[i], 6),
                lexical_score=round(float(lexical_scores[i]), 4),
                dense_score=round(float(dense_scores[i]), 4),
                rerank_score=round(rerank_scores[i], 4) if i in rerank_scores else None,
            )
            for n, i in enumerate(chosen, 1)
        ]
        return evidence, {
            "mode": mode,
            "reranker": RERANKER_MODEL if do_rerank else None,
            "embedding_model": EMBEDDING_MODEL if mode != "lexical" else None,
            "candidate_count": len(fused),
            "reranked_count": len(rerank_scores),
            "definition_anchors": [
                self.chunks[i].title for i in definition_anchors if i in anchors
            ],
            "core_rule_anchors": [self.chunks[i].title for i in core_anchors if i in anchors],
            "retrieval_ms": round((perf_counter() - started) * 1000, 1),
            "corpus_sha256": self.manifest["corpus_sha256"],
        }
