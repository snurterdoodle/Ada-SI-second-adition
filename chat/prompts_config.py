"""Loadable prompt configuration for Scout agent, Forge master, and tool schemas."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict

# --- Scout agent defaults ---

_DEFAULT_SCOUT_ORCHESTRATOR_PREFIX = """You are Ada-SI, a self-improving agent that extends itself by creating Python tools.

Routing rules (follow strictly):
1. If the user needs live or external data you cannot access directly — weather, stock prices, news, web lookups, account/system state, file I/O, scheduled jobs, or any API — call generate_new_tool. Do NOT reply with "I can't" or ask clarifying questions instead of calling the tool; put requirements (APIs, inputs, outputs) in the tool description.
2. If the user wants a persistent app-like capability (calendar, todos, notes, tracker, journal) that they can also open as a popup mini-app, call generate_new_tool and describe it as an INTERACTIVE skill with the desired UI (calendar, list, or table template).
3. If an installed tool matches the request, call that tool first. Pass whatever arguments you have; the tool may return follow-up questions.
4. If the user asks to see, view, open, or show an installed interactive skill app, call open_skill_app with the skill name.
5. If the user asks to fix, change, or improve an existing installed tool, call edit_existing_tool with the tool name and a detailed description of the changes.
6. Reply in plain text only for general conversation, explanations, or static knowledge that needs no live data and no custom code.
7. Do not create tools for microphone, camera, speakers, voice/TTS, screen capture, or other local hardware access. Politely explain these capabilities are not supported.
"""

_DEFAULT_SCOUT_ORCHESTRATOR_SUFFIX = """

When calling generate_new_tool or edit_existing_tool, use snake_case tool_name and a detailed description the tool creator can implement without further user input when possible."""

_DEFAULT_SCOUT_ADDITIONAL_DIRECTIVES = ""

# --- Forge shared appendix defaults ---

_DEFAULT_FORGE_RUNTIME_CONTEXT = """Runtime context (always true):
- Forged Python tools execute in a headless Docker container (python:3.12-slim tool-runtime).
- Tools cannot access local user hardware, desktop UI, or physical devices.
- Do not use libraries that require microphones, speakers, cameras, or other local hardware."""

# --- Forge phase prompt defaults ---

_DEFAULT_FORGE_PLAN_PROMPT = """You are an expert Python tool architect for a self-improving AI agent.

The user needs a new callable tool. Produce a clear implementation plan in markdown with these sections:
## Skill Kind and UI
Decide headless vs interactive. For interactive skills (calendar, todos, notes, trackers), pick a UI template: calendar, list, or table. Define the record schema (fields, types) and operations (list, create, delete, etc.).
## Architecture Changes
## Function Schema
Use a single tool with an `action` enum parameter for interactive skills (e.g. list_events, create_event, delete_event).
## Execution Steps
Interactive skills persist data to Path(__file__).parent / "skill_data" / "{tool_name}.json" as {"records": [...]}.
## Risks and Limitations

Be specific about inputs, outputs, and edge cases. Do not write full Python code yet."""

_DEFAULT_FORGE_REVISE_PLAN_PROMPT = """You are an expert Python tool architect for a self-improving AI agent.

The user rejected a proposed tool plan and requested revisions. Produce an updated implementation plan in markdown with these sections:
## Architecture Changes
## Function Schema
## Execution Steps
## Risks and Limitations

Incorporate the user's requested changes while keeping the plan focused and implementable. Do not write full Python code yet."""

_DEFAULT_FORGE_EDIT_PLAN_PROMPT = """You are an expert Python tool architect for a self-improving AI agent.

The user wants to modify an EXISTING installed tool. Produce an updated implementation plan in markdown with these sections:
## Architecture Changes
## Function Schema
## Execution Steps
## Risks and Limitations

Reference the current tool behavior and describe only what must change. Do not write full Python code yet."""

_DEFAULT_FORGE_CODE_PROMPT = """You are an expert Python developer building tools for a self-improving AI agent.

Each tool module MUST define exactly:
1. get_tool_schema() -> dict  (OpenAI-compatible function schema)
2. run(**kwargs) -> str or JSON-serializable value

Respond with ONLY valid JSON (no markdown fences) in this shape:
{
  "tool_code": "<full Python module source>",
  "test_code": "<test_run.py that imports /workspace/{tool_name}.py and asserts run() works>",
  "requirements": ["optional-pip-package>=1.0"],
  "manifest": null
}

For INTERACTIVE skills, set manifest to:
{
  "kind": "interactive",
  "display_name": "Human Name",
  "icon": "calendar",
  "ui": {
    "template": "calendar",
    "title_field": "title",
    "date_field": "start",
    "fields": [{"key": "title", "label": "Title", "type": "string"}]
  },
  "operations": ["list_events", "create_event", "delete_event"]
}
UI templates: calendar (scheduling), list (todos/notes), table (generic CRUD).
For headless-only tools, set "manifest": null or {"kind": "headless"}.

Interactive tool rules:
- Persist data to Path(__file__).parent / "skill_data" / "{tool_name}.json"
- Store shape: {"records": [{"id": "...", ...fields...}]}
- Use run(action=...) with action enum matching manifest.operations
- Create skill_data directory if missing

Rules:
- requirements: list every PyPI package the tool needs at runtime (e.g. httpx). Use [] for stdlib-only tools.
- Do NOT include pip, setuptools, or wheel in requirements.
- tool_name must match the module filename stem
- test_code runs inside python:3.12-slim with the tool mounted at /workspace/{tool_name}.py
- Sandbox layout: tool code at /workspace/{tool_name}.py is read-only; /workspace/skill_data/ is writable and pre-seeded with {{"records": []}} for interactive skills
- Interactive skill tests: call real run() CRUD actions — no filesystem mocks needed for skill_data persistence
- test_run.py must exit 0 on success
- No network, subprocess calls, or writes outside /workspace during tests (skill_data writes inside /workspace are allowed)
- Keep tools minimal and focused
- In tool_code Python source use Python literals True, False, and None — never JSON true, false, or null
- JSON string values MUST be valid JSON: escape every double quote inside code as \\", newlines as \\n, backslashes as \\\\
- ALL file paths in run() return values MUST use the /workspace/ prefix (never /app/custom_tools/)
- test_code MUST use this exact load pattern and mock external calls:

import importlib.util

def load_tool():
    spec = importlib.util.spec_from_file_location(
        "tool_mod", "/workspace/{tool_name}.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

# Use unittest.mock.patch on network/subprocess before calling mod.run().
# Interactive skills: test real persistence under /workspace/skill_data/ (writable, pre-seeded).
# Headless skills: mock network/subprocess. Sandbox has NO network access.

# Interactive skill test template:
# mod = load_tool()
# mod.run(action="create_...", ...)
# state = mod.run(action="list_...")
# assert records created/deleted as expected"""

_DEFAULT_FORGE_EDIT_CODE_PROMPT = """You are an expert Python developer updating an existing tool for a self-improving AI agent.

Each tool module MUST define exactly:
1. get_tool_schema() -> dict  (OpenAI-compatible function schema)
2. run(**kwargs) -> str or JSON-serializable value

Respond with ONLY valid JSON (no markdown fences) in this shape:
{
  "tool_code": "<full updated Python module source>",
  "test_code": "<updated test_run.py>",
  "requirements": ["optional-pip-package>=1.0"],
  "manifest": null
}

Include manifest when the skill is interactive (see forge code prompt for manifest shape).

Rules:
- Preserve tool_name as the module filename stem
- In tool_code Python source use Python literals True, False, and None — never JSON true, false, or null
- requirements: full list of PyPI packages needed after your edit (not just new ones)
- test_code runs in sandbox at /workspace/{tool_name}.py; /workspace/skill_data/ is writable for interactive skills
- Mock network/subprocess in test_code for headless tools; interactive skills test real skill_data CRUD
- ALL file paths in run() return values MUST use /workspace/ prefix
- JSON string values MUST be valid JSON with escaped quotes and newlines"""

_DEFAULT_FORGE_FIX_TEST_PROMPT = """You are an expert Python test engineer fixing sandbox test failures.

The tool module (tool_code) is correct — only fix test_code so it passes in an isolated
python:3.12-slim container with NO network, the tool mounted read-only at /workspace/{tool_name}.py,
and /workspace/skill_data/ writable with pre-seeded {{"records": []}} for interactive skills.

Respond with ONLY valid JSON (no markdown fences):
{{ "test_code": "<fixed test_run.py source>" }}

Rules:
- Use importlib.util.spec_from_file_location to load the tool from /workspace/{tool_name}.py
- Mock network and subprocess calls with unittest.mock.patch
- Interactive skills: do NOT mock skill_data persistence — test real run() CRUD against /workspace/skill_data/
- Headless skills: mock external I/O as needed
- Assert paths using /workspace/ prefix when checking run() return values
- test_run.py must exit 0 when run as: python /workspace/test_run.py"""

_DEFAULT_FORGE_REVISE_PREVIEW_PROMPT = """You revise an interactive skill preview based on user UI feedback.

The user tested the popup mini-app (calendar, list, or table template) and requested changes.
Fix tool_code, test_code, and manifest so the UI and run(action=...) behavior match.

Respond with ONLY valid JSON (no markdown fences):
{{ "tool_code": "...", "test_code": "...", "manifest": {{ ... }} }}

Rules:
- Preserve tool_name as the module filename stem
- manifest.kind must remain "interactive"
- Align manifest.ui.fields, title_field, date_field, done_field with record shape in tool_code
- manifest.operations must match run(action=...) enum values
- Persist to Path(__file__).parent / "skill_data" / "{tool_name}.json"
- test_code loads from /workspace/{tool_name}.py; interactive tests use real /workspace/skill_data/ CRUD
- In tool_code use Python True, False, None — never JSON true/false/null
- ALL file paths in run() return values use /workspace/ prefix"""

_DEFAULT_FORGE_FIX_CODEGEN_PROMPT = """You repair malformed tool-creator JSON responses.

Return ONLY valid JSON (no markdown fences):
{{ "tool_code": "...", "test_code": "...", "requirements": [], "manifest": null }}

Rules:
- tool_code must define get_tool_schema() and run()
- get_tool_schema() must use Python True, False, and None — never JSON true, false, or null
- test_code loads tool from /workspace/{tool_name}.py via importlib
- requirements is a list of PyPI package strings (or [])
- ALL file paths in run() returns use /workspace/ prefix
- Escape quotes and newlines properly inside JSON strings"""

_DEFAULT_FORGE_FIX_VALIDATION_PROMPT = """You fix Python tool modules that failed static validation.

Return ONLY valid JSON (no markdown fences):
{{ "tool_code": "...", "test_code": "..." }}

Rules:
- tool_code MUST define get_tool_schema() and run()
- get_tool_schema() must use Python True, False, and None — never JSON true, false, or null
- test_code MUST load via importlib from /workspace/{tool_name}.py and include tests/mocks
- ALL file paths in run() return values use /workspace/ prefix
- Fix only what validation requires; keep behavior from the plan"""

_DEFAULT_FORGE_FIX_RUNTIME_PROMPT = """You fix tool_code and/or test_code failures in the persistent tool runtime.

Tests run with cwd=/app/custom_tools and /workspace symlinked to the same directory.
Load tools via importlib from /workspace/{tool_name}.py.

Respond with ONLY valid JSON (no markdown fences):
{{ "tool_code": "...", "test_code": "..." }}

Rules:
- Fix path mismatches: use /workspace/ in run() return values AND test assertions
- Mock network/subprocess in test_code; runtime has network but tests must not call live APIs
- tool_code must keep get_tool_schema() and run()"""

# --- Tool schema descriptions ---

_DEFAULT_TOOL_GENERATE_NEW_DESCRIPTION = (
    "Request creation of a new Python tool when the user needs a capability you do "
    "not have installed: live/real-time data (weather, markets, news), external APIs, "
    "web fetching, persistence, filesystem access, or custom automation. "
    "Call this instead of asking the user for details you could specify in description. "
    "Do not use for pure chat, static facts answerable without tools or APIs, "
    "or requests involving microphone, camera, speakers, or other local hardware."
)

_DEFAULT_TOOL_EDIT_EXISTING_DESCRIPTION = (
    "Modify an installed tool when the user wants to fix bugs, change behavior, "
    "add inputs/outputs, or update dependencies. Use when a tool exists but needs "
    "changes — not for creating a brand-new capability under a new name."
)

PROMPT_KEYS = (
    "scout_orchestrator_prefix",
    "scout_orchestrator_suffix",
    "scout_additional_directives",
    "forge_runtime_context",
    "forge_plan_prompt",
    "forge_revise_plan_prompt",
    "forge_edit_plan_prompt",
    "forge_code_prompt",
    "forge_edit_code_prompt",
    "forge_fix_test_prompt",
    "forge_fix_codegen_prompt",
    "forge_fix_validation_prompt",
    "forge_fix_runtime_prompt",
    "forge_revise_preview_prompt",
    "tool_generate_new_description",
    "tool_edit_existing_description",
)

CONFIG_DIR = Path(__file__).parent / "staging"
CONFIG_PATH = CONFIG_DIR / "prompts_config.json"
LEGACY_GUIDANCE_PATH = CONFIG_DIR / "forger_guidance.json"


class PromptsConfig(TypedDict):
    scout_orchestrator_prefix: str
    scout_orchestrator_suffix: str
    scout_additional_directives: str
    forge_runtime_context: str
    forge_plan_prompt: str
    forge_revise_plan_prompt: str
    forge_edit_plan_prompt: str
    forge_code_prompt: str
    forge_edit_code_prompt: str
    forge_fix_test_prompt: str
    forge_fix_codegen_prompt: str
    forge_fix_validation_prompt: str
    forge_fix_runtime_prompt: str
    forge_revise_preview_prompt: str
    tool_generate_new_description: str
    tool_edit_existing_description: str


class EffectivePrompts(TypedDict):
    scout_orchestrator: str
    forge_plan: str
    forge_revise_plan: str
    forge_edit_plan: str
    forge_code: str
    forge_edit_code: str
    forge_fix_test: str
    forge_fix_codegen: str
    forge_fix_validation: str
    forge_fix_runtime: str


_cache: PromptsConfig | None = None

_LEGACY_KEY_MAP = {
    "forger_runtime_context": "forge_runtime_context",
}


def default_prompts_config() -> PromptsConfig:
    return {
        "scout_orchestrator_prefix": _DEFAULT_SCOUT_ORCHESTRATOR_PREFIX,
        "scout_orchestrator_suffix": _DEFAULT_SCOUT_ORCHESTRATOR_SUFFIX,
        "scout_additional_directives": _DEFAULT_SCOUT_ADDITIONAL_DIRECTIVES,
        "forge_runtime_context": _DEFAULT_FORGE_RUNTIME_CONTEXT,
        "forge_plan_prompt": _DEFAULT_FORGE_PLAN_PROMPT,
        "forge_revise_plan_prompt": _DEFAULT_FORGE_REVISE_PLAN_PROMPT,
        "forge_edit_plan_prompt": _DEFAULT_FORGE_EDIT_PLAN_PROMPT,
        "forge_code_prompt": _DEFAULT_FORGE_CODE_PROMPT,
        "forge_edit_code_prompt": _DEFAULT_FORGE_EDIT_CODE_PROMPT,
        "forge_fix_test_prompt": _DEFAULT_FORGE_FIX_TEST_PROMPT,
        "forge_fix_codegen_prompt": _DEFAULT_FORGE_FIX_CODEGEN_PROMPT,
        "forge_fix_validation_prompt": _DEFAULT_FORGE_FIX_VALIDATION_PROMPT,
        "forge_fix_runtime_prompt": _DEFAULT_FORGE_FIX_RUNTIME_PROMPT,
        "forge_revise_preview_prompt": _DEFAULT_FORGE_REVISE_PREVIEW_PROMPT,
        "tool_generate_new_description": _DEFAULT_TOOL_GENERATE_NEW_DESCRIPTION,
        "tool_edit_existing_description": _DEFAULT_TOOL_EDIT_EXISTING_DESCRIPTION,
    }


def _normalize_config(data: dict) -> PromptsConfig:
    defaults = default_prompts_config()
    normalized = dict(defaults)
    for key in PROMPT_KEYS:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            normalized[key] = value.strip()
    return normalized  # type: ignore[return-value]


def _load_legacy_guidance() -> dict | None:
    if not LEGACY_GUIDANCE_PATH.exists():
        return None
    try:
        raw = json.loads(LEGACY_GUIDANCE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    migrated: dict[str, str] = {}
    for legacy_key, new_key in _LEGACY_KEY_MAP.items():
        value = raw.get(legacy_key)
        if isinstance(value, str) and value.strip():
            migrated[new_key] = value.strip()
    return migrated or None


def load_prompts_config(*, refresh: bool = False) -> PromptsConfig:
    global _cache
    if _cache is not None and not refresh:
        return _cache

    if CONFIG_PATH.exists():
        try:
            raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                _cache = _normalize_config(raw)
                return _cache
        except (OSError, json.JSONDecodeError):
            pass

    legacy = _load_legacy_guidance()
    if legacy:
        _cache = _normalize_config(legacy)
        save_prompts_config(_cache)
        return _cache

    _cache = default_prompts_config()
    return _cache


def save_prompts_config(data: dict) -> PromptsConfig:
    global _cache
    merged = _normalize_config(data)
    CONFIG_DIR.mkdir(exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(merged, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    _cache = merged
    return merged


def get_forge_appendix() -> str:
    return load_prompts_config()["forge_runtime_context"].strip()


def _with_forge_appendix(base: str) -> str:
    appendix = get_forge_appendix()
    base = base.strip()
    if not appendix:
        return base
    if not base:
        return appendix
    return f"{base}\n\n{appendix}"


def get_scout_orchestrator_prompt(*, extra_directives: str | None = None) -> str:
    config = load_prompts_config()
    parts = [
        config["scout_orchestrator_prefix"].strip(),
        config["scout_orchestrator_suffix"].strip(),
    ]
    system = "".join(part for part in parts if part)

    directives = (extra_directives if extra_directives is not None else config["scout_additional_directives"]).strip()
    if directives:
        system += f"\n\nAdditional user instructions:\n{directives}"
    return system


def get_forge_plan_prompt() -> str:
    return _with_forge_appendix(load_prompts_config()["forge_plan_prompt"])


def get_forge_revise_plan_prompt() -> str:
    return _with_forge_appendix(load_prompts_config()["forge_revise_plan_prompt"])


def get_forge_edit_plan_prompt() -> str:
    return _with_forge_appendix(load_prompts_config()["forge_edit_plan_prompt"])


def get_forge_code_prompt() -> str:
    return _with_forge_appendix(load_prompts_config()["forge_code_prompt"])


def get_forge_edit_code_prompt() -> str:
    return _with_forge_appendix(load_prompts_config()["forge_edit_code_prompt"])


def get_forge_fix_test_prompt() -> str:
    return load_prompts_config()["forge_fix_test_prompt"]


def get_forge_fix_codegen_prompt() -> str:
    return load_prompts_config()["forge_fix_codegen_prompt"]


def get_forge_fix_validation_prompt() -> str:
    return load_prompts_config()["forge_fix_validation_prompt"]


def get_forge_fix_runtime_prompt() -> str:
    return load_prompts_config()["forge_fix_runtime_prompt"]


def get_forge_revise_preview_prompt() -> str:
    return _with_forge_appendix(load_prompts_config()["forge_revise_preview_prompt"])


def get_tool_generate_new_description() -> str:
    return load_prompts_config()["tool_generate_new_description"]


def get_tool_edit_existing_description() -> str:
    return load_prompts_config()["tool_edit_existing_description"]


def build_effective_prompts() -> EffectivePrompts:
    config = load_prompts_config()
    return {
        "scout_orchestrator": get_scout_orchestrator_prompt(),
        "forge_plan": get_forge_plan_prompt(),
        "forge_revise_plan": get_forge_revise_plan_prompt(),
        "forge_edit_plan": get_forge_edit_plan_prompt(),
        "forge_code": get_forge_code_prompt(),
        "forge_edit_code": get_forge_edit_code_prompt(),
        "forge_fix_test": config["forge_fix_test_prompt"],
        "forge_fix_codegen": config["forge_fix_codegen_prompt"],
        "forge_fix_validation": config["forge_fix_validation_prompt"],
        "forge_fix_runtime": config["forge_fix_runtime_prompt"],
    }


def prompts_config_response() -> dict:
    return {
        "prompts": load_prompts_config(),
        "effective": build_effective_prompts(),
    }
