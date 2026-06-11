import ast
import importlib.util
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

TOOLS_DIR = Path(__file__).parent / "custom_tools"
TOOLS_DIR.mkdir(exist_ok=True)

ORCHESTRATOR_SYSTEM_PROMPT = """You are Ada-SI, a self-improving agent that extends itself by creating Python tools.

Routing rules (follow strictly):
1. If the user needs live or external data you cannot access directly — weather, stock prices, news, web lookups, account/system state, file I/O, scheduled jobs, or any API — call generate_new_tool. Do NOT reply with "I can't" or ask clarifying questions instead of calling the tool; put requirements (APIs, inputs, outputs) in the tool description.
2. If an installed tool matches the request, call that tool first. Pass whatever arguments you have; the tool may return follow-up questions.
3. Reply in plain text only for general conversation, explanations, or static knowledge that needs no live data and no custom code.

When calling generate_new_tool, use snake_case tool_name and a detailed description the tool creator can implement without further user input when possible."""

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


def _load_module_from_file(file: Path):
    spec = importlib.util.spec_from_file_location(file.stem, file)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {file}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def list_tool_summaries() -> list[dict[str, str]]:
    summaries: list[dict[str, str]] = []
    for file in sorted(TOOLS_DIR.glob("*.py")):
        if file.name.startswith("__"):
            continue
        try:
            mod = _load_module_from_file(file)
            if not hasattr(mod, "get_tool_schema"):
                continue
            schema = mod.get_tool_schema()
            fn = schema.get("function", schema)
            summaries.append(
                {
                    "name": fn.get("name", file.stem),
                    "description": fn.get("description", ""),
                }
            )
        except Exception as exc:
            logger.warning("Skipping tool summary for %s: %s", file.name, exc)
    return summaries


def prepare_agent_messages(messages: list[dict]) -> list[dict]:
    """Merge orchestrator instructions with optional client system prompt."""
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


def load_dynamic_tools() -> list[dict]:
    tools = [GENERATE_NEW_TOOL_SCHEMA]

    for file in sorted(TOOLS_DIR.glob("*.py")):
        if file.name.startswith("__"):
            continue
        try:
            mod = _load_module_from_file(file)
            if hasattr(mod, "get_tool_schema"):
                tools.append(mod.get_tool_schema())
        except Exception as exc:
            logger.warning("Error loading dynamic tool %s: %s", file.name, exc)

    return tools


def execute_dynamic_tool(name: str, arguments: dict, *, run_id: str = "") -> str:
    if name == "generate_new_tool":
        raise ValueError("generate_new_tool must be intercepted by the orchestrator.")

    file = TOOLS_DIR / f"{name}.py"
    if not file.exists():
        raise ValueError(f"Tool '{name}' not found.")

    mod = _load_module_from_file(file)
    if not hasattr(mod, "run"):
        raise ValueError(f"Tool '{name}' has no run() function.")

    logger.debug("[run=%s][TOOL] executing %s args=%s", run_id or "-", name, arguments)
    result = mod.run(**arguments)
    if isinstance(result, str):
        return result
    return json.dumps(result)


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


def write_tool(tool_name: str, code: str) -> Path:
    if not validate_tool_module(code):
        raise ValueError("Tool code must define get_tool_schema() and run().")

    target = TOOLS_DIR / f"{tool_name}.py"
    target.write_text(code, encoding="utf-8")
    return target


def delete_tool(tool_name: str) -> None:
    if not tool_name or not tool_name.replace("_", "").isalnum():
        raise ValueError(f"Invalid tool name: {tool_name}")

    target = TOOLS_DIR / f"{tool_name}.py"
    if not target.exists():
        raise FileNotFoundError(f"Tool '{tool_name}' not found.")
    target.unlink()
