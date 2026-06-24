"""Interactive skill UI QA between sandbox pass and human preview."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable

from tool_creator import fix_preview_issues, review_interactive_preview
from tools_engine import validate_ui_files, verify_skill_api_contract

StepFn = Callable[..., str]
BlogFn = Callable[..., str]
CancelledFn = Callable[[], Awaitable[bool]]


async def stream_interactive_ui_qa(
    *,
    run_id: str,
    tool_name: str,
    tool_code: str,
    test_code: str,
    manifest: dict | None,
    ui_files: dict[str, str] | None,
    creator_model: str,
    litellm_url: str,
    headers: dict[str, str],
    reasoning_effort: str | None,
    step: StepFn,
    phase: StepFn,
    blog: BlogFn,
    cancelled: CancelledFn,
) -> AsyncIterator[tuple[str, bool, str, str, dict | None, dict[str, str] | None]]:
    """Yield (sse_event, done, tool_code, test_code, manifest, ui_files)."""
    if not manifest or manifest.get("kind") != "interactive":
        yield ("", True, tool_code, test_code, manifest, ui_files)
        return

    current_tool = tool_code
    current_test = test_code
    current_manifest = manifest
    current_ui = ui_files
    fix_attempted = False

    while True:
        if await cancelled():
            yield ("", False, current_tool, current_test, current_manifest, current_ui)
            return

        yield (
            step("validate_ui", "Validating app UI", "active"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )
        yield (phase("validate_ui", "active"), False, current_tool, current_test, current_manifest, current_ui)
        yield (
            blog("Validating interactive UI files and SDK usage…"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )

        ui_ok, ui_reason = validate_ui_files(current_ui, current_manifest, tool_name)
        if not ui_ok:
            if not fix_attempted:
                fix_attempted = True
                yield (
                    blog(f"UI validation failed — auto-fixing: {ui_reason}", level="warn"),
                    False,
                    current_tool,
                    current_test,
                    current_manifest,
                    current_ui,
                )
                try:
                    (
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                    ) = await fix_preview_issues(
                        tool_name,
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                        [ui_reason],
                        creator_model,
                        litellm_url=litellm_url,
                        headers=headers,
                        run_id=run_id,
                        reasoning_effort=reasoning_effort,
                    )
                    continue
                except Exception as exc:
                    yield (
                        step("validate_ui", "Validating app UI", "error", detail=str(exc)[:200]),
                        False,
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                    )
                    yield ("", False, current_tool, current_test, current_manifest, current_ui)
                    return
            yield (
                step("validate_ui", "Validating app UI", "error", detail=ui_reason[:200]),
                False,
                current_tool,
                current_test,
                current_manifest,
                current_ui,
            )
            yield ("", False, current_tool, current_test, current_manifest, current_ui)
            return

        yield (
            step("validate_ui", "Validating app UI", "done"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )
        yield (phase("validate_ui", "done"), False, current_tool, current_test, current_manifest, current_ui)

        yield (
            step("contract_test", "Testing skill API contract", "active"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )
        yield (phase("contract_test", "active"), False, current_tool, current_test, current_manifest, current_ui)
        yield (
            blog("Running API contract tests for interactive actions…"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )

        contract_ok, contract_reason = verify_skill_api_contract(
            tool_name, current_tool, current_manifest
        )
        if not contract_ok:
            if not fix_attempted:
                fix_attempted = True
                yield (
                    blog(f"Contract test failed — auto-fixing: {contract_reason}", level="warn"),
                    False,
                    current_tool,
                    current_test,
                    current_manifest,
                    current_ui,
                )
                try:
                    (
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                    ) = await fix_preview_issues(
                        tool_name,
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                        [contract_reason],
                        creator_model,
                        litellm_url=litellm_url,
                        headers=headers,
                        run_id=run_id,
                        reasoning_effort=reasoning_effort,
                    )
                    continue
                except Exception as exc:
                    yield (
                        step(
                            "contract_test",
                            "Testing skill API contract",
                            "error",
                            detail=str(exc)[:200],
                        ),
                        False,
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                    )
                    yield ("", False, current_tool, current_test, current_manifest, current_ui)
                    return
            yield (
                step("contract_test", "Testing skill API contract", "error", detail=contract_reason[:200]),
                False,
                current_tool,
                current_test,
                current_manifest,
                current_ui,
            )
            yield ("", False, current_tool, current_test, current_manifest, current_ui)
            return

        yield (
            step("contract_test", "Testing skill API contract", "done"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )
        yield (phase("contract_test", "done"), False, current_tool, current_test, current_manifest, current_ui)

        yield (
            step("preview_review", "Automated app review", "active"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )
        yield (phase("preview_review", "active"), False, current_tool, current_test, current_manifest, current_ui)
        yield (
            blog("Running automated preview review…"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )

        review_ok, review_issues = await review_interactive_preview(
            tool_name,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
            creator_model,
            litellm_url=litellm_url,
            headers=headers,
            run_id=run_id,
            reasoning_effort=reasoning_effort,
        )
        if not review_ok:
            if not fix_attempted:
                fix_attempted = True
                summary = "; ".join(review_issues) or "Preview review failed."
                yield (
                    blog(f"Preview review flagged issues — auto-fixing: {summary}", level="warn"),
                    False,
                    current_tool,
                    current_test,
                    current_manifest,
                    current_ui,
                )
                try:
                    (
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                    ) = await fix_preview_issues(
                        tool_name,
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                        review_issues or ["Preview review failed."],
                        creator_model,
                        litellm_url=litellm_url,
                        headers=headers,
                        run_id=run_id,
                        reasoning_effort=reasoning_effort,
                    )
                    continue
                except Exception as exc:
                    yield (
                        step("preview_review", "Automated app review", "error", detail=str(exc)[:200]),
                        False,
                        current_tool,
                        current_test,
                        current_manifest,
                        current_ui,
                    )
                    yield ("", False, current_tool, current_test, current_manifest, current_ui)
                    return
            summary = "; ".join(review_issues) or "Preview review failed."
            yield (
                step("preview_review", "Automated app review", "error", detail=summary[:200]),
                False,
                current_tool,
                current_test,
                current_manifest,
                current_ui,
            )
            yield ("", False, current_tool, current_test, current_manifest, current_ui)
            return

        yield (
            step("preview_review", "Automated app review", "done"),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )
        yield (phase("preview_review", "done"), False, current_tool, current_test, current_manifest, current_ui)
        yield (
            blog("Automated preview review passed."),
            False,
            current_tool,
            current_test,
            current_manifest,
            current_ui,
        )
        yield ("", True, current_tool, current_test, current_manifest, current_ui)
        return
