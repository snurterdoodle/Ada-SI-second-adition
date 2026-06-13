import ast
import json
import re
from collections.abc import AsyncIterator

import httpx

from litellm_client import build_completion_payload, stream_completion_deltas
from debug_log import log_block, log_debug, log_generated_code, log_plan, log_stream_delta
from prompts_config import (
    get_forge_code_prompt,
    get_forge_edit_code_prompt,
    get_forge_edit_plan_prompt,
    get_forge_fix_codegen_prompt,
    get_forge_fix_runtime_prompt,
    get_forge_fix_test_prompt,
    get_forge_fix_validation_prompt,
    get_forge_plan_prompt,
    get_forge_revise_plan_prompt,
    get_forge_revise_preview_prompt,
)
from tools_engine import validate_manifest, validate_tool_module


async def _litellm_chat(
    litellm_url: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict],
    *,
    temperature: float = 0.2,
    reasoning_effort: str | None = None,
) -> str:
    payload = build_completion_payload(
        model,
        messages,
        stream=False,
        temperature=temperature,
        reasoning_effort=reasoning_effort,
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
    reasoning_effort: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """Yield (kind, text) where kind is 'content' or 'reasoning'."""
    async for kind, text in stream_completion_deltas(
        litellm_url,
        headers,
        model,
        messages,
        temperature=temperature,
        reasoning_effort=reasoning_effort,
    ):
        yield kind, text


async def draft_tool_plan_stream(
    tool_name: str,
    description: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    reasoning_effort: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    user_content = (
        f"Design a new tool named `{tool_name}`.\n\n"
        f"Requirements:\n{description}"
    )
    messages = [
        {"role": "system", "content": get_forge_plan_prompt()},
        {"role": "user", "content": user_content},
    ]
    log_block(
        run_id,
        "PLAN",
        f"draft request tool={tool_name} model={creator_model}",
        description,
    )
    async for kind, text in _litellm_stream(
        litellm_url, headers, creator_model, messages, temperature=0.2,
        reasoning_effort=reasoning_effort,
    ):
        log_stream_delta(run_id, "plan", kind, text)
        yield kind, text


async def draft_tool_edit_plan_stream(
    tool_name: str,
    change_description: str,
    existing_tool_code: str,
    existing_requirements: list[str],
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    existing_manifest: dict | None = None,
    reasoning_effort: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    user_content = (
        f"Edit existing tool `{tool_name}`.\n\n"
        f"Requested changes:\n{change_description}\n\n"
        f"Current tool_code:\n```python\n{existing_tool_code}\n```\n\n"
        f"Current requirements: {existing_requirements}"
    )
    if existing_manifest:
        user_content += f"\n\nCurrent manifest:\n```json\n{json.dumps(existing_manifest, indent=2)}\n```"
    messages = [
        {"role": "system", "content": get_forge_edit_plan_prompt()},
        {"role": "user", "content": user_content},
    ]
    log_block(
        run_id,
        "PLAN",
        f"edit plan request tool={tool_name} model={creator_model}",
        change_description,
    )
    async for kind, text in _litellm_stream(
        litellm_url, headers, creator_model, messages, temperature=0.2,
        reasoning_effort=reasoning_effort,
    ):
        log_stream_delta(run_id, "plan", kind, text)
        yield kind, text


async def revise_tool_plan_stream(
    tool_name: str,
    description: str,
    previous_plan: str,
    feedback: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    reasoning_effort: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    user_content = (
        f"Tool name: `{tool_name}`\n\n"
        f"Original requirements:\n{description}\n\n"
        f"Previous plan (rejected by user):\n{previous_plan}\n\n"
        f"User-requested changes:\n{feedback}\n\n"
        f"Produce a revised plan that addresses the user's feedback."
    )
    messages = [
        {"role": "system", "content": get_forge_revise_plan_prompt()},
        {"role": "user", "content": user_content},
    ]
    log_block(run_id, "PLAN", f"revise request tool={tool_name}", feedback)
    async for kind, text in _litellm_stream(
        litellm_url, headers, creator_model, messages, temperature=0.2,
        reasoning_effort=reasoning_effort,
    ):
        log_stream_delta(run_id, "plan", kind, text)
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


def parse_generated_tool_response(raw: str) -> tuple[str, str, list[str], dict | None]:
    text = _strip_markdown_fences(raw)
    tool_code = ""
    test_code = ""
    requirements: list[str] = []
    manifest: dict | None = None

    try:
        parsed = _extract_json_object(text)
        tool_code = str(parsed.get("tool_code", "")).strip()
        test_code = str(parsed.get("test_code", "")).strip()
        raw_reqs = parsed.get("requirements") or []
        if isinstance(raw_reqs, list):
            requirements = [str(r).strip() for r in raw_reqs if str(r).strip()]
        raw_manifest = parsed.get("manifest")
        if isinstance(raw_manifest, dict):
            manifest = raw_manifest
    except (ValueError, json.JSONDecodeError):
        tool_code = (_extract_json_string_value(text, "tool_code") or "").strip()
        test_code = (_extract_json_string_value(text, "test_code") or "").strip()

    if not tool_code or not test_code:
        raise ValueError(
            "Tool creator response missing tool_code or test_code. "
            "The model may have returned malformed JSON."
        )
    return tool_code, test_code, requirements, manifest


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


async def repair_generated_tool_response(
    plan: str,
    tool_name: str,
    raw_response: str,
    error_message: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    edit_context: dict | None = None,
    reasoning_effort: str | None = None,
) -> tuple[str, str, list[str], dict | None]:
    log_debug(run_id, "CODE_FIX", f"repairing codegen JSON model={creator_model}")
    user_content = (
        f"Tool name: `{tool_name}`\n\n"
        f"Plan:\n{plan}\n\n"
        f"Parse error: {error_message}\n\n"
        f"Malformed model output:\n```\n{raw_response[:12000]}\n```\n\n"
        f"Return corrected tool_code, test_code, requirements, and manifest when applicable."
    )
    if edit_context:
        user_content += (
            f"\n\nEditing existing tool. Prior tool_code length: "
            f"{len(edit_context.get('tool_code', ''))}"
        )
    messages = [
        {
            "role": "system",
            "content": get_forge_fix_codegen_prompt().replace("{tool_name}", tool_name),
        },
        {"role": "user", "content": user_content},
    ]
    raw = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.1,
        reasoning_effort=reasoning_effort,
    )
    tool_code, test_code, requirements, _manifest = parse_generated_tool_response(raw)
    log_generated_code(
        run_id,
        tool_name=tool_name,
        tool_code=tool_code,
        test_code=test_code,
        source="repair_codegen",
    )
    return tool_code, test_code, requirements


async def fix_validation_errors(
    tool_name: str,
    tool_code: str,
    test_code: str,
    validation_error: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    reasoning_effort: str | None = None,
) -> tuple[str, str]:
    log_debug(run_id, "CODE_FIX", f"fixing validation errors model={creator_model}")
    user_content = (
        f"Tool name: `{tool_name}`\n\n"
        f"Validation error:\n{validation_error}\n\n"
        f"Current tool_code:\n```python\n{tool_code}\n```\n\n"
        f"Current test_code:\n```python\n{test_code}\n```\n\n"
        f"Return fixed tool_code and test_code."
    )
    messages = [
        {
            "role": "system",
            "content": get_forge_fix_validation_prompt().replace("{tool_name}", tool_name),
        },
        {"role": "user", "content": user_content},
    ]
    raw = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.1,
        reasoning_effort=reasoning_effort,
    )
    parsed = _extract_json_object(raw)
    fixed_tool = str(parsed.get("tool_code", "")).strip() or tool_code
    fixed_test = str(parsed.get("test_code", "")).strip() or test_code
    if not validate_tool_module(fixed_tool):
        raise ValueError("Fixed tool_code still missing get_tool_schema() or run().")
    ok, reason = validate_test_code(fixed_test)
    if not ok:
        raise ValueError(f"Fixed test_code still invalid: {reason}")
    log_generated_code(
        run_id,
        tool_name=tool_name,
        tool_code=fixed_tool,
        test_code=fixed_test,
        source="fix_validation",
    )
    return fixed_tool, fixed_test


async def revise_preview_code(
    tool_name: str,
    tool_code: str,
    test_code: str,
    manifest: dict | None,
    feedback: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    reasoning_effort: str | None = None,
) -> tuple[str, str, dict | None]:
    log_debug(run_id, "CODE_FIX", f"revising preview from UI feedback model={creator_model}")
    manifest_json = json.dumps(manifest, indent=2) if manifest else "null"
    user_content = (
        f"Tool name: `{tool_name}`\n\n"
        f"User UI feedback:\n{feedback}\n\n"
        f"Current manifest:\n```json\n{manifest_json}\n```\n\n"
        f"Current tool_code:\n```python\n{tool_code}\n```\n\n"
        f"Current test_code:\n```python\n{test_code}\n```\n\n"
        f"Return revised tool_code, test_code, and manifest."
    )
    messages = [
        {
            "role": "system",
            "content": get_forge_revise_preview_prompt().replace("{tool_name}", tool_name),
        },
        {"role": "user", "content": user_content},
    ]
    raw = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.1,
        reasoning_effort=reasoning_effort,
    )
    parsed = _extract_json_object(raw)
    fixed_tool = str(parsed.get("tool_code", "")).strip() or tool_code
    fixed_test = str(parsed.get("test_code", "")).strip() or test_code
    fixed_manifest = parsed.get("manifest")
    if fixed_manifest is None:
        fixed_manifest = manifest
    elif not isinstance(fixed_manifest, dict):
        fixed_manifest = manifest
    if not validate_tool_module(fixed_tool):
        raise ValueError("Revised tool_code still missing get_tool_schema() or run().")
    ok, reason = validate_test_code(fixed_test)
    if not ok:
        raise ValueError(f"Revised test_code still invalid: {reason}")
    if fixed_manifest:
        manifest_ok, manifest_reason = validate_manifest(fixed_manifest, tool_name)
        if not manifest_ok:
            raise ValueError(f"Revised manifest invalid: {manifest_reason}")
    log_generated_code(
        run_id,
        tool_name=tool_name,
        tool_code=fixed_tool,
        test_code=fixed_test,
        source="revise_preview",
    )
    return fixed_tool, fixed_test, fixed_manifest


async def fix_runtime_failure(
    tool_name: str,
    tool_code: str,
    test_code: str,
    runtime_logs: str,
    creator_model: str,
    *,
    litellm_url: str,
    headers: dict[str, str],
    run_id: str = "",
    reasoning_effort: str | None = None,
) -> tuple[str, str]:
    log_debug(run_id, "CODE_FIX", f"fixing runtime failure model={creator_model}")
    user_content = (
        f"Tool name: `{tool_name}`\n\n"
        f"Current tool_code:\n```python\n{tool_code}\n```\n\n"
        f"Current test_code:\n```python\n{test_code}\n```\n\n"
        f"Runtime test failure output:\n```\n{runtime_logs}\n```\n\n"
        f"Return fixed tool_code and test_code."
    )
    messages = [
        {
            "role": "system",
            "content": get_forge_fix_runtime_prompt().replace("{tool_name}", tool_name),
        },
        {"role": "user", "content": user_content},
    ]
    raw = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.1,
        reasoning_effort=reasoning_effort,
    )
    parsed = _extract_json_object(raw)
    fixed_tool = str(parsed.get("tool_code", "")).strip() or tool_code
    fixed_test = str(parsed.get("test_code", "")).strip() or test_code
    if not validate_tool_module(fixed_tool):
        raise ValueError("Fixed tool_code still missing get_tool_schema() or run().")
    ok, reason = validate_test_code(fixed_test)
    if not ok:
        raise ValueError(f"Fixed test_code still invalid: {reason}")
    log_generated_code(
        run_id,
        tool_name=tool_name,
        tool_code=fixed_tool,
        test_code=fixed_test,
        source="fix_runtime",
    )
    return fixed_tool, fixed_test


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
    reasoning_effort: str | None = None,
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
            "content": get_forge_fix_test_prompt().replace("{tool_name}", tool_name),
        },
        {"role": "user", "content": user_content},
    ]
    raw = await _litellm_chat(
        litellm_url, headers, creator_model, messages, temperature=0.1,
        reasoning_effort=reasoning_effort,
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
    reasoning_effort: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    if edit_context:
        user_content = (
            f"Tool name: `{tool_name}` (existing tool — update in place)\n\n"
            f"Approved edit plan:\n{plan}\n\n"
            f"Current tool_code:\n```python\n{edit_context.get('tool_code', '')}\n```\n\n"
            f"Current test_code:\n```python\n{edit_context.get('test_code', '')}\n```\n\n"
            f"Current requirements: {edit_context.get('requirements', [])}\n\n"
        )
        if edit_context.get("manifest"):
            user_content += (
                f"Current manifest:\n```json\n"
                f"{json.dumps(edit_context['manifest'], indent=2)}\n```\n\n"
            )
        user_content += "Produce updated tool_code, test_code, requirements, and manifest."
        system_prompt = get_forge_edit_code_prompt().replace("{tool_name}", tool_name)
    else:
        user_content = (
            f"Tool name: `{tool_name}`\n\n"
            f"Approved plan:\n{plan}\n\n"
            f"Generate tool_code, test_code, requirements, and manifest. "
            f"The tool file will be saved as {tool_name}.py "
            f"and mounted in the sandbox at /workspace/{tool_name}.py. "
            f"Use manifest null for headless tools; include interactive manifest when the plan specifies an app UI."
        )
        system_prompt = get_forge_code_prompt().replace("{tool_name}", tool_name)

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
        litellm_url, headers, creator_model, messages, temperature=0.1,
        reasoning_effort=reasoning_effort,
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
    parts: list[str] = []
    async for kind, text in draft_tool_plan_stream(
        tool_name,
        description,
        creator_model,
        litellm_url=litellm_url,
        headers=headers,
        run_id=run_id,
    ):
        if kind == "content":
            parts.append(text)
    plan = "".join(parts)
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
    parts: list[str] = []
    async for kind, text in draft_tool_edit_plan_stream(
        tool_name,
        change_description,
        existing_tool_code,
        existing_requirements,
        creator_model,
        litellm_url=litellm_url,
        headers=headers,
        run_id=run_id,
    ):
        if kind == "content":
            parts.append(text)
    plan = "".join(parts)
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
    parts: list[str] = []
    async for kind, text in revise_tool_plan_stream(
        tool_name,
        description,
        previous_plan,
        feedback,
        creator_model,
        litellm_url=litellm_url,
        headers=headers,
        run_id=run_id,
    ):
        if kind == "content":
            parts.append(text)
    plan = "".join(parts)
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
