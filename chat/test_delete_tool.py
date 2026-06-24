"""Smoke tests for tool deletion cleanup (no runtime or Docker required)."""

import asyncio
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import tools_engine


async def _delete_with_mock_runtime(tool_name: str) -> None:
    with patch.object(tools_engine, "runtime_delete_tool", new_callable=AsyncMock):
        await tools_engine.delete_tool_async(tool_name)


def test_delete_removes_skill_data_manifest_and_staging():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        tools_dir = root / "custom_tools"
        staging_dir = root / "staging"
        skill_data_dir = tools_dir / "skill_data"
        tools_dir.mkdir()
        staging_dir.mkdir()
        skill_data_dir.mkdir()

        tool_name = "calendar"
        (tools_dir / f"{tool_name}.py").write_text("def run(): pass\n", encoding="utf-8")
        (tools_dir / f"{tool_name}.manifest.json").write_text("{}", encoding="utf-8")
        (skill_data_dir / f"{tool_name}.json").write_text(
            json.dumps({"records": [{"id": "1"}]}),
            encoding="utf-8",
        )
        tool_staging = staging_dir / tool_name / "skill_data"
        tool_staging.mkdir(parents=True)
        (tool_staging / f"{tool_name}.json").write_text("{}", encoding="utf-8")

        with patch.object(tools_engine, "TOOLS_DIR", tools_dir), patch.object(
            tools_engine, "STAGING_DIR", staging_dir
        ), patch.object(tools_engine, "SKILL_DATA_DIR", skill_data_dir):
            asyncio.run(_delete_with_mock_runtime(tool_name))

        assert not (tools_dir / f"{tool_name}.py").exists()
        assert not (tools_dir / f"{tool_name}.manifest.json").exists()
        assert not (skill_data_dir / f"{tool_name}.json").exists()
        assert not (staging_dir / tool_name).exists()


def test_delete_orphan_skill_data_only():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        tools_dir = root / "custom_tools"
        staging_dir = root / "staging"
        skill_data_dir = tools_dir / "skill_data"
        tools_dir.mkdir()
        staging_dir.mkdir()
        skill_data_dir.mkdir()

        tool_name = "calendar"
        (tools_dir / f"{tool_name}.manifest.json").write_text("{}", encoding="utf-8")
        (skill_data_dir / f"{tool_name}.json").write_text("{}", encoding="utf-8")

        with patch.object(tools_engine, "TOOLS_DIR", tools_dir), patch.object(
            tools_engine, "STAGING_DIR", staging_dir
        ), patch.object(tools_engine, "SKILL_DATA_DIR", skill_data_dir):
            asyncio.run(_delete_with_mock_runtime(tool_name))

        assert not (tools_dir / f"{tool_name}.manifest.json").exists()
        assert not (skill_data_dir / f"{tool_name}.json").exists()


def test_delete_removes_ui_directory():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        tools_dir = root / "custom_tools"
        staging_dir = root / "staging"
        skill_data_dir = tools_dir / "skill_data"
        ui_dir = tools_dir / "ui" / "notes"
        tools_dir.mkdir()
        staging_dir.mkdir()
        skill_data_dir.mkdir()
        ui_dir.mkdir(parents=True)
        (ui_dir / "index.html").write_text("<html></html>", encoding="utf-8")

        tool_name = "notes"
        (tools_dir / f"{tool_name}.py").write_text("def run(): pass\n", encoding="utf-8")
        (tools_dir / f"{tool_name}.manifest.json").write_text("{}", encoding="utf-8")

        with patch.object(tools_engine, "TOOLS_DIR", tools_dir), patch.object(
            tools_engine, "STAGING_DIR", staging_dir
        ), patch.object(tools_engine, "SKILL_DATA_DIR", skill_data_dir):
            asyncio.run(_delete_with_mock_runtime(tool_name))

        assert not ui_dir.exists()


if __name__ == "__main__":
    test_delete_removes_skill_data_manifest_and_staging()
    test_delete_orphan_skill_data_only()
    test_delete_removes_ui_directory()
    print("All delete_tool smoke tests passed.")
