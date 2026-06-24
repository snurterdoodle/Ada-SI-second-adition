"""Tests for custom skill UI helpers and manifest validation."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import tools_engine


def test_validate_manifest_requires_ui_actions():
    manifest = {
        "kind": "interactive",
        "display_name": "Todos",
        "operations": ["list_tasks", "add_task", "delete_task", "complete_task"],
        "ui": {
            "template": "list",
            "title_field": "title",
            "done_field": "done",
            "actions": {
                "create": "add_task",
                "delete": "delete_task",
                "toggle": "complete_task",
            },
        },
    }
    ok, reason = tools_engine.validate_manifest(manifest, "todo_app")
    assert ok, reason


def test_validate_manifest_custom_requires_entry():
    manifest = {
        "kind": "interactive",
        "display_name": "Notes",
        "operations": ["list_notes", "add_note", "delete_note"],
        "ui": {
            "template": "custom",
            "entry": "index.html",
            "actions": {"create": "add_note", "delete": "delete_note"},
        },
    }
    ok, reason = tools_engine.validate_manifest(manifest, "notes_app")
    assert ok, reason


def test_validate_ui_files_requires_index():
    manifest = {
        "kind": "interactive",
        "ui": {"template": "custom", "entry": "index.html", "actions": {}},
    }
    ok, reason = tools_engine.validate_ui_files({"app.js": "x"}, manifest, "x")
    assert not ok
    assert "index.html" in reason


def test_write_and_resolve_ui_files():
    with tempfile.TemporaryDirectory() as tmp:
        tools_dir = Path(tmp)
        skill_data = tools_dir / "skill_data"
        skill_data.mkdir()
        ui_root = tools_dir / "ui"
        manifest = {
            "kind": "interactive",
            "display_name": "Demo",
            "operations": ["list_items", "add_item", "delete_item"],
            "ui": {
                "template": "custom",
                "entry": "index.html",
                "actions": {"create": "add_item", "delete": "delete_item"},
            },
        }
        ui_files = {
            "index.html": "<!DOCTYPE html><html><body>hi</body></html>",
            "app.js": "console.log('ok')",
        }
        with patch.object(tools_engine, "TOOLS_DIR", tools_dir):
            manifest_path = tools_dir / "demo_app.manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            tools_engine.write_ui_files("demo_app", ui_files, manifest)
            resolved = tools_engine.resolve_skill_ui_file("demo_app", "app.js")
            assert resolved is not None
            assert resolved.read_text(encoding="utf-8") == "console.log('ok')"
            traversal = tools_engine.resolve_skill_ui_file("demo_app", "../skill_data/x")
            assert traversal is None


def test_tool_artifact_paths_includes_ui_dir():
    with tempfile.TemporaryDirectory() as tmp:
        tools_dir = Path(tmp)
        ui_dir = tools_dir / "ui" / "demo"
        ui_dir.mkdir(parents=True)
        (ui_dir / "index.html").write_text("<html></html>", encoding="utf-8")
        with patch.object(tools_engine, "TOOLS_DIR", tools_dir):
            _, dirs = tools_engine.tool_artifact_paths("demo")
            assert ui_dir in dirs


def test_normalize_interactive_manifest_infers_list_actions():
    manifest = {
        "kind": "interactive",
        "operations": ["list_tasks", "add_task", "complete_task", "delete_task"],
        "ui": {"template": "list", "title_field": "title"},
    }
    tools_engine.normalize_interactive_manifest(manifest, "my_todos")
    ok, reason = tools_engine.validate_manifest(manifest, "my_todos")
    assert ok, reason
    assert manifest["ui"]["actions"]["toggle"] == "complete_task"


def test_validate_ui_js_rejects_new_ada_skill():
    manifest = {
        "kind": "interactive",
        "ui": {
            "template": "custom",
            "entry": "index.html",
            "actions": {"create": "add_note", "delete": "delete_note"},
        },
    }
    ui_files = {
        "index.html": '<script src="/static/skill-sdk.js"></script>',
        "app.js": "const skill = new AdaSkill();",
    }
    ok, reason = tools_engine.validate_ui_js(ui_files, manifest)
    assert not ok
    assert "new AdaSkill" in reason


def test_validate_ui_js_accepts_good_pattern():
    manifest = {
        "kind": "interactive",
        "ui": {
            "template": "custom",
            "entry": "index.html",
            "actions": {"create": "add_note", "delete": "delete_note"},
        },
    }
    ui_files = {
        "index.html": '<script src="/static/skill-sdk.js"></script><script src="app.js"></script>',
        "app.js": (
            "AdaSkill.init();\n"
            "async function load() { const d = await AdaSkill.getData(); }\n"
            "AdaSkill.call('add_note', { title: 'a', body: 'b' });\n"
        ),
    }
    ok, reason = tools_engine.validate_ui_js(ui_files, manifest)
    assert ok, reason


if __name__ == "__main__":
    test_validate_manifest_requires_ui_actions()
    test_validate_manifest_custom_requires_entry()
    test_validate_ui_files_requires_index()
    test_write_and_resolve_ui_files()
    test_tool_artifact_paths_includes_ui_dir()
    test_normalize_interactive_manifest_infers_list_actions()
    test_validate_ui_js_rejects_new_ada_skill()
    test_validate_ui_js_accepts_good_pattern()
    print("All test_skill_ui tests passed.")
