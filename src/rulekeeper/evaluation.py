import json
import platform
from datetime import UTC, datetime
from time import perf_counter

import numpy as np

from .config import ROOT, Settings
from .retrieval import Retriever


def matches(chunk, group: dict) -> bool:
    return (
        chunk.title in group["titles"]
        and group.get("contains", "").casefold() in chunk.text.casefold()
    )


def evaluate(settings: Settings, *, split: str = "test") -> dict:
    all_questions = json.loads((ROOT / "eval/questions.json").read_text(encoding="utf-8"))
    questions = [q for q in all_questions if split == "all" or q["split"] == split]
    retriever = Retriever(settings)
    for question in questions:
        for group in question["groups"]:
            if not any(matches(c, group) for c in retriever.chunks):
                raise ValueError(f"Gold evidence missing for {question['id']}: {group}")
    # Warm models once; reported latency is warm query latency, not first-load cost.
    retriever.search("What does an attack roll determine?")
    methods = [
        ("lexical", "lexical", False),
        ("dense", "dense", False),
        ("hybrid", "hybrid", False),
        ("hybrid_reranked", "hybrid", True),
    ]
    result = {
        "available": True,
        "split": split,
        "questions": len(questions),
        "built_at": datetime.now(UTC).isoformat(),
        "corpus_sha256": retriever.manifest["corpus_sha256"],
        "environment": {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "model_threads": settings.model_threads,
        },
        "methodology": "Authored question set; required groups matched by title and supporting phrase. Recall@6 is the mean fraction of required groups retrieved per question. MRR is reciprocal rank of first relevant passage. Timings are warm, end-to-end retrieval. No answer-quality claim.",
        "results": {},
        "details": [],
    }
    for name, mode, rerank in methods:
        recalls, reciprocals, latencies = [], [], []
        for question in questions:
            started = perf_counter()
            evidence, _ = retriever.search(question["question"], mode=mode, rerank=rerank)
            latencies.append((perf_counter() - started) * 1000)
            groups = question["groups"]
            recall = sum(any(matches(e, g) for e in evidence) for g in groups) / len(groups)
            relevant_ranks = [
                i for i, e in enumerate(evidence, 1) if any(matches(e, g) for g in groups)
            ]
            reciprocal = 1 / min(relevant_ranks) if relevant_ranks else 0
            recalls.append(recall)
            reciprocals.append(reciprocal)
            result["details"].append(
                {
                    "id": question["id"],
                    "method": name,
                    "recall_at_6": recall,
                    "reciprocal_rank": reciprocal,
                    "retrieved": [
                        {"id": e.id, "title": e.title, "page": e.page_start} for e in evidence
                    ],
                }
            )
        result["results"][name] = {
            "recall_at_6": round(float(np.mean(recalls)), 4),
            "mrr": round(float(np.mean(reciprocals)), 4),
            "p50_ms": round(float(np.median(latencies)), 1),
            "p95_ms": round(float(np.percentile(latencies, 95)), 1),
        }
        print(f"{name}: {result['results'][name]}", flush=True)
    name = "results.json" if split == "test" else f"results-{split}.json"
    (ROOT / "eval" / name).write_text(json.dumps(result, indent=2), encoding="utf-8")
    return {key: value for key, value in result.items() if key != "details"}
