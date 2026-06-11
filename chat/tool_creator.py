import ast
import json
import re
from collections.abc import AsyncIterator

import httpx

from litellm_client import build_completion_payload, stream_completion_deltas
from debug_log import log_block, log_debug, log_generated_code, log_plan, log_stream_delta

PLAN_SYSTEM_PROMPT = """You are an expert Python tool architect for a self-improving AI agent.

The user needs a new callable tool. Produce a clear implementation plan in markdown with these sections:
## Architecture Changes
## Function Schema
## Execution Steps
## Risks and Limitations

Be specific about inputs, outputs, and edge cases. Do not write full Python code yet."""

REVISE_PLAN_SYSTEM_PROMPT = """You are an expert Python tool architect for a self-improving AI agent.

The user rejected a proposed tool plan and requested revisions. Produce an updated implementation plan in markdown with these sections:
## Architecture Changes
## Function Schema
## Execution Steps
## Risks and Limitations

Incorporate the user's requested changes while keeping the plan focused and implementable. Do not write full Python code yet."""

CODE_SYSTEM_PROMPT = """You are an expert Python developer building tools for a self-improving AI agent.

Each tool module MUST define exactly:
1. get_tool_schema() -> dict  (OpenAI-compatible function schema)
2. run(**kwargs) -> str or JSON-serializable value

Respond with ONLY valid JSON (no markdown fences) in this shape:
{
  "tool_code": "<full Python module source>",
  "test_code": "<test_run.py that imports /workspace/{tool_name}.py and asserts run() works>",
  "requirements": ["optional-pip-package>=1.0"]
}

Rules:
- requirements: list every PyPI package the tool needs at runtime (e.g. httpx, gTTS). Use [] if only stdlib.
- Do NOT include pip, setuptools, or wheel in requirements.
- tool_name must match the module filename stem
- test_code runs inside python:3.12-slim with the tool mounted at /workspace/{tool_name}.py
- test_run.py must exit 0 on success
- No network, filesystem outside /workspace, or subprocess calls in generated tools during tests
- Keep tools minimal and focused
- JSON string values MUST be valid JSON: escape every double quote inside code as \\", newlines as \\n, backslashes as \\\\
- test_code MUST use this exact load pattern and mock external calls:

import importlib.util

def load_tool():
    spec = importlib.util.spec_from_file_location(
        "tool_mod", "/workspace/{tool_name}.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

# Use unittest.mock.patch on network/filesystem/subprocess before calling mod.run().
# Sandbox has NO network access — never call mod.run() against real URLs without mocks."""

EDIT_PLAN_SYSTEM_PROMPT = """You are an expert Python tool architect for a self-improving AI agent.

The user wants to modify an EXISTING installed tool. Produce an updated implementation plan in markdown with these sections:
## Architecture Changes
## Function Schema
## Execution Steps
## Risks and Limitations

Reference the current tool behavior and describe only what must change. Do not write full Python code yet."""

EDIT_CODE_SYSTEM_PROMPT = """You are an expert Python developer updating an existing tool for a self-improving AI agent.

Each tool module MUST define exactly:
1. get_tool_schema() -> dict  (OpenAI-compatible function schema)
2. run(**kwargs) -> str or JSON-serializable value

Respond with ONLY valid JSON (no markdown fences) in this shape:
{
  "tool_code": "<full updated Python module source>",
  "test_code": "<updated test_run.py>",
  "requirements": ["optional-pip-package>=1.0"]
}

Rules:
- Preserve tool_name as the module filename stem
- requirements: full list of PyPI packages needed after your edit (not just new ones)
- test_code runs in sandbox at /workspace/{tool_name}.py with mocks for network/filesystem
- JSON string values MUST be valid JSON with escaped quotes and newlines"""

FIX_TEST_SYSTEM_PROMPT = """You are an expert Python test engineer fixing sandbox test failures.

The tool module (tool_code) is correct — only fix test_code so it passes in an isolated
python:3.12-slim container with NO network, NO filesystem outside /workspace, and the tool
mounted at /workspace/{tool_name}.py.

Respond with ONLY valid JSON (no markdown fences):
{{ "test_code": "<fixed test_run.py source>" }}

Rules:
- Use importlib.util.spec_from_file_location to load the tool from /workspace/{tool_name}.py
- Mock ALL network, filesystem, and subprocess calls with unittest.mock.patch
- test_run.py must exit 0 when run as: python /workspace/test_run.py"""


async def _litellm_chat(
    litellm_url: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict],
    *,
    temperature: float = 0.2,
) -> str:
    payload = build_completion_payload(
        model, messages, stream=False, temperature=temperature
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{litellm_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"LiteLLM error ({response.status_code}): {response.text}"
            )
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _litellm_stream(
    litellm_url: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict],
    *,
    temperature: float = 0.2,
) -> AsyncIterator[tuple[str, str]]:
    """Yield (kind, text) where kind is 'content' or 'reasoning'."""
    async for kind, text in stream_completion_deltas(
        litellm_url, headers, model, messages, temperature=temperature
    ):
        yield kind, text


def _strip_markdown_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _decode_json_string_body(raw: str) -> str:
    """Decode a JSON string body (without surrounding quotes)."""
    out: list[str] = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        if i + 1 >= len(raw):
            break
        nxt = raw[i + 1]
        if nxt == "n":
            out.append("\n")
        elif nxt == "t":
            out.append("\t")
        elif nxt == "r":
            out.append("\r")
        elif nxt in {'"', "\\", "/"}:
            out.append(nxt)
        elif nxt == "u" and i + 5 < len(raw):
            out.append(chr(int(raw[i + 2 : i + 6], 16)))
            i += 6
            continue
        else:
            out.append(nxt)
        i += 2
    return "".join(out)


def _extract_json_string_value(text: str, key: str) -> str | None:
    """Extract a JSON string field value even when the full object is not valid JSON."""
    pattern = rf'"{re.escape(key)}"\s*:\s*"'
    match = re.search(pattern, text)
    if not match:
        return None

    i = match.end()
    body: list[str] = []
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            if i + 1 >= len(text):
                return None
            body.append(text[i : i + 2])
            i += 2
            continue
        if ch == '"':
            return _decode_json_string_body("".join(body))
        body.append(ch)
        i += 1
    return None


def _extract_json_object(text: str) -> dict:
    text = _strip_markdown_fences(text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("Tool creator did not return valid JSON.") from None
        return json.loads(text[start : end + 1])


def parse_generated_tool_response(raw: str) -> tuple[str, str, list[str]]:
    text = _strip_markdown_fences(raw)
    tool_code = ""
    test_code = ""
    requirements: list[str] = []

    try:
        parsed = _extract_json_object(text)
        tool_code = str(parsed.get("tool_code", "")).strip()
        test_code = str(parsed.get("test_code", "")).strip()
        raw_reqs = parsed.get("requirements") or []
        if isinstance(raw_reqs, list):
            requirements = [str(r).strip() for r in raw_reqs if str(r).strip()]
    except (ValueError, json.JSONDecodeError):
        tool_code = (_extract_json_string_value(text, "tool_code") or "").strip()
        test_code = (_extract_json_string_value(text, "test_code") or "").strip()

    if not tool_code or not test_code:
        raise ValueError(
            "Tool creator response missing tool_code or test_code. "
            "The model may have returned malformed JSON."
        )
    return tool_code, test_code, requirements


def validate_test_code(test_code: str) -> tuple[bool, str]:
    try:
        ast.parse(test_code)
    except SyntaxError as exc:
        return False, f"test_code has a syntax error: {exc}"

    has_loader = (
        "importlib" in test_code
        or "spec_from_file_location" in test_code
        or "load_tool" in test_code
    )
    has_tests = (
        "assert" in test_code
        or "unittest" in test_code
        or "pytest" in test_code
        or "raise " in test_code
    )
    if not has_loader:
        return False, (
            "test_code must load the tool via importlib from "
            "/workspace/{tool_name}.py (use spec_from_file_location)."
        )
    if not has_tests:
        return False, "test_code must include assertions or unittest cases."
    return True, ""


async def fix_test_code(
    tool_name: str,
    tool_code: str,
    test_code: str,
    sandbox_logs: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
) -> str:
    log_debug(run_id, "CODE_FIX", f"requesting test_code fix model={creator_model}")
    user_content = (
        f"Tool name: `{tool_name}`\n\n"
        f"Current tool_code (do NOT change):\n```python\n{tool_code}\n```\n\n"
        f"Current test_code (fix this):\n```python\n{test_code}\n```\n\n"
        f"Sandbox failure output:\n```\n{sandbox_logs}\n```\n\n"
        f"Return fixed test_code only."
    )
    messages = [
        {
            "role": "system",
            "content": FIX_TEST_SYSTEM_PROMPT.replace("{tool_name}", tool_name),
        },
        {"role": "user", "content": user_content},
    ]
    raw = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.1
    )
    parsed = _extract_json_object(raw)
    fixed = str(parsed.get("test_code", "")).strip()
    if not fixed:
        raise ValueError("Tool creator did not return fixed test_code.")
    ok, reason = validate_test_code(fixed)
    if not ok:
        raise ValueError(f"Fixed test_code failed validation: {reason}")
    log_generated_code(
        run_id,
        tool_name=tool_name,
        tool_code=tool_code,
        test_code=fixed,
        source="fix_test",
    )
    return fixed


async def generate_tool_code_stream(
    plan: str,
    tool_name: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    edit_context: dict | None = None,
) -> AsyncIterator[tuple[str, str]]:
    if edit_context:
        user_content = (
            f"Tool name: `{tool_name}` (existing tool — update in place)\n\n"
            f"Approved edit plan:\n{plan}\n\n"
            f"Current tool_code:\n```python\n{edit_context.get('tool_code', '')}\n```\n\n"
            f"Current test_code:\n```python\n{edit_context.get('test_code', '')}\n```\n\n"
            f"Current requirements: {edit_context.get('requirements', [])}\n\n"
            f"Produce updated tool_code, test_code, and requirements."
        )
        system_prompt = EDIT_CODE_SYSTEM_PROMPT.replace("{tool_name}", tool_name)
    else:
        user_content = (
            f"Tool name: `{tool_name}`\n\n"
            f"Approved plan:\n{plan}\n\n"
            f"Generate tool_code, test_code, and requirements. The tool file will be saved as {tool_name}.py "
            f"and mounted in the sandbox at /workspace/{tool_name}.py."
        )
        system_prompt = CODE_SYSTEM_PROMPT.replace("{tool_name}", tool_name)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    log_debug(
        run_id,
        "CODE_GEN",
        f"streaming code generation tool={tool_name} model={creator_model}",
    )
    async for kind, text in _litellm_stream(
        litellm_url, headers, creator_model, messages, temperature=0.1
    ):
        log_stream_delta(run_id, "code_gen", kind, text)
        yield kind, text


async def draft_tool_plan(
    tool_name: str,
    description: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
) -> str:
    user_content = (
        f"Design a new tool named `{tool_name}`.\n\n"
        f"Requirements:\n{description}"
    )
    messages = [
        {"role": "system", "content": PLAN_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    log_block(
        run_id,
        "PLAN",
        f"draft request tool={tool_name} model={creator_model}",
        description,
    )
    plan = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.2
    )
    log_plan(run_id, tool_name=tool_name, plan=plan, action="drafted")
    return plan


async def draft_tool_edit_plan(
    tool_name: str,
    change_description: str,
    existing_tool_code: str,
    existing_requirements: list[str],
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
) -> str:
    user_content = (
        f"Edit existing tool `{tool_name}`.\n\n"
        f"Requested changes:\n{change_description}\n\n"
        f"Current tool_code:\n```python\n{existing_tool_code}\n```\n\n"
        f"Current requirements: {existing_requirements}"
    )
    messages = [
        {"role": "system", "content": EDIT_PLAN_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    log_block(
        run_id,
        "PLAN",
        f"edit plan request tool={tool_name} model={creator_model}",
        change_description,
    )
    plan = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.2
    )
    log_plan(run_id, tool_name=tool_name, plan=plan, action="edit_drafted")
    return plan


async def revise_tool_plan(
    tool_name: str,
    description: str,
    previous_plan: str,
    feedback: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
) -> str:
    user_content = (
        f"Tool name: `{tool_name}`\n\n"
        f"Original requirements:\n{description}\n\n"
        f"Previous plan (rejected by user):\n{previous_plan}\n\n"
        f"User-requested changes:\n{feedback}\n\n"
        f"Produce a revised plan that addresses the user's feedback."
    )
    messages = [
        {"role": "system", "content": REVISE_PLAN_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    log_block(run_id, "PLAN", f"revise request tool={tool_name}", feedback)
    plan = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.2
    )
    log_plan(run_id, tool_name=tool_name, plan=plan, action="revised")
    return plan


async def generate_tool_code(
    plan: str,
    tool_name: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
) -> tuple[str, str, list[str]]:
    parts: list[str] = []
    async for kind, text in generate_tool_code_stream(
        plan,
        tool_name,
        creator_model,
        litellm_url=litellm_url,
        headers=headers,
    ):
        if kind == "content":
            parts.append(text)
    return parse_generated_tool_response("".join(parts))
