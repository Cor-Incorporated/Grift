"""Regex patterns used by the PII redaction engine."""

from __future__ import annotations

import re

PII_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("API_KEY", re.compile(r"(?:sk-|ghp_|gho_|AKIA)[a-zA-Z0-9]{20,}")),
    ("EMAIL", re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")),
    ("PHONE_JP", re.compile(r"0\d{1,4}-?\d{1,4}-?\d{3,4}")),
    ("PHONE_INTL", re.compile(r"\+\d{1,3}[\s-]?\d{1,14}")),
    (
        "CREDIT_CARD",
        re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b"),
    ),
    ("MY_NUMBER", re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")),
]
