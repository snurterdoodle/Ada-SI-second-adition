import json
import logging
import os
import time
import uuid
from pathlib import Path

import httpx
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from build_pipeline import (
    PENDING_PIP_INSTALLS,
    PHASE_MAX_RETRIES,
    get_pending_pip,
    maybe_pause_for_pip_approval,
    run_sandbox_phase,
    stream_runtime_install,
)
from debug_log import (
    configure_logging,
    log_assistant_turn,
    log_build_event,
    log_chat_request,
    log_debug,
    log_error,
    log_generated_code,
    log_pip_install,
    log_sandbox,
    log_stream_delta,
    log_tool_execution,
)
from litellm_client import (
    SSE_HEADERS,
    extract_stream_delta,
    extract_stream_tool_calls,
    merge_tool_call_delta,
    new_stream_chunk_id,
    openai_stream_chunk,
    stream_chat_completion,
    tool_calls_from_acc,
)
from runtime_client import runtime_health, set_runtime_url
from sandbox import check_docker_available, verify_tool_in_sandbox
from tool_creator import (
    draft_tool_edit_plan,
    draft_tool_plan,
    fix_validation_errors,
    generate_tool_code_stream,
    parse_generated_tool_response,
    repair_generated_tool_response,
    revise_tool_plan,
    validate_test_code,
)
from tools_engine import (
    aload_dynamic_tools,
    alist_tool_summaries,
    delete_tool_async,
    execute_dynamic_tool,
    prepare_agent_messages,
    read_tool_file,
    read_tool_requirements,
    read_tool_test,
    tool_exists,
    validate_tool_module,
)

configure_logging()
logger = logging.getLogger(__name__)

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000").rstrip("/")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
LITE_MODEL = (
    os.environ.get("LITE_MODEL", "").strip()
    or os.environ.get("CHAT_MODEL", "").strip()
)
TOOL_CREATOR_MODEL = (
    os.environ.get("TOOL_CREATOR_MODEL", "").strip()
    or os.environ.get("SECOND_MODEL", "").strip()
)
TOOL_RUNTIME_URL = os.environ.get("TOOL_RUNTIME_URL", "http://tool-runtime:8090").rstrip(
    "/"
)

STATIC_DIR = Path(__file__).parent / "static"
MAX_TOOL_ITERATIONS = 5
PLAN_TTL_SECONDS = 3600

PENDING_PLANS: dict[str, dict] = {}
RUN_CANCEL_FLAGS: set[str] = set()

app = FastAPI(title="Ada-SI Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
async def startup_check() -> None:
    set_runtime_url(TOOL_RUNTIME_URL)
    available, reason = check_docker_available()
    if available:
        logger.info("Docker sandbox is available.")
    else:
        logger.warning("Docker sandbox unavailable: %s", reason)
    runtime_ok, runtime_reason = await runtime_health()
    if runtime_ok:
        logger.info("Tool runtime is available at %s.", TOOL_RUNTIME_URL)
    else:
        logger.warning("Tool runtime unavailable: %s", runtime_reason)


def litellm_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if LITELLM_MASTER_KEY:
        headers["Authorization"] = f"Bearer {LITELLM_MASTER_KEY}"
    return headers


def cleanup_expired_plans() -> None:
    now = time.time()
    expired = [
        plan_id
        for plan_id, plan in PENDING_PLANS.items()
        if now - plan["created_at"] > PLAN_TTL_SECONDS
    ]
    for plan_id in expired:
        del PENDING_PLANS[plan_id]


def get_pending_plan(plan_id: str) -> dict:
    cleanup_expired_plans()
    plan = PENDING_PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found or expired.")
    return plan


def is_run_cancelled(run_id: str) -> bool:
    return bool(run_id and run_id in RUN_CANCEL_FLAGS)


def mark_run_cancelled(run_id: str) -> None:
    if run_id:
        RUN_CANCEL_FLAGS.add(run_id)


def clear_run_cancelled(run_id: str) -> None:
    RUN_CANCEL_FLAGS.discard(run_id)


def cancelled_events(run_id: str, step_id: str, *, model: str = "") -> list[str]:
    events = [
        process_step(run_id, step_id, "Stopped by user", "error"),
        sse_data({"ada_event": "run_cancelled", "run_id": run_id}),
        "data: [DONE]\n\n",
    ]
    if model:
        events[0] = process_step(
            run_id, step_id, "Stopped by user", "error", model=model
        )
    return events


async def stream_lite_model_turn(
    run_id: str,
    lite_model: str,
    working_messages: list[dict],
    tools: list[dict],
):
    """Stream one lite-model completion; yield OpenAI SSE strings and final message."""
    chunk_id = new_stream_chunk_id()
    tool_calls_acc: dict[int, dict] = {}
    content_acc = ""
    reasoning_acc = ""
    saw_tool_call = False

    log_debug(run_id, "LITE_MODEL", f"streaming completion model={lite_model}")

    async for chunk in stream_chat_completion(
        LITELLM_URL,
        litellm_headers(),
        lite_model,
        working_messages,
        tools=tools,
    ):
        tc_deltas = extract_stream_tool_calls(chunk)
        if tc_deltas:
            saw_tool_call = True
            merge_tool_call_delta(tool_calls_acc, tc_deltas)
            log_stream_delta(run_id, "lite_model", "tool_call_fragment", str(tc_deltas))

        delta = extract_stream_delta(chunk)
        if delta["reasoning"]:
            reasoning_acc += delta["reasoning"]
            log_stream_delta(run_id, "lite_model", "reasoning", delta["reasoning"])
            yield sse_data(
                openai_stream_chunk(
                    chunk_id=chunk_id,
                    reasoning=delta["reasoning"],
                )
            )
        if delta["content"]:
            content_acc += delta["content"]
            log_stream_delta(run_id, "lite_model", "content", delta["content"])
            if not saw_tool_call:
                yield sse_data(
                    openai_stream_chunk(
                        chunk_id=chunk_id,
                        content=delta["content"],
                    )
                )

    tool_calls = tool_calls_from_acc(tool_calls_acc)
    message: dict = {"role": "assistant", "content": content_acc or None}
    if tool_calls:
        message["tool_calls"] = tool_calls

    log_assistant_turn(
        run_id,
        model=lite_model,
        content=content_acc,
        reasoning=reasoning_acc,
        tool_calls=tool_calls,
    )

    yield sse_data(
        openai_stream_chunk(chunk_id=chunk_id, finish_reason="stop")
    )
    yield {"_event": "message", "message": message, "tool_calls": tool_calls}


def parse_tool_arguments(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Model returned invalid tool arguments: {raw}",
        ) from exc


def sse_data(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def process_step(
    run_id: str,
    step_id: str,
    label: str,
    status: str,
    *,
    model: str = "",
    detail: str = "",
) -> str:
    return sse_data(
        {
            "ada_event": "process_step",
            "run_id": run_id,
            "step_id": step_id,
            "label": label,
            "status": status,
            "model": model,
            "detail": detail,
        }
    )


def tool_build_phase(
    run_id: str, phase: str, status: str, *, detail: str = ""
) -> str:
    return sse_data(
        {
            "ada_event": "tool_build_phase",
            "run_id": run_id,
            "phase": phase,
            "status": status,
            "detail": detail,
        }
    )


def tool_build_log(run_id: str, message: str, *, level: str = "info") -> str:
    return sse_data(
        {
            "ada_event": "tool_build_log",
            "run_id": run_id,
            "level": level,
            "message": message,
        }
    )


async def run_agent_stream(
    run_id: str,
    lite_model: str,
    tool_creator_model: str,
    messages: list[dict],
    request: Request,
):
    """Async generator that yields SSE strings as each process step occurs."""
    clear_run_cancelled(run_id)
    yield process_step(
        run_id, "lite_model", "Lite model processing", "active", model=lite_model
    )

    tools = await aload_dynamic_tools()
    working_messages = prepare_agent_messages(messages)
    tool_names = [
        (t.get("function") or t).get("name", "?") for t in tools
    ]
    log_chat_request(
        run_id,
        lite_model=lite_model,
        tool_creator_model=tool_creator_model,
        message_count=len(working_messages),
        tool_names=tool_names,
    )

    for iteration in range(MAX_TOOL_ITERATIONS):
        log_debug(run_id, "AGENT", f"iteration {iteration + 1}/{MAX_TOOL_ITERATIONS}")
        if is_run_cancelled(run_id) or await request.is_disconnected():
            for event in cancelled_events(run_id, "lite_model", model=lite_model):
                yield event
            return

        message = None
        tool_calls: list[dict] = []

        async for item in stream_lite_model_turn(
            run_id, lite_model, working_messages, tools
        ):
            if isinstance(item, str):
                yield item
                continue
            if item.get("_event") == "message":
                message = item["message"]
                tool_calls = item["tool_calls"]

        if message is None:
            raise HTTPException(status_code=502, detail="LiteLLM returned no response.")

        if tool_calls:
            yield process_step(
                run_id, "lite_model", "Lite model processing", "done", model=lite_model
            )
            working_messages.append(message)

            for tool_call in tool_calls:
                if is_run_cancelled(run_id) or await request.is_disconnected():
                    for event in cancelled_events(run_id, "lite_model", model=lite_model):
                        yield event
                    return

                fn = tool_call.get("function", {})
                name = fn.get("name", "")
                args = parse_tool_arguments(fn.get("arguments", "{}"))

                if name == "generate_new_tool":
                    tool_name = args.get("tool_name", "").strip()
                    description = args.get("description", "").strip()
                    log_tool_execution(
                        run_id,
                        name=name,
                        arguments=args,
                        result="(routing to tool creator)",
                    )
                    if not tool_name or not description:
                        raise HTTPException(
                            status_code=502,
                            detail="generate_new_tool missing tool_name or description.",
                        )
                    if not tool_creator_model:
                        raise HTTPException(
                            status_code=400,
                            detail="No tool creator model configured. Select one in the UI.",
                        )

                    yield process_step(
                        run_id,
                        "route_creator",
                        "Routed to tool creator",
                        "active",
                        model=tool_creator_model,
                    )
                    yield process_step(
                        run_id,
                        "route_creator",
                        "Routed to tool creator",
                        "done",
                        model=tool_creator_model,
                    )
                    yield process_step(
                        run_id,
                        "plan_draft",
                        "Drafting tool plan",
                        "active",
                        model=tool_creator_model,
                    )

                    if is_run_cancelled(run_id) or await request.is_disconnected():
                        for event in cancelled_events(
                            run_id, "plan_draft", model=tool_creator_model
                        ):
                            yield event
                        return

                    plan = await draft_tool_plan(
                        tool_name,
                        description,
                        tool_creator_model,
                        litellm_url=LITELLM_URL,
                        headers=litellm_headers(),
                        run_id=run_id,
                    )

                    if is_run_cancelled(run_id) or await request.is_disconnected():
                        for event in cancelled_events(
                            run_id, "plan_draft", model=tool_creator_model
                        ):
                            yield event
                        return

                    yield process_step(
                        run_id,
                        "plan_draft",
                        "Drafting tool plan",
                        "done",
                        model=tool_creator_model,
                    )
                    yield process_step(
                        run_id,
                        "plan_ready",
                        "Plan ready for approval",
                        "done",
                        detail=tool_name,
                    )
                    yield process_step(
                        run_id,
                        "awaiting_approval",
                        "Awaiting your approval",
                        "active",
                        detail=tool_name,
                    )

                    plan_id = uuid.uuid4().hex
                    PENDING_PLANS[plan_id] = {
                        "tool_name": tool_name,
                        "description": description,
                        "plan": plan,
                        "creator_model": tool_creator_model,
                        "created_at": time.time(),
                        "run_id": run_id,
                    }
                    yield {
                        "_event": "plan",
                        "plan_id": plan_id,
                        "run_id": run_id,
                        "tool_name": tool_name,
                        "plan": plan,
                        "kind": "create",
                    }
                    return

                if name == "edit_existing_tool":
                    tool_name = args.get("tool_name", "").strip()
                    description = args.get("description", "").strip()
                    log_tool_execution(
                        run_id,
                        name=name,
                        arguments=args,
                        result="(routing to tool editor)",
                    )
                    if not tool_name or not description:
                        raise HTTPException(
                            status_code=502,
                            detail="edit_existing_tool missing tool_name or description.",
                        )
                    if not tool_exists(tool_name):
                        raise HTTPException(
                            status_code=404,
                            detail=f"Tool '{tool_name}' is not installed.",
                        )
                    if not tool_creator_model:
                        raise HTTPException(
                            status_code=400,
                            detail="No tool creator model configured. Select one in the UI.",
                        )

                    existing_code = read_tool_file(tool_name)
                    existing_reqs = read_tool_requirements(tool_name)
                    existing_test = read_tool_test(tool_name)

                    yield process_step(
                        run_id,
                        "route_creator",
                        "Routed to tool editor",
                        "active",
                        model=tool_creator_model,
                    )
                    yield process_step(
                        run_id,
                        "route_creator",
                        "Routed to tool editor",
                        "done",
                        model=tool_creator_model,
                    )
                    yield process_step(
                        run_id,
                        "plan_draft",
                        "Drafting tool edit plan",
                        "active",
                        model=tool_creator_model,
                    )

                    plan = await draft_tool_edit_plan(
                        tool_name,
                        description,
                        existing_code,
                        existing_reqs,
                        tool_creator_model,
                        litellm_url=LITELLM_URL,
                        headers=litellm_headers(),
                        run_id=run_id,
                    )

                    yield process_step(
                        run_id,
                        "plan_draft",
                        "Drafting tool edit plan",
                        "done",
                        model=tool_creator_model,
                    )
                    yield process_step(
                        run_id,
                        "plan_ready",
                        "Edit plan ready for approval",
                        "done",
                        detail=tool_name,
                    )
                    yield process_step(
                        run_id,
                        "awaiting_approval",
                        "Awaiting your approval",
                        "active",
                        detail=tool_name,
                    )

                    plan_id = uuid.uuid4().hex
                    PENDING_PLANS[plan_id] = {
                        "kind": "edit",
                        "tool_name": tool_name,
                        "description": description,
                        "plan": plan,
                        "creator_model": tool_creator_model,
                        "created_at": time.time(),
                        "run_id": run_id,
                        "edit_context": {
                            "tool_code": existing_code,
                            "requirements": existing_reqs,
                            "test_code": existing_test,
                        },
                    }
                    yield {
                        "_event": "plan",
                        "plan_id": plan_id,
                        "run_id": run_id,
                        "tool_name": tool_name,
                        "plan": plan,
                        "kind": "edit",
                    }
                    return

                yield process_step(
                    run_id,
                    "tool_execute",
                    f"Executing tool: {name}",
                    "active",
                    detail=name,
                )

                try:
                    result = await execute_dynamic_tool(name, args, run_id=run_id)
                    log_tool_execution(
                        run_id, name=name, arguments=args, result=result
                    )
                    yield process_step(
                        run_id,
                        "tool_execute",
                        f"Executing tool: {name}",
                        "done",
                        detail=name,
                    )
                except Exception as exc:
                    result = f"Tool execution failed: {exc}"
                    log_tool_execution(
                        run_id,
                        name=name,
                        arguments=args,
                        result="",
                        error=str(exc),
                    )
                    yield process_step(
                        run_id,
                        "tool_execute",
                        f"Executing tool: {name}",
                        "error",
                        detail=str(exc),
                    )

                working_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call["id"],
                        "content": result,
                    }
                )

            yield process_step(
                run_id, "lite_model", "Lite model processing", "active", model=lite_model
            )
            continue

        yield process_step(
            run_id, "lite_model", "Lite model responded", "done", model=lite_model
        )
        yield {"_event": "done"}
        return

    raise HTTPException(
        status_code=502,
        detail=f"Exceeded maximum tool iterations ({MAX_TOOL_ITERATIONS}).",
    )


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
async def get_config() -> dict:
    docker_ok, docker_message = check_docker_available()
    return {
        "lite_model": LITE_MODEL,
        "tool_creator_model": TOOL_CREATOR_MODEL,
        "chat_model": LITE_MODEL,
        "second_model": TOOL_CREATOR_MODEL,
        "tools": await alist_tool_summaries(),
        "docker_available": docker_ok,
        "docker_message": docker_message if not docker_ok else "",
        "tool_runtime_available": (await runtime_health())[0],
        "tool_runtime_url": TOOL_RUNTIME_URL,
    }


@app.get("/api/tools")
async def list_tools() -> dict:
    return {"tools": await alist_tool_summaries()}


@app.delete("/api/tools/{tool_name}")
async def remove_tool(tool_name: str) -> dict:
    try:
        await delete_tool_async(tool_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "deleted", "tool_name": tool_name}


@app.get("/api/models")
async def list_models() -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        for path in ("/v1/models", "/models"):
            response = await client.get(f"{LITELLM_URL}{path}", headers=litellm_headers())
            if response.status_code == 200:
                return response.json()

        raise HTTPException(
            status_code=response.status_code,
            detail=response.text or "Failed to fetch models from LiteLLM",
        )


@app.post("/api/chat")
async def chat(request: Request) -> StreamingResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc

    lite_model = (body.get("model") or LITE_MODEL).strip()
    tool_creator_model = (
        body.get("tool_creator_model") or TOOL_CREATOR_MODEL
    ).strip()
    messages = body.get("messages")
    run_id = body.get("run_id") or uuid.uuid4().hex

    if not lite_model:
        raise HTTPException(status_code=400, detail="No lite model selected.")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages must be a non-empty list.")

    async def event_stream():
        try:
            async for item in run_agent_stream(
                run_id, lite_model, tool_creator_model, messages, request
            ):
                if await request.is_disconnected():
                    return

                if isinstance(item, str):
                    yield item
                    continue

                if item.get("_event") == "plan":
                    yield sse_data(
                        {
                            "ada_event": "tool_plan_pending",
                            "run_id": item["run_id"],
                            "plan_id": item["plan_id"],
                            "tool_name": item["tool_name"],
                            "plan": item["plan"],
                            "kind": item.get("kind", "create"),
                        }
                    )
                    yield "data: [DONE]\n\n"
                    return

                if item.get("_event") == "done":
                    yield "data: [DONE]\n\n"
                    return
        except HTTPException as exc:
            log_error(run_id, "CHAT", f"HTTPException: {exc.detail}")
            yield process_step(
                run_id,
                "lite_model",
                "Request failed",
                "error",
                detail=str(exc.detail),
            )
            yield sse_data({"ada_event": "chat_error", "run_id": run_id, "detail": exc.detail})
            yield "data: [DONE]\n\n"
        except httpx.RequestError as exc:
            detail = f"LiteLLM unreachable: {exc}"
            log_error(run_id, "CHAT", detail)
            yield process_step(run_id, "lite_model", "Request failed", "error", detail=detail)
            yield sse_data({"ada_event": "chat_error", "run_id": run_id, "detail": detail})
            yield "data: [DONE]\n\n"
        except RuntimeError as exc:
            log_error(run_id, "CHAT", str(exc))
            yield process_step(run_id, "lite_model", "Request failed", "error", detail=str(exc))
            yield sse_data({"ada_event": "chat_error", "run_id": run_id, "detail": str(exc)})
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(), media_type="text/event-stream", headers=SSE_HEADERS
    )


@app.post("/api/cancel_run")
async def cancel_run(payload: dict = Body(...)) -> dict:
    run_id = payload.get("run_id", "").strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required.")
    mark_run_cancelled(run_id)
    log_debug(run_id, "CANCEL", "run cancelled by user")
    return {"status": "cancelled", "run_id": run_id}


@app.post("/api/approve_tool")
async def approve_tool(request: Request, payload: dict = Body(...)) -> StreamingResponse:
    plan_id = payload.get("plan_id", "").strip()
    run_id = payload.get("run_id", "").strip()
    if not plan_id:
        raise HTTPException(status_code=400, detail="plan_id is required.")

    plan_data = get_pending_plan(plan_id)
    tool_name = plan_data["tool_name"]
    creator_model = (
        payload.get("tool_creator_model") or plan_data["creator_model"]
    ).strip()
    run_id = run_id or plan_data.get("run_id", "")

    if not creator_model:
        raise HTTPException(status_code=400, detail="No tool creator model configured.")

    docker_ok, docker_message = check_docker_available()
    if not docker_ok:
        raise HTTPException(status_code=503, detail=docker_message)

    async def approval_stream():
        clear_run_cancelled(run_id)
        log_build_event(
            run_id,
            phase="approve",
            message=(
                f"build started plan_id={plan_id} tool={tool_name} "
                f"creator_model={creator_model}"
            ),
        )

        def step(step_id: str, label: str, status: str, *, detail: str = ""):
            if not run_id:
                return ""
            return process_step(
                run_id,
                step_id,
                label,
                status,
                model=creator_model,
                detail=detail,
            )

        def phase(step_id: str, status: str, *, detail: str = ""):
            if not run_id:
                return ""
            return tool_build_phase(run_id, step_id, status, detail=detail)

        def blog(message: str, *, level: str = "info"):
            if not run_id:
                return ""
            return tool_build_log(run_id, message, level=level)

        async def cancelled() -> bool:
            return is_run_cancelled(run_id) or await request.is_disconnected()

        yield step("awaiting_approval", "Awaiting your approval", "done")
        yield phase("generate_code", "active")
        yield step("generate_code", "Generating tool code", "active")
        yield blog("Generating tool code…")
        if await cancelled():
            for event in cancelled_events(run_id, "generate_code", model=creator_model):
                yield event
            return

        edit_context = plan_data.get("edit_context") if plan_data.get("kind") == "edit" else None

        accumulated = ""
        try:
            async for kind, delta in generate_tool_code_stream(
                plan_data["plan"],
                tool_name,
                creator_model,
                litellm_url=LITELLM_URL,
                headers=litellm_headers(),
                run_id=run_id,
                edit_context=edit_context if plan_data.get("kind") == "edit" else None,
            ):
                if await cancelled():
                    for event in cancelled_events(
                        run_id, "generate_code", model=creator_model
                    ):
                        yield event
                    return
                if kind == "reasoning":
                    yield sse_data(
                        {
                            "ada_event": "tool_code_thinking_delta",
                            "run_id": run_id,
                            "delta": delta,
                        }
                    )
                    continue
                accumulated += delta
                yield sse_data(
                    {
                        "ada_event": "tool_code_delta",
                        "run_id": run_id,
                        "delta": delta,
                    }
                )

            tool_code = ""
            test_code = ""
            requirements: list[str] = []
            parse_error: Exception | None = None
            for parse_attempt in range(PHASE_MAX_RETRIES):
                try:
                    if parse_attempt == 0:
                        tool_code, test_code, requirements = parse_generated_tool_response(
                            accumulated
                        )
                    break
                except Exception as exc:
                    parse_error = exc
                    if parse_attempt < PHASE_MAX_RETRIES - 1:
                        yield blog(
                            f"Codegen JSON invalid ({exc}) — auto-repairing…",
                            level="warn",
                        )
                        (
                            tool_code,
                            test_code,
                            requirements,
                        ) = await repair_generated_tool_response(
                            plan_data["plan"],
                            tool_name,
                            accumulated,
                            str(exc),
                            creator_model,
                            litellm_url=LITELLM_URL,
                            headers=litellm_headers(),
                            run_id=run_id,
                            edit_context=edit_context,
                        )
                        break
                    raise parse_error from exc

            log_generated_code(
                run_id,
                tool_name=tool_name,
                tool_code=tool_code,
                test_code=test_code,
            )
            yield sse_data(
                {
                    "ada_event": "tool_code_ready",
                    "run_id": run_id,
                    "tool_name": tool_name,
                    "tool_code": tool_code,
                    "test_code": test_code,
                    "requirements": requirements,
                }
            )
            yield blog("Code generated successfully.")
        except Exception as exc:
            log_build_event(
                run_id, phase="generate_code", message=str(exc), level="error"
            )
            yield step("generate_code", "Generating tool code", "error", detail=str(exc))
            yield phase("generate_code", "error", detail=str(exc))
            yield blog(str(exc), level="error")
            yield sse_data(
                {
                    "ada_event": "tool_build_failed",
                    "run_id": run_id,
                    "tool_name": tool_name,
                    "reason": str(exc),
                }
            )
            yield "data: [DONE]\n\n"
            return

        yield step("generate_code", "Generating tool code", "done")
        yield phase("generate_code", "done")

        if await cancelled():
            for event in cancelled_events(run_id, "validate_code", model=creator_model):
                yield event
            return

        yield step("validate_code", "Validating module structure", "active")
        yield phase("validate_code", "active")
        yield blog("Validating module structure…")

        validation_failed = False
        validation_reason = ""
        for val_attempt in range(PHASE_MAX_RETRIES):
            module_ok = validate_tool_module(tool_code)
            test_ok, test_reason = validate_test_code(test_code)
            if module_ok and test_ok:
                validation_failed = False
                break

            errors: list[str] = []
            if not module_ok:
                errors.append("Generated tool code is missing get_tool_schema() or run().")
            if not test_ok:
                errors.append(test_reason)
            validation_reason = "; ".join(errors)

            if val_attempt < PHASE_MAX_RETRIES - 1:
                yield blog(
                    f"Validation failed — auto-fixing ({validation_reason})…",
                    level="warn",
                )
                try:
                    tool_code, test_code = await fix_validation_errors(
                        tool_name,
                        tool_code,
                        test_code,
                        validation_reason,
                        creator_model,
                        litellm_url=LITELLM_URL,
                        headers=litellm_headers(),
                        run_id=run_id,
                    )
                    yield sse_data(
                        {
                            "ada_event": "tool_code_ready",
                            "run_id": run_id,
                            "tool_name": tool_name,
                            "tool_code": tool_code,
                            "test_code": test_code,
                            "requirements": requirements,
                        }
                    )
                    continue
                except Exception as fix_exc:
                    validation_reason = str(fix_exc)
                    validation_failed = True
                    break
            validation_failed = True
            break

        if validation_failed:
            log_build_event(
                run_id, phase="validate_code", message=validation_reason, level="error"
            )
            yield step(
                "validate_code", "Validating module structure", "error", detail=validation_reason
            )
            yield phase("validate_code", "error", detail=validation_reason)
            yield blog(validation_reason, level="error")
            yield sse_data(
                {
                    "ada_event": "tool_build_failed",
                    "run_id": run_id,
                    "tool_name": tool_name,
                    "reason": validation_reason,
                }
            )
            yield "data: [DONE]\n\n"
            return

        yield step("validate_code", "Validating module structure", "done")
        yield phase("validate_code", "done")
        yield blog("Module structure and test_code look valid.")

        if await cancelled():
            for event in cancelled_events(run_id, "sandbox_test", model=creator_model):
                yield event
            return

        yield step("sandbox_test", "Running sandbox tests", "active")
        yield phase("sandbox_test", "active")
        yield blog("Running sandbox tests in isolated container (no network)…")

        sandbox_success, log_output, test_code, tool_code, sandbox_notices = (
            await run_sandbox_phase(
            run_id=run_id,
            tool_name=tool_name,
            tool_code=tool_code,
            test_code=test_code,
            creator_model=creator_model,
            litellm_url=LITELLM_URL,
            headers=litellm_headers(),
            step=step,
            phase=phase,
            blog=blog,
            sse_data=sse_data,
            cancelled=cancelled,
        )
        )
        for level, message in sandbox_notices:
            yield blog(message, level=level)
        log_sandbox(
            run_id,
            tool_name=tool_name,
            success=sandbox_success,
            logs=log_output,
            attempt=PHASE_MAX_RETRIES - 1 if not sandbox_success else 0,
        )

        if not sandbox_success:
            yield step(
                "sandbox_test",
                "Running sandbox tests",
                "error",
                detail=log_output[:500],
            )
            yield phase("sandbox_test", "error", detail=log_output[:200])
            yield blog(log_output, level="error")
            yield sse_data(
                {
                    "ada_event": "tool_build_failed",
                    "run_id": run_id,
                    "tool_name": tool_name,
                    "reason": "Sandbox verification tests failed.",
                    "logs": log_output,
                }
            )
            yield "data: [DONE]\n\n"
            return

        yield step("sandbox_test", "Running sandbox tests", "done")
        yield phase("sandbox_test", "done")
        yield blog("Sandbox tests passed.")

        yield step("install_tool", "Installing tool", "active")
        yield phase("install_tool", "active")

        paused, pause_events, new_packages = await maybe_pause_for_pip_approval(
            run_id=run_id,
            plan_id=plan_id,
            tool_name=tool_name,
            tool_code=tool_code,
            test_code=test_code,
            requirements=requirements,
            creator_model=creator_model,
            step=step,
            phase=phase,
            sse_data=sse_data,
        )
        if paused and pause_events:
            log_pip_install(run_id, packages=new_packages, logs="awaiting user approval")
            async for event in pause_events:
                yield event
            return

        async for event in stream_runtime_install(
            run_id=run_id,
            plan_id=plan_id,
            tool_name=tool_name,
            tool_code=tool_code,
            test_code=test_code,
            requirements=requirements,
            new_packages=new_packages,
            creator_model=creator_model,
            litellm_url=LITELLM_URL,
            litellm_headers=litellm_headers(),
            step=step,
            phase=phase,
            blog=blog,
            sse_data=sse_data,
            cancelled=cancelled,
            skip_pip=True,
        ):
            yield event

        del PENDING_PLANS[plan_id]
        clear_run_cancelled(run_id)

    return StreamingResponse(
        approval_stream(), media_type="text/event-stream", headers=SSE_HEADERS
    )


@app.post("/api/approve_pip")
async def approve_pip(request: Request, payload: dict = Body(...)) -> StreamingResponse:
    pip_id = payload.get("pip_id", "").strip()
    run_id = payload.get("run_id", "").strip()
    if not pip_id:
        raise HTTPException(status_code=400, detail="pip_id is required.")

    try:
        pip_data = get_pending_pip(pip_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    run_id = run_id or pip_data.get("run_id", "")
    plan_id = pip_data.get("plan_id", "")
    tool_name = pip_data["tool_name"]
    creator_model = pip_data.get("creator_model", "")

    async def pip_stream():
        clear_run_cancelled(run_id)

        def step(step_id: str, label: str, status: str, *, detail: str = ""):
            if not run_id:
                return ""
            return process_step(
                run_id,
                step_id,
                label,
                status,
                model=creator_model,
                detail=detail,
            )

        def phase(step_id: str, status: str, *, detail: str = ""):
            if not run_id:
                return ""
            return tool_build_phase(run_id, step_id, status, detail=detail)

        def blog(message: str, *, level: str = "info"):
            if not run_id:
                return ""
            return tool_build_log(run_id, message, level=level)

        async def cancelled() -> bool:
            return is_run_cancelled(run_id) or await request.is_disconnected()

        yield step("pip_review", "Awaiting pip install approval", "done")

        async for event in stream_runtime_install(
            run_id=run_id,
            plan_id=plan_id,
            tool_name=tool_name,
            tool_code=pip_data["tool_code"],
            test_code=pip_data["test_code"],
            requirements=pip_data.get("requirements", []),
            new_packages=pip_data.get("packages", []),
            creator_model=creator_model,
            litellm_url=LITELLM_URL,
            litellm_headers=litellm_headers(),
            step=step,
            phase=phase,
            blog=blog,
            sse_data=sse_data,
            cancelled=cancelled,
            skip_pip=False,
        ):
            yield event

        PENDING_PIP_INSTALLS.pop(pip_id, None)
        if plan_id in PENDING_PLANS:
            del PENDING_PLANS[plan_id]
        clear_run_cancelled(run_id)

    return StreamingResponse(pip_stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.post("/api/reject_pip")
async def reject_pip(payload: dict = Body(...)) -> dict:
    pip_id = payload.get("pip_id", "").strip()
    if not pip_id:
        raise HTTPException(status_code=400, detail="pip_id is required.")
    if pip_id in PENDING_PIP_INSTALLS:
        data = PENDING_PIP_INSTALLS.pop(pip_id)
        log_pip_install(
            data.get("run_id", ""),
            packages=data.get("packages", []),
            logs="rejected by user",
            approved=False,
        )
        return {"status": "rejected", "pip_id": pip_id}
    raise HTTPException(status_code=404, detail="Pip install request not found.")


@app.post("/api/revise_tool")
async def revise_tool(request: Request, payload: dict = Body(...)) -> StreamingResponse:
    plan_id = payload.get("plan_id", "").strip()
    feedback = payload.get("feedback", "").strip()
    run_id = payload.get("run_id", "").strip()
    if not plan_id:
        raise HTTPException(status_code=400, detail="plan_id is required.")
    if not feedback:
        raise HTTPException(
            status_code=400,
            detail="Describe the changes you want before requesting a revision.",
        )

    plan_data = get_pending_plan(plan_id)
    tool_name = plan_data["tool_name"]
    creator_model = (
        payload.get("tool_creator_model") or plan_data["creator_model"]
    ).strip()
    run_id = run_id or plan_data.get("run_id", "")

    if not creator_model:
        raise HTTPException(status_code=400, detail="No tool creator model configured.")

    async def revision_stream():
        clear_run_cancelled(run_id)
        log_build_event(
            run_id,
            phase="revise",
            message=f"revising plan plan_id={plan_id} tool={tool_name}",
        )

        def step(step_id: str, label: str, status: str, *, detail: str = ""):
            if not run_id:
                return ""
            return process_step(
                run_id,
                step_id,
                label,
                status,
                model=creator_model,
                detail=detail,
            )

        yield step("awaiting_approval", "Awaiting your approval", "done")
        yield step("plan_revise", "Revising plan from your feedback", "active")
        if is_run_cancelled(run_id) or await request.is_disconnected():
            for event in cancelled_events(run_id, "plan_revise", model=creator_model):
                yield event
            return

        try:
            revised_plan = await revise_tool_plan(
                tool_name,
                plan_data["description"],
                plan_data["plan"],
                feedback,
                creator_model,
                litellm_url=LITELLM_URL,
                headers=litellm_headers(),
                run_id=run_id,
            )
        except (RuntimeError, ValueError) as exc:
            yield step(
                "plan_revise",
                "Revising plan from your feedback",
                "error",
                detail=str(exc),
            )
            yield sse_data(
                {
                    "ada_event": "tool_plan_revise_failed",
                    "run_id": run_id,
                    "plan_id": plan_id,
                    "tool_name": tool_name,
                    "reason": str(exc),
                }
            )
            yield "data: [DONE]\n\n"
            return

        if is_run_cancelled(run_id) or await request.is_disconnected():
            for event in cancelled_events(run_id, "plan_revise", model=creator_model):
                yield event
            return

        plan_data["plan"] = revised_plan
        plan_data["created_at"] = time.time()
        clear_run_cancelled(run_id)

        yield step("plan_revise", "Revising plan from your feedback", "done")
        yield step(
            "awaiting_approval",
            "Awaiting your approval",
            "active",
            detail=tool_name,
        )
        yield sse_data(
            {
                "ada_event": "tool_plan_revised",
                "run_id": run_id,
                "plan_id": plan_id,
                "tool_name": tool_name,
                "plan": revised_plan,
            }
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        revision_stream(), media_type="text/event-stream", headers=SSE_HEADERS
    )


@app.post("/api/reject_tool")
async def reject_tool(payload: dict = Body(...)) -> dict:
    plan_id = payload.get("plan_id", "").strip()
    if not plan_id:
        raise HTTPException(status_code=400, detail="plan_id is required.")

    cleanup_expired_plans()
    if plan_id in PENDING_PLANS:
        del PENDING_PLANS[plan_id]
        return {"status": "rejected", "message": "Plan rejected."}

    raise HTTPException(status_code=404, detail="Plan not found or expired.")
