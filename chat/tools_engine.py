import ast
import asyncio
import json
import logging
from pathlib import Path

from runtime_client import (
    diff_new_requirements,
    fetch_runtime_manifest,
    fetch_runtime_tools,
    normalize_requirements,
    runtime_delete_tool,
    runtime_health,
    runtime_run_tool,
    set_runtime_url,
)

logger = logging.getLogger(__name__)

TOOLS_DIR = Path(__file__).parent / "custom_tools"
TOOLS_DIR.mkdir(exist_ok=True)

ORCHESTRATOR_SYSTEM_PROMPT = """You are Ada-SI, a self-improving agent that extends itself by creating Python tools.

Routing rules (follow strictly):
1. If the user needs live or external data you cannot access directly — weather, stock prices, news, web lookups, account/system state, file I/O, scheduled jobs, or any API — call generate_new_tool. Do NOT reply with "I can't" or ask clarifying questions instead of calling the tool; put requirements (APIs, inputs, outputs) in the tool description.
2. If an installed tool matches the request, call that tool first. Pass whatever arguments you have; the tool may return follow-up questions.
3. If the user asks to fix, change, or improve an existing installed tool, call edit_existing_tool with the tool name and a detailed description of the changes.
4. Reply in plain text only for general conversation, explanations, or static knowledge that needs no live data and no custom code.

When calling generate_new_tool or edit_existing_tool, use snake_case tool_name and a detailed description the tool creator can implement without further user input when possible."""

GENERATE_NEW_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "generate_new_tool",
        "description": (
            "Request creation of a new Python tool when the user needs a capability you do "
            "not have installed: live/real-time data (weather, markets, news), external APIs, "
            "web fetching, persistence, filesystem access, or custom automation. Call this "
            "instead of asking the user for details you could specify in description. "
            "Do not use for pure chat or static facts answerable without tools or APIs."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tool_name": {
                    "type": "string",
                    "description": "Snake_case name for the new tool module.",
                },
                "description": {
                    "type": "string",
                    "description": (
                        "Detailed explanation of what the tool should do, its inputs, "
                        "and expected outputs."
                    ),
                },
            },
            "required": ["tool_name", "description"],
        },
    },
}

EDIT_EXISTING_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "edit_existing_tool",
        "description": (
            "Modify an installed tool when the user wants to fix bugs, change behavior, "
            "add inputs/outputs, or update dependencies. Use when a tool exists but needs "
            "changes — not for creating a brand-new capability under a new name."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tool_name": {
                    "type": "string",
                    "description": "Snake_case name of the existing installed tool.",
                },
                "description": {
                    "type": "string",
                    "description": "Detailed description of the requested changes.",
                },
            },
            "required": ["tool_name", "description"],
        },
    },
}


def read_tool_file(tool_name: str) -> str:
    path = TOOLS_DIR / f"{tool_name}.py"
    if not path.exists():
        raise FileNotFoundError(f"Tool '{tool_name}' not found.")
    return path.read_text(encoding="utf-8")


def read_tool_requirements(tool_name: str) -> list[str]:
    path = TOOLS_DIR / f"{tool_name}.requirements.txt"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return normalize_requirements([line.strip() for line in lines if line.strip()])


def tool_exists(tool_name: str) -> bool:
    return (TOOLS_DIR / f"{tool_name}.py").exists()


def prepare_agent_messages(messages: list[dict]) -> list[dict]:
    user_system_parts: list[str] = []
    rest: list[dict] = []
    for msg in messages:
        if msg.get("role") == "system":
            content = (msg.get("content") or "").strip()
            if content:
                user_system_parts.append(content)
        else:
            rest.append(msg)

    system_content = ORCHESTRATOR_SYSTEM_PROMPT
    if user_system_parts:
        system_content += (
            "\n\nAdditional user instructions:\n" + "\n\n".join(user_system_parts)
        )

    return [{"role": "system", "content": system_content}, *rest]


def _load_local_schemas() -> list[dict]:
    import importlib.util

    schemas: list[dict] = []
    for file in sorted(TOOLS_DIR.glob("*.py")):
        if file.name.startswith("__"):
            continue
        try:
            spec = importlib.util.spec_from_file_location(file.stem, file)
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            if hasattr(mod, "get_tool_schema"):
                schemas.append(mod.get_tool_schema())
        except Exception as exc:
            logger.warning("Local schema load failed for %s: %s", file.name, exc)
    return schemas


def load_dynamic_tools() -> list[dict]:
    tools = [GENERATE_NEW_TOOL_SCHEMA, EDIT_EXISTING_TOOL_SCHEMA]
    try:
        runtime_tools = asyncio.get_event_loop().run_until_complete(fetch_runtime_tools())
        for item in runtime_tools:
            schema = item.get("schema")
            if schema:
                tools.append(schema)
        return tools
    except RuntimeError:
        pass
    except Exception as exc:
        logger.warning("Runtime tool list failed, falling back to local: %s", exc)

    try:
        loop = asyncio.new_event_loop()
        runtime_tools = loop.run_until_complete(fetch_runtime_tools())
        loop.close()
        for item in runtime_tools:
            schema = item.get("schema")
            if schema:
                tools.append(schema)
        return tools
    except Exception as exc:
        logger.warning("Runtime tool list failed, falling back to local: %s", exc)

    tools.extend(_load_local_schemas())
    return tools


async def aload_dynamic_tools() -> list[dict]:
    tools = [GENERATE_NEW_TOOL_SCHEMA, EDIT_EXISTING_TOOL_SCHEMA]
    try:
        runtime_tools = await fetch_runtime_tools()
        for item in runtime_tools:
            schema = item.get("schema")
            if schema:
                tools.append(schema)
    except Exception as exc:
        logger.warning("Runtime tool list failed, falling back to local: %s", exc)
        tools.extend(_load_local_schemas())
    return tools


async def alist_tool_summaries() -> list[dict[str, str]]:
    try:
        runtime_tools = await fetch_runtime_tools()
        return [
            {"name": t["name"], "description": t.get("description", "")}
            for t in runtime_tools
        ]
    except Exception as exc:
        logger.warning("Runtime summaries failed: %s", exc)
        return []


def list_tool_summaries() -> list[dict[str, str]]:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return []
        return loop.run_until_complete(alist_tool_summaries())
    except Exception:
        try:
            loop = asyncio.new_event_loop()
            result = loop.run_until_complete(alist_tool_summaries())
            loop.close()
            return result
        except Exception as exc:
            logger.warning("list_tool_summaries failed: %s", exc)
            return []


async def execute_dynamic_tool(name: str, arguments: dict, *, run_id: str = "") -> str:
    if name in ("generate_new_tool", "edit_existing_tool"):
        raise ValueError(f"{name} must be intercepted by the orchestrator.")

    logger.debug("[run=%s][TOOL] executing %s args=%s", run_id or "-", name, arguments)
    return await runtime_run_tool(name, arguments)


def execute_dynamic_tool_sync(name: str, arguments: dict, *, run_id: str = "") -> str:
    return asyncio.get_event_loop().run_until_complete(
        execute_dynamic_tool(name, arguments, run_id=run_id)
    )


def validate_tool_module(code: str) -> bool:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False

    names = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    return "get_tool_schema" in names and "run" in names


def read_tool_test(tool_name: str) -> str:
    path = TOOLS_DIR / f"{tool_name}.test.py"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def write_tool_files(
    tool_name: str,
    code: str,
    requirements: list[str] | None = None,
    test_code: str = "",
) -> Path:
    if not validate_tool_module(code):
        raise ValueError("Tool code must define get_tool_schema() and run().")

    target = TOOLS_DIR / f"{tool_name}.py"
    target.write_text(code, encoding="utf-8")

    req_path = TOOLS_DIR / f"{tool_name}.requirements.txt"
    reqs = normalize_requirements(requirements or [])
    if reqs:
        req_path.write_text("\n".join(reqs) + "\n", encoding="utf-8")
    elif req_path.exists():
        req_path.unlink()

    test_path = TOOLS_DIR / f"{tool_name}.test.py"
    if test_code:
        test_path.write_text(test_code, encoding="utf-8")
    return target


def write_tool(tool_name: str, code: str) -> Path:
    return write_tool_files(tool_name, code, [])


async def delete_tool_async(tool_name: str) -> None:
    if not tool_name or not tool_name.replace("_", "").isalnum():
        raise ValueError(f"Invalid tool name: {tool_name}")

    target = TOOLS_DIR / f"{tool_name}.py"
    if not target.exists():
        raise FileNotFoundError(f"Tool '{tool_name}' not found.")

    await runtime_delete_tool(tool_name)
    req_path = TOOLS_DIR / f"{tool_name}.requirements.txt"
    if req_path.exists():
        req_path.unlink()
    test_path = TOOLS_DIR / f"{tool_name}.test.py"
    if test_path.exists():
        test_path.unlink()
    target.unlink()


def delete_tool(tool_name: str) -> None:
    asyncio.get_event_loop().run_until_complete(delete_tool_async(tool_name))


async def get_new_packages_for_requirements(requirements: list[str]) -> tuple[list[str], list[str]]:
    manifest = await fetch_runtime_manifest()
    approved = manifest.get("approved_packages") or []
    new_packages = diff_new_requirements(requirements, approved)
    return new_packages, approved
