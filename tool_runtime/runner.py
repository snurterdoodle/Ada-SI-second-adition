import importlib.util
import json
import logging
import os
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

TOOLS_DIR = Path(os.environ.get("TOOLS_DIR", "/app/custom_tools"))
VENV_PATH = Path(os.environ.get("VENV_PATH", "/app/venv"))
MANIFEST_PATH = TOOLS_DIR / ".venv_manifest.json"


def venv_python() -> Path:
    py = VENV_PATH / "bin" / "python"
    if not py.exists():
        py = VENV_PATH / "Scripts" / "python.exe"
    return py


def ensure_venv() -> None:
    py = venv_python()
    if py.exists():
        return
    VENV_PATH.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [sys.executable, "-m", "venv", str(VENV_PATH)],
        check=True,
        capture_output=True,
        text=True,
    )


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {"approved_packages": []}
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"approved_packages": []}


def save_manifest(manifest: dict) -> None:
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def normalize_requirements(requirements: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for req in requirements:
        req = str(req).strip()
        if not req or req in seen:
            continue
        seen.add(req)
        out.append(req)
    return out


def pip_install(requirements: list[str]) -> tuple[bool, str]:
    if not requirements:
        return True, "No packages to install."
    ensure_venv()
    py = venv_python()
    cmd = [str(py), "-m", "pip", "install", "--disable-pip-version-check", *requirements]
    logger.info("Running pip install: %s", " ".join(requirements))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return False, output
    manifest = load_manifest()
    approved = set(manifest.get("approved_packages") or [])
    approved.update(requirements)
    manifest["approved_packages"] = sorted(approved)
    save_manifest(manifest)
    return True, output


def _load_module_from_file(file: Path):
    spec = importlib.util.spec_from_file_location(file.stem, file)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {file}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def list_tools() -> list[dict]:
    summaries: list[dict] = []
    ensure_venv()
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
                    "schema": schema,
                }
            )
        except Exception as exc:
            logger.warning("Skipping tool %s: %s", file.name, exc)
    return summaries


def run_tool(name: str, arguments: dict) -> str:
    file = TOOLS_DIR / f"{name}.py"
    if not file.exists():
        raise FileNotFoundError(f"Tool '{name}' not found.")
    mod = _load_module_from_file(file)
    if not hasattr(mod, "run"):
        raise ValueError(f"Tool '{name}' has no run() function.")
    result = mod.run(**arguments)
    if isinstance(result, str):
        return result
    return json.dumps(result)


def verify_tool_in_runtime(tool_name: str, test_code: str) -> tuple[bool, str]:
    ensure_venv()
    py = venv_python()
    test_path = TOOLS_DIR / f".verify_{tool_name}_test_run.py"
    try:
        test_path.write_text(test_code, encoding="utf-8")
        proc = subprocess.run(
            [str(py), str(test_path)],
            cwd=str(TOOLS_DIR),
            capture_output=True,
            text=True,
            timeout=60,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        if proc.returncode != 0:
            return False, output
        return True, output or "Runtime tests passed."
    finally:
        if test_path.exists():
            test_path.unlink()


def install_tool(
    tool_name: str,
    tool_code: str,
    test_code: str,
    requirements: list[str],
    *,
    skip_pip: bool = False,
) -> tuple[bool, str]:
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    (TOOLS_DIR / f"{tool_name}.py").write_text(tool_code, encoding="utf-8")
    req_file = TOOLS_DIR / f"{tool_name}.requirements.txt"
    reqs = normalize_requirements(requirements)
    if reqs:
        req_file.write_text("\n".join(reqs) + "\n", encoding="utf-8")
    elif req_file.exists():
        req_file.unlink()

    logs: list[str] = []
    if not skip_pip and reqs:
        ok, pip_log = pip_install(reqs)
        logs.append(pip_log)
        if not ok:
            return False, "\n".join(logs)

    ok, verify_log = verify_tool_in_runtime(tool_name, test_code)
    logs.append(verify_log)
    return ok, "\n".join(logs)


def delete_tool(tool_name: str) -> None:
    for path in (
        TOOLS_DIR / f"{tool_name}.py",
        TOOLS_DIR / f"{tool_name}.requirements.txt",
    ):
        if path.exists():
            path.unlink()
