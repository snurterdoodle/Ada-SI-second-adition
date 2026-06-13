"""Smoke tests for interactive skill sandbox staging (no Docker daemon required)."""

import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

sys.modules.setdefault("docker", MagicMock())
sys.modules.setdefault("docker.errors", MagicMock())

from sandbox import _sandbox_volumes, _seed_skill_data


def test_seed_skill_data_creates_json():
    with tempfile.TemporaryDirectory() as tmp:
        staging = Path(tmp)
        _seed_skill_data(staging, "calculator_app")
        data_path = staging / "skill_data" / "calculator_app.json"
        assert data_path.exists()
        data = json.loads(data_path.read_text(encoding="utf-8"))
        assert data == {"records": []}


def test_sandbox_volumes_includes_rw_skill_data():
    volumes = _sandbox_volumes("/host/workspace", "/host/workspace/skill_data")
    assert volumes["/host/workspace"]["mode"] == "ro"
    assert volumes["/host/workspace/skill_data"]["bind"] == "/workspace/skill_data"
    assert volumes["/host/workspace/skill_data"]["mode"] == "rw"


def test_sandbox_volumes_headless_no_skill_data_bind():
    volumes = _sandbox_volumes("/host/workspace", None)
    assert len(volumes) == 1
    assert "/workspace/skill_data" not in str(volumes)


if __name__ == "__main__":
    test_seed_skill_data_creates_json()
    test_sandbox_volumes_includes_rw_skill_data()
    test_sandbox_volumes_headless_no_skill_data_bind()
    print("All sandbox skill_data smoke tests passed.")
