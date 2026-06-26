"""Loadable secrets for API keys stored outside git."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import TypedDict

CONFIG_DIR = Path(__file__).parent / "staging"
SECRETS_PATH = CONFIG_DIR / "secrets.json"

SUPPORTED_SECRET_KEYS = frozenset(
    {
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
        "ELEVENLABS_API_KEY",
    }
)

# Keys already in the process environment at import time (e.g. from .env via start.ps1).
_STARTUP_ENV_KEYS: frozenset[str] = frozenset(
    name for name in SUPPORTED_SECRET_KEYS if os.environ.get(name, "").strip()
)


class SecretStatus(TypedDict):
    configured: bool
    hint: str
    source: str


def _ensure_config_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def _mask_value(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return ""
    if len(trimmed) <= 4:
        return "••••"
    return f"••••••{trimmed[-4:]}"


def load_secrets_raw() -> dict[str, str]:
    if not SECRETS_PATH.exists():
        return {}
    try:
        data = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    keys = data.get("keys", data)
    if not isinstance(keys, dict):
        return {}
    return {
        str(name): str(value).strip()
        for name, value in keys.items()
        if name in SUPPORTED_SECRET_KEYS and str(value).strip()
    }


def save_secrets_raw(updates: dict[str, str]) -> dict[str, str]:
    current = load_secrets_raw()
    for name, value in updates.items():
        if name not in SUPPORTED_SECRET_KEYS:
            raise ValueError(f"Unsupported secret key: {name}")
        if not value.strip():
            current.pop(name, None)
        else:
            current[name] = value.strip()
    _ensure_config_dir()
    payload = {"keys": current}
    SECRETS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(SECRETS_PATH, 0o600)
    except OSError:
        pass
    return dict(current)


def clear_secret(name: str) -> dict[str, str]:
    return save_secrets_raw({name: ""})


def get_effective_secret(name: str) -> str:
    """Return env value if set, otherwise value from secrets file."""
    env_value = os.environ.get(name, "").strip()
    if env_value:
        return env_value
    return load_secrets_raw().get(name, "").strip()


def apply_secrets_to_environ() -> None:
    """Sync UI-managed secrets with os.environ.

    Keys that were present in the environment at process start (.env) are never
  unset by the UI. Keys saved only via Settings are removed from os.environ when
  cleared from secrets.json.
    """
    stored = load_secrets_raw()
    for name in SUPPORTED_SECRET_KEYS:
        if name in _STARTUP_ENV_KEYS:
            if not os.environ.get(name, "").strip() and name in stored:
                os.environ[name] = stored[name]
            continue
        if name in stored:
            os.environ[name] = stored[name]
        else:
            os.environ.pop(name, None)


def secrets_status_response() -> dict[str, SecretStatus]:
    stored = load_secrets_raw()
    result: dict[str, SecretStatus] = {}
    for name in sorted(SUPPORTED_SECRET_KEYS):
        env_value = os.environ.get(name, "").strip()
        file_value = stored.get(name, "")
        effective = env_value or file_value
        from_env = bool(env_value)
        from_file = bool(file_value)
        result[name] = {
            "configured": bool(effective),
            "hint": _mask_value(effective) if effective else "",
            "source": "env" if from_env else ("file" if from_file else ""),
        }
    return result
