from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any


logger = logging.getLogger("quantsage.library")
LIBRARY_DIR = Path(__file__).parent / "library"

LENS_TAGS = {
    "smc": {"smc", "order-block", "fvg", "bos", "choch", "liquidity", "structure"},
    "gs": {"institutional", "liquidity", "structure"},
    "psych": {"skepticism", "limitations"},
    "ppa": {"price-action", "structure", "entry", "target"},
}
TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(value: str) -> set[str]:
    return {token for token in TOKEN_RE.findall(value.lower()) if len(token) >= 3}


def _validate_document(document: Any) -> dict[str, Any] | None:
    if not isinstance(document, dict):
        raise ValueError("document must be an object")
    for field in ("sourceId", "title", "kind", "attribution"):
        if not isinstance(document.get(field), str) or not document[field].strip():
            raise ValueError(f"{field} must be a non-empty string")
    entries = document.get("entries")
    if not isinstance(entries, list):
        raise ValueError("entries must be an array")
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("every entry must be an object")
        for field in ("id", "section", "principle", "application"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"entry {field} must be a non-empty string")
        tags = entry.get("tags")
        if not isinstance(tags, list) or any(not isinstance(tag, str) or not tag.strip() for tag in tags):
            raise ValueError("entry tags must be a non-empty string array")
    return document


def _load_library() -> tuple[dict[str, Any], ...]:
    documents: list[dict[str, Any]] = []
    try:
        paths = sorted(LIBRARY_DIR.glob("*.json"))
    except OSError as error:
        logger.warning("Unable to list local knowledge library %s: %s", LIBRARY_DIR, error)
        return ()
    for path in paths:
        try:
            document = _validate_document(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError, TypeError) as error:
            logger.warning("Skipping local knowledge library %s: %s", path, error)
            continue
        if document is not None:
            documents.append(document)
    return tuple(documents)


_DOCUMENTS = _load_library()


def _searchable_text(entry: dict[str, Any]) -> str:
    return " ".join(
        [
            *entry["tags"],
            entry["section"],
            entry["principle"],
            entry["application"],
        ]
    )


def _document_frequencies(
    documents: tuple[dict[str, Any], ...],
) -> tuple[dict[str, int], int]:
    frequencies: dict[str, int] = {}
    total_entries = 0
    for document in documents:
        for entry in document["entries"]:
            total_entries += 1
            for token in _tokens(_searchable_text(entry)):
                frequencies[token] = frequencies.get(token, 0) + 1
    return frequencies, total_entries


_DOCUMENT_FREQUENCIES, _TOTAL_ENTRIES = _document_frequencies(_DOCUMENTS)


def search_library(prompt: str, lenses: list[str], limit: int = 4) -> list[dict[str, Any]]:
    if limit <= 0:
        return []
    prompt_tokens = _tokens(prompt or "")
    lens_tags = {
        tag
        for lens in lenses or []
        for tag in LENS_TAGS.get(str(lens).lower(), set())
    }
    scored: list[tuple[int, str, dict[str, Any]]] = []
    for document in _DOCUMENTS:
        for entry in document["entries"]:
            tags = {tag.strip().lower() for tag in entry["tags"]}
            tag_matches = len(tags & lens_tags)
            searchable_tokens = _tokens(_searchable_text(entry))
            prompt_matches = sum(
                1
                for token in prompt_tokens & searchable_tokens
                if _TOTAL_ENTRIES == 1
                or _DOCUMENT_FREQUENCIES.get(token, 0) * 2 <= _TOTAL_ENTRIES
            )
            score = (tag_matches * 5) + prompt_matches
            if tag_matches <= 0 or prompt_matches <= 0 or score <= 0:
                continue
            scored.append(
                (
                    score,
                    entry["id"],
                    {
                        "sourceId": document["sourceId"],
                        "title": document["title"],
                        "kind": document["kind"],
                        "attribution": document["attribution"],
                        "id": entry["id"],
                        "section": entry["section"],
                        "tags": entry["tags"],
                        "principle": entry["principle"],
                        "application": entry["application"],
                    },
                )
            )
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [entry for _, _, entry in scored[:limit]]
