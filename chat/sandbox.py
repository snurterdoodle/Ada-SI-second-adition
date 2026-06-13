import json
import logging
import os
import shutil
from pathlib import Path

import docker
from docker.errors import DockerException

from tools_engine import DEFAULT_SKILL_DATA

logger = logging.getLogger(__name__)

STAGING_DIR = Path(__file__).parent / "staging"
STAGING_DIR.mkdir(exist_ok=True)
SANDBOX_IMAGE = "python:3.12-slim"
SANDBOX_TIMEOUT = 30
SANDBOX_MEM_LIMIT = "256m"
SANDBOX_LOG_LIMIT = 8192


def check_docker_available() -> tuple[bool, str]:
    try:
        client = docker.from_env()
        client.ping()
        return True, ""
    except DockerException as exc:
        return False, (
            "Docker is unavailable. Mount /var/run/docker.sock into the chat container "
            f"and ensure Docker Desktop is running. Details: {exc}"
        )
    except Exception as exc:
        return False, f"Docker check failed: {exc}"


def _get_staging_host_path(client: docker.DockerClient) -> str | None:
    container_id = os.environ.get("HOSTNAME", "")
    if not container_id:
        return None
    try:
        info = client.containers.get(container_id)
        for mount in info.attrs.get("Mounts", []):
            if mount.get("Destination") == "/app/staging":
                return mount.get("Source")
    except Exception as exc:
        logger.warning("Could not inspect staging mount: %s", exc)
    return None


def _cleanup_staging(staging_dir: Path) -> None:
    if staging_dir.exists():
        shutil.rmtree(staging_dir, ignore_errors=True)


def _format_sandbox_logs(stdout: str, stderr: str, exit_code: int | None = None) -> str:
    parts = ["=== sandbox test output ==="]
    if exit_code is not None:
        parts.append(f"exit code: {exit_code}")
    if stdout.strip():
        parts.append("--- stdout ---")
        parts.append(stdout.strip())
    if stderr.strip():
        parts.append("--- stderr ---")
        parts.append(stderr.strip())
    combined = "\n".join(parts)
    if len(combined) > SANDBOX_LOG_LIMIT:
        combined = combined[:SANDBOX_LOG_LIMIT] + "\n… (truncated)"
    return combined


def _seed_skill_data(staging_dir: Path, tool_name: str) -> Path:
    skill_data_dir = staging_dir / "skill_data"
    skill_data_dir.mkdir(parents=True, exist_ok=True)
    data_path = skill_data_dir / f"{tool_name}.json"
    data_path.write_text(
        json.dumps(dict(DEFAULT_SKILL_DATA), indent=2) + "\n",
        encoding="utf-8",
    )
    return skill_data_dir


def _sandbox_volumes(host_workspace: str, skill_data_host: str | None) -> dict:
    """Mount /workspace read-only; bind skill_data read-write when present."""
    volumes: dict = {
        host_workspace: {"bind": "/workspace", "mode": "ro"},
    }
    if skill_data_host:
        volumes[skill_data_host] = {"bind": "/workspace/skill_data", "mode": "rw"}
    return volumes


def verify_tool_in_sandbox(
    tool_name: str,
    tool_code: str,
    test_code: str,
    *,
    manifest: dict | None = None,
) -> tuple[bool, str]:
    available, reason = check_docker_available()
    if not available:
        return False, reason

    client = docker.from_env()
    staging_host = _get_staging_host_path(client)
    if not staging_host:
        return False, (
            "Sandbox staging volume is not configured. Add "
            "./chat/staging:/app/staging to the chat service in docker-compose.yml."
        )

    staging_dir = STAGING_DIR / tool_name
    _cleanup_staging(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)

    (staging_dir / f"{tool_name}.py").write_text(tool_code, encoding="utf-8")
    (staging_dir / "test_run.py").write_text(test_code, encoding="utf-8")

    skill_data_host: str | None = None
    if manifest and manifest.get("kind") == "interactive":
        _seed_skill_data(staging_dir, tool_name)
        skill_data_host = str(Path(staging_host) / tool_name / "skill_data")

    host_workspace = str(Path(staging_host) / tool_name)
    container = None
    try:
        container = client.containers.run(
            image=SANDBOX_IMAGE,
            command="python /workspace/test_run.py",
            volumes=_sandbox_volumes(host_workspace, skill_data_host),
            detach=True,
            network_disabled=True,
            mem_limit=SANDBOX_MEM_LIMIT,
        )
        result = container.wait(timeout=SANDBOX_TIMEOUT)
        stdout = container.logs(stdout=True, stderr=False).decode("utf-8", errors="replace")
        stderr = container.logs(stdout=False, stderr=True).decode("utf-8", errors="replace")

        if result.get("StatusCode", 1) != 0:
            log_output = _format_sandbox_logs(
                stdout, stderr, result.get("StatusCode", 1)
            )
            if not stdout.strip() and not stderr.strip():
                log_output += f"\nContainer exited with code {result.get('StatusCode')}"
            return False, log_output

        return True, stdout or "Tests passed."
    except docker.errors.ContainerError as exc:
        stderr_text = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else str(exc)
        stdout_text = exc.stdout.decode("utf-8", errors="replace") if exc.stdout else ""
        return False, _format_sandbox_logs(stdout_text, stderr_text)
    except Exception as exc:
        return False, _format_sandbox_logs("", str(exc))
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except Exception as exc:
                logger.warning("Failed to remove sandbox container: %s", exc)
        _cleanup_staging(staging_dir)
