"""Deterministic, layout-aware extraction of the pinned official SRD.

The SRD uses two columns and heading typography. Reading an entire page as a
single string interleaves rules; each column is processed separately instead.
"""

import hashlib
import json
import re
from datetime import UTC, datetime

import httpx
import numpy as np
import pdfplumber
from fastembed import TextEmbedding

from .config import EDITION, EMBEDDING_MODEL, SOURCE_SHA256, SOURCE_URL, Settings
from .models import Chunk


def clean_text(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\ufb01", "fi").replace("\ufb02", "fl")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    return re.sub(r"\s+", " ", text).strip()


def layout_lines(chars: list[dict], page_height: float, left: float, right: float) -> list[dict]:
    """Group on text baselines, not font bounding boxes.

    The PDF's Cambria and Gill Sans bounding boxes have different vertical
    offsets. Sorting on `top` can weave an italic label into the previous line.
    The text matrix baseline avoids that corruption and keeps bottom lines.
    """
    selected = [
        c
        for c in chars
        if left <= c["x0"] < right and 25 <= page_height - c["matrix"][5] <= page_height - 48
    ]
    rows: list[list[dict]] = []
    for char in sorted(selected, key=lambda c: (-c["matrix"][5], c["x0"])):
        if not rows or abs(rows[-1][0]["matrix"][5] - char["matrix"][5]) > 2:
            rows.append([])
        rows[-1].append(char)
    output = []
    for row in rows:
        row.sort(key=lambda c: c["x0"])
        parts = []
        for i, char in enumerate(row):
            if i and char["x0"] - row[i - 1]["x1"] > 1.6:
                parts.append(" ")
            parts.append(char["text"])
        output.append({"text": "".join(parts), "chars": row})
    return output


def download_source(settings: Settings) -> str:
    path = settings.source_path
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        temporary = path.with_suffix(".part")
        with httpx.stream("GET", SOURCE_URL, follow_redirects=True, timeout=120) as response:
            response.raise_for_status()
            with temporary.open("wb") as out:
                for block in response.iter_bytes():
                    out.write(block)
        digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        if digest != SOURCE_SHA256:
            temporary.unlink(missing_ok=True)
            raise ValueError(
                "Official PDF checksum changed. Review the source before updating the pin."
            )
        temporary.replace(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError("SRD PDF checksum mismatch; refusing to index an unverified source.")
    return digest


def extract_chunks(settings: Settings) -> list[Chunk]:
    chunks: list[Chunk] = []
    heading = "Playing the Game"
    category = "Playing the Game"
    fragments: list[tuple[str, int]] = []
    chapter_names = {
        "Playing the Game",
        "Character Creation",
        "Classes",
        "Character Origins",
        "Feats",
        "Equipment",
        "Spells",
        "Rules Glossary",
        "Gameplay Toolbox",
        "Magic Items",
        "Monsters",
        "Animals",
        "Appendix A",
        "Appendix B",
    }

    def flush() -> None:
        if not fragments:
            return
        # Retain page provenance per word even for sections crossing a page boundary.
        words: list[tuple[str, int]] = []
        for value, page in fragments:
            fragment_words = clean_text(value).split()
            if words and words[-1][0].endswith("-") and fragment_words:
                previous, previous_page = words.pop()
                words.append((previous[:-1] + fragment_words.pop(0), previous_page))
            words.extend((word, page) for word in fragment_words)
        for start in range(0, len(words), 148):
            part = words[start : start + 180]
            if len(part) < 8:
                continue
            content = " ".join(w for w, _ in part)
            page_start, page_end = part[0][1], part[-1][1]
            identifier = hashlib.sha256(
                f"{EDITION}|{heading}|{page_start}|{start}|{content}".encode()
            ).hexdigest()[:16]
            chunks.append(
                Chunk(
                    id=identifier,
                    title=heading,
                    category=category,
                    text=content,
                    page_start=page_start,
                    page_end=page_end,
                    source_url=f"{SOURCE_URL}#page={page_start}",
                )
            )
            if start + 180 >= len(words):
                break
        fragments.clear()

    with pdfplumber.open(settings.source_path) as document:
        for page_number, page in enumerate(document.pages, start=1):
            if page_number < 5:
                continue  # Legal information and table of contents aren't rule evidence.
            midpoint = page.width / 2
            for left, right in [(0, midpoint), (midpoint, page.width)]:
                lines = layout_lines(page.chars, page.height, left, right)
                # Chapter titles may wrap across two large-type lines.
                merged_lines: list[dict] = []
                for line in lines:
                    large = line["chars"] and min(c["size"] for c in line["chars"]) >= 24
                    previous_large = (
                        merged_lines
                        and merged_lines[-1]["chars"]
                        and min(c["size"] for c in merged_lines[-1]["chars"]) >= 24
                    )
                    if large and previous_large:
                        merged_lines[-1]["text"] += " " + line["text"]
                        merged_lines[-1]["chars"].extend(line["chars"])
                    else:
                        merged_lines.append(line)
                body: list[str] = []
                for line in merged_lines:
                    chars = [c for c in line["chars"] if c["text"].strip()]
                    is_heading = (
                        bool(chars)
                        and sum(c["size"] >= 11.7 and "GillSans" in c["fontname"] for c in chars)
                        / len(chars)
                        > 0.8
                    )
                    text = line["text"]
                    if is_heading:
                        if body:
                            fragments.append(("\n".join(body), page_number))
                            body.clear()
                        flush()
                        heading = clean_text(text)
                        if heading in chapter_names:
                            category = heading
                    else:
                        body.append(text)
                if body:
                    fragments.append(("\n".join(body), page_number))
            page.close()
            if page_number % 50 == 0:
                print(f"Extracted {page_number}/{len(document.pages)} pages", flush=True)
        flush()
    return chunks


def build_index(settings: Settings, *, embed: bool = True) -> dict:
    digest = download_source(settings)
    directory = settings.index_dir
    directory.mkdir(parents=True, exist_ok=True)
    chunks = extract_chunks(settings)
    if len(chunks) < 500:
        raise ValueError("Unexpectedly small corpus; inspect extraction before indexing.")
    encoded = "\n".join(c.model_dump_json() for c in chunks) + "\n"
    corpus_hash = hashlib.sha256(encoded.encode()).hexdigest()
    (directory / "chunks.jsonl").write_bytes(encoded.encode("utf-8"))
    if embed:
        print(f"Embedding {len(chunks)} passages with {EMBEDDING_MODEL}", flush=True)
        model = TextEmbedding(
            EMBEDDING_MODEL, cache_dir=str(settings.model_cache), threads=settings.model_threads
        )
        vectors = np.array(
            list(model.embed([f"{c.title}. {c.text}" for c in chunks], batch_size=32)),
            dtype=np.float32,
        )
        vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
        np.save(directory / "embeddings.npy", vectors)
    else:
        # An old matrix must never be silently paired with a new corpus.
        (directory / "embeddings.npy").unlink(missing_ok=True)
    manifest = {
        "edition": EDITION,
        "source_url": SOURCE_URL,
        "source_sha256": digest,
        "corpus_sha256": corpus_hash,
        "chunk_count": len(chunks),
        "page_count": 364,
        "embedding_model": EMBEDDING_MODEL if embed else None,
        "embedding_dimensions": 384 if embed else None,
        "built_at": datetime.now(UTC).isoformat(),
        "categories": sorted({c.category for c in chunks}),
        "extraction": "two columns; typography headings; 180 words with 32-word overlap",
    }
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
