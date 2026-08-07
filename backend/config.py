"""Centralized environment configuration for TextMosaic.

This module is the only place the current backend reads configuration from the
environment. It also loads an optional repository-root .env file with the
standard library so a local override works without adding a configuration
dependency.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Final

_PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parent.parent
_ENV_KEY_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _load_dotenv(path: Path) -> None:
    """Load simple KEY=VALUE entries without overwriting process environment values."""
    if not path.is_file():
        return

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        if "=" not in line:
            raise ValueError(f"Invalid .env entry on line {line_number}: expected KEY=VALUE.")

        key, value = line.split("=", maxsplit=1)
        key = key.strip()
        value = value.strip()
        if not _ENV_KEY_PATTERN.fullmatch(key):
            raise ValueError(f"Invalid .env variable name on line {line_number}: {key!r}.")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_dotenv(_PROJECT_ROOT / ".env")

TEXTMOSAIC_DATA_DIR: Final[str] = os.getenv("TEXTMOSAIC_DATA_DIR", "./data")
ALLOWED_ORIGINS: Final[str] = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
ALLOWED_HOSTS: Final[str] = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver")
MODEL_TIER_DEFAULT: Final[str] = os.getenv("MODEL_TIER_DEFAULT", "balanced")

try:
    PORT: Final[int] = int(os.getenv("PORT", "7860"))
except ValueError as error:
    raise ValueError("PORT must be an integer.") from error

try:
    MAX_REQUEST_BODY_BYTES: Final[int] = int(os.getenv("MAX_REQUEST_BODY_BYTES", "16384"))
except ValueError as error:
    raise ValueError("MAX_REQUEST_BODY_BYTES must be an integer.") from error

if MAX_REQUEST_BODY_BYTES <= 0:
    raise ValueError("MAX_REQUEST_BODY_BYTES must be greater than zero.")
