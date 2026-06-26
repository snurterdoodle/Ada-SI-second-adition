"""Tests for ephemeral venv tool verification."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tool_verify import (  # noqa: E402
    _seed_skill_data,
    augment_requirements_for_missing_module,
    parse_missing_module,
    rewrite_workspace_paths,
    verify_skill_api_contract_in_ephemeral_venv,
    verify_tool_in_ephemeral_venv,
)

ECHO_TOOL = '''
def get_tool_schema():
    return {
        "name": "echo_test",
        "description": "Echo text",
        "parameters": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    }

def run(text: str):
    return text
'''

ECHO_TEST = '''
import importlib.util

def load_tool():
    spec = importlib.util.spec_from_file_location(
        "tool_mod", "/workspace/echo_test.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_run():
    mod = load_tool()
    assert mod.run(text="hello") == "hello"

if __name__ == "__main__":
    test_run()
    print("All tests passed.")
'''


def test_parse_missing_module():
    assert parse_missing_module("API contract test error: No module named 'psutil'") == "psutil"
    assert parse_missing_module('ModuleNotFoundError: No module named "requests.exceptions"') == "requests"
    assert parse_missing_module("something else") is None


def test_augment_requirements_for_missing_module():
    updated, missing = augment_requirements_for_missing_module(
        ["httpx"],
        "No module named 'psutil'",
    )
    assert missing == "psutil"
    assert "psutil" in updated
    assert "httpx" in updated

    same, missing_again = augment_requirements_for_missing_module(
        updated,
        "No module named 'psutil'",
    )
    assert missing_again is None
    assert same == updated


def test_verify_skill_api_contract_in_ephemeral_venv():
    from test_skill_contract import LIST_TOOL, MANIFEST

    ok, reason, reqs = verify_skill_api_contract_in_ephemeral_venv(
        "contract_demo",
        LIST_TOOL,
        MANIFEST,
        [],
    )
    assert ok, reason
    assert reqs == []


def test_seed_skill_data_creates_json():
    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp)
        _seed_skill_data(workspace, "calculator_app")
        data_path = workspace / "skill_data" / "calculator_app.json"
        assert data_path.exists()
        data = json.loads(data_path.read_text(encoding="utf-8"))
        assert data == {"records": []}


def test_rewrite_workspace_paths():
    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp)
        raw = '''
load("/workspace/foo.py")
assert "/workspace/output.wav" in result
assert "Successfully generated TTS audio: /workspace/tts_output_" in result
'''
        rewritten = rewrite_workspace_paths(raw, workspace)
        expected_prefix = workspace.resolve().as_posix()
        assert expected_prefix in rewritten
        assert '"/workspace/foo.py"' not in rewritten
        assert '"/workspace/output.wav" in result' in rewritten
        assert "/workspace/tts_output_" in rewritten

ECHO_TEST_WITH_WORKSPACE_ASSERT = '''
import importlib.util

def load_tool():
    spec = importlib.util.spec_from_file_location(
        "tool_mod", "/workspace/ws_echo.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_run():
    mod = load_tool()
    result = mod.run(text="hello")
    assert "/workspace/hello" in result

if __name__ == "__main__":
    test_run()
    print("All tests passed.")
'''

WORKSPACE_RETURN_TOOL = '''
def get_tool_schema():
    return {
        "name": "ws_echo",
        "description": "Echo with workspace prefix",
        "parameters": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    }

def run(text: str):
    return f"/workspace/{text}"
'''


def test_verify_tool_with_workspace_return_assertion():
    ok, output = verify_tool_in_ephemeral_venv(
        "ws_echo",
        WORKSPACE_RETURN_TOOL,
        ECHO_TEST_WITH_WORKSPACE_ASSERT,
        [],
    )
    assert ok, output


def test_verify_stdlib_tool_success_and_cleanup():
    ok, output = verify_tool_in_ephemeral_venv(
        "echo_test",
        ECHO_TOOL,
        ECHO_TEST,
        [],
    )
    assert ok, output
    assert "passed" in output.lower() or "hello" in output.lower()

    staging = Path(__file__).resolve().parent / "staging"
    leftovers = list(staging.glob(".verify_echo_test_*"))
    assert leftovers == []


if __name__ == "__main__":
    test_parse_missing_module()
    test_augment_requirements_for_missing_module()
    test_verify_skill_api_contract_in_ephemeral_venv()
    test_seed_skill_data_creates_json()
    test_rewrite_workspace_paths()
    test_verify_tool_with_workspace_return_assertion()
    test_verify_stdlib_tool_success_and_cleanup()
    print("All tool_verify tests passed.")
