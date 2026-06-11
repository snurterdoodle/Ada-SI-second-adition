"""Shared tool build/install pipeline for approve_tool and approve_pip streams."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, Callable

from debug_log import log_build_event, log_pip_install, log_runtime_call
from runtime_client import runtime_install_tool, runtime_pip_install
from sandbox import verify_tool_in_sandbox
from tool_creator import fix_test_code, validate_test_code
from tools_engine import get_new_packages_for_requirements, validate_tool_module, write_tool_files

PENDING_PIP_INSTALLS: dict[str, dict] = {}
PIP_TTL_SECONDS = 3600


def cleanup_expired_pip_installs() -> None:
    now = time.time()
    expired = [
        pip_id
        for pip_id, data in PENDING_PIP_INSTALLS.items()
        if now - data.get("created_at", now) > PIP_TTL_SECONDS
    ]
    for pip_id in expired:
        del PENDING_PIP_INSTALLS[pip_id]


def get_pending_pip(pip_id: str) -> dict:
    cleanup_expired_pip_installs()
    data = PENDING_PIP_INSTALLS.get(pip_id)
    if data is None:
        raise ValueError("Pip install request not found or expired.")
    return data


async def stream_runtime_install(
    *,
    run_id: str,
    plan_id: str,
    tool_name: str,
    tool_code: str,
    test_code: str,
    requirements: list[str],
    new_packages: list[str],
    creator_model: str,
    litellm_url: str,
    litellm_headers: dict[str, str],
    step: Callable[..., str],
    phase: Callable[..., str],
    blog: Callable[..., str],
    sse_data: Callable[[dict], str],
    cancelled: Callable[[], Any],
    skip_pip: bool = False,
) -> AsyncIterator[str]:
    """Install into tool runtime after pip approval (or when no new packages)."""

    if new_packages and not skip_pip:
        yield step("pip_review", "Installing approved pip packages", "active")
        yield phase("pip_review", "active")
        try:
            pip_log = await runtime_pip_install(new_packages)
            log_pip_install(run_id, packages=new_packages, logs=pip_log, approved=True)
            yield blog(f"Installed pip packages: {', '.join(new_packages)}")
        except Exception as exc:
            log_pip_install(
                run_id, packages=new_packages, logs=str(exc), approved=True, error=True
            )
            yield step("pip_review", "Installing approved pip packages", "error", detail=str(exc))
            yield phase("pip_review", "error", detail=str(exc))
            yield sse_data(
                {
                    "ada_event": "tool_build_failed",
                    "run_id": run_id,
                    "tool_name": tool_name,
                    "reason": f"Pip install failed: {exc}",
                }
            )
            yield "data: [DONE]\n\n"
            return
        yield step("pip_review", "Installing approved pip packages", "done")
        yield phase("pip_review", "done")

    if await cancelled():
        return

    yield step("runtime_verify", "Verifying in tool runtime", "active")
    yield phase("runtime_verify", "active")
    yield blog("Installing tool in persistent runtime and running tests…")

    try:
        logs = await runtime_install_tool(
            tool_name,
            tool_code,
            test_code,
            requirements,
            skip_pip=True,
        )
        log_runtime_call(run_id, action="install", tool_name=tool_name, logs=logs)
        write_tool_files(tool_name, tool_code, requirements, test_code)
        yield blog("Runtime verification passed.")
    except Exception as exc:
        log_runtime_call(
            run_id, action="install", tool_name=tool_name, logs=str(exc), error=True
        )
        yield step("runtime_verify", "Verifying in tool runtime", "error", detail=str(exc))
        yield phase("runtime_verify", "error", detail=str(exc))
        yield sse_data(
            {
                "ada_event": "tool_build_failed",
                "run_id": run_id,
                "tool_name": tool_name,
                "reason": f"Runtime verification failed: {exc}",
            }
        )
        yield "data: [DONE]\n\n"
        return

    yield step("runtime_verify", "Verifying in tool runtime", "done")
    yield phase("runtime_verify", "done")

    yield step("install_tool", "Installing tool", "done")
    yield phase("install_tool", "done")
    yield blog("Tool installed successfully.")
    log_build_event(
        run_id,
        phase="install_tool",
        message=f"installed {tool_name} via tool runtime",
    )
    yield sse_data(
        {
            "ada_event": "tool_installed",
            "run_id": run_id,
            "tool_name": tool_name,
            "message": f"Tool '{tool_name}' installed in the persistent tool runtime.",
        }
    )
    yield "data: [DONE]\n\n"


async def maybe_pause_for_pip_approval(
    *,
    run_id: str,
    plan_id: str,
    tool_name: str,
    tool_code: str,
    test_code: str,
    requirements: list[str],
    creator_model: str,
    step: Callable[..., str],
    phase: Callable[..., str],
    sse_data: Callable[[dict], str],
) -> tuple[bool, AsyncIterator[str] | None, list[str]]:
    """Return (paused, pause_event_stream, new_packages)."""
    new_packages, already_installed = await get_new_packages_for_requirements(requirements)
    if not new_packages:
        return False, None, []

    pip_id = uuid.uuid4().hex
    PENDING_PIP_INSTALLS[pip_id] = {
        "pip_id": pip_id,
        "run_id": run_id,
        "plan_id": plan_id,
        "tool_name": tool_name,
        "packages": new_packages,
        "already_installed": already_installed,
        "tool_code": tool_code,
        "test_code": test_code,
        "requirements": requirements,
        "creator_model": creator_model,
        "created_at": time.time(),
    }

    async def _pause_events() -> AsyncIterator[str]:
        yield step(
            "pip_review",
            "Awaiting pip install approval",
            "active",
            detail=", ".join(new_packages),
        )
        yield phase("pip_review", "active")
        yield sse_data(
            {
                "ada_event": "pip_install_pending",
                "pip_id": pip_id,
                "run_id": run_id,
                "plan_id": plan_id,
                "tool_name": tool_name,
                "packages": new_packages,
                "already_installed": already_installed,
            }
        )
        yield "data: [DONE]\n\n"

    return True, _pause_events(), new_packages


async def run_sandbox_phase(
    *,
    run_id: str,
    tool_name: str,
    tool_code: str,
    test_code: str,
    creator_model: str,
    litellm_url: str,
    headers: dict[str, str],
    step: Callable[..., str],
    phase: Callable[..., str],
    blog: Callable[..., str],
    sse_data: Callable[[dict], str],
    cancelled: Callable[[], Any],
) -> tuple[bool, str, str]:
    """Run sandbox with one auto-retry. Returns (success, log_output, test_code)."""
    log_output = ""
    current_test = test_code
    for attempt in range(2):
        if await cancelled():
            return False, log_output, current_test

        success, log_output = verify_tool_in_sandbox(tool_name, tool_code, current_test)
        if success:
            return True, log_output, current_test

        if attempt == 0:
            try:
                current_test = await fix_test_code(
                    tool_name,
                    tool_code,
                    current_test,
                    log_output,
                    creator_model,
                    litellm_url=litellm_url,
                    headers=headers,
                    run_id=run_id,
                )
                continue
            except Exception:
                pass
        return False, log_output, current_test
    return False, log_output, current_test
