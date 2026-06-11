import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def is_gemini_model(model: str) -> bool:
    return model.startswith("gemini/") or model.startswith("gemini/*")


def build_completion_payload(
    model: str,
    messages: list[dict],
    *,
    stream: bool,
    tools: list[dict] | None = None,
    temperature: float = 0.2,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "temperature": temperature,
    }
    if tools is not None:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if is_gemini_model(model):
        payload["reasoning_effort"] = "low"
    return payload


def extract_stream_delta(chunk: dict) -> dict[str, str]:
    """Normalize reasoning and content from a LiteLLM streaming chunk."""
    choices = chunk.get("choices") or []
    if not choices:
        return {"reasoning": "", "content": ""}

    choice = choices[0]
    delta_obj = choice.get("delta") or {}

    reasoning = (
        delta_obj.get("reasoning_content")
        or delta_obj.get("reasoning")
        or delta_obj.get("thinking")
        or choice.get("reasoning_content")
        or choice.get("reasoning")
        or choice.get("thinking")
        or ""
    )
    if isinstance(reasoning, list):
        reasoning = "".join(
            block.get("text", block) if isinstance(block, dict) else str(block)
            for block in reasoning
        )
    elif not isinstance(reasoning, str):
        reasoning = str(reasoning) if reasoning else ""

    content = delta_obj.get("content") or choice.get("text") or ""
    if not isinstance(content, str):
        content = str(content) if content else ""

    return {"reasoning": reasoning, "content": content}


def extract_stream_tool_calls(chunk: dict) -> list[dict]:
    choices = chunk.get("choices") or []
    if not choices:
        return []
    delta_obj = choices[0].get("delta") or {}
    return delta_obj.get("tool_calls") or []


def merge_tool_call_delta(acc: dict[int, dict], delta_tool_calls: list[dict]) -> None:
    for tc in delta_tool_calls:
        idx = tc.get("index", 0)
        if idx not in acc:
            acc[idx] = {
                "id": "",
                "type": "function",
                "function": {"name": "", "arguments": ""},
            }
        entry = acc[idx]
        if tc.get("id"):
            entry["id"] = tc["id"]
        if tc.get("type"):
            entry["type"] = tc["type"]
        fn = tc.get("function") or {}
        if fn.get("name"):
            entry["function"]["name"] += fn["name"]
        if fn.get("arguments"):
            entry["function"]["arguments"] += fn["arguments"]


def tool_calls_from_acc(acc: dict[int, dict]) -> list[dict]:
    return [acc[i] for i in sorted(acc) if acc[i].get("id") or acc[i]["function"]["name"]]


def openai_stream_chunk(
    *,
    chunk_id: str,
    reasoning: str = "",
    content: str = "",
    finish_reason: str | None = None,
) -> dict:
    delta: dict[str, str] = {}
    if reasoning:
        delta["reasoning_content"] = reasoning
    if content:
        delta["content"] = content
    return {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }


async def stream_chat_completion(
    litellm_url: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict],
    *,
    tools: list[dict] | None = None,
    temperature: float = 0.2,
) -> AsyncIterator[dict]:
    payload = build_completion_payload(
        model,
        messages,
        stream=True,
        tools=tools,
        temperature=temperature,
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{litellm_url.rstrip('/')}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise RuntimeError(
                    f"LiteLLM error ({response.status_code}): "
                    f"{body.decode('utf-8', errors='replace')}"
                )
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str or data_str == "[DONE]":
                    continue
                try:
                    yield json.loads(data_str)
                except json.JSONDecodeError:
                    continue


async def stream_completion_deltas(
    litellm_url: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict],
    *,
    tools: list[dict] | None = None,
    temperature: float = 0.2,
) -> AsyncIterator[tuple[str, str]]:
    """Yield (kind, text) where kind is 'reasoning' or 'content'."""
    async for chunk in stream_chat_completion(
        litellm_url,
        headers,
        model,
        messages,
        tools=tools,
        temperature=temperature,
    ):
        delta = extract_stream_delta(chunk)
        if delta["reasoning"]:
            yield "reasoning", delta["reasoning"]
        if delta["content"]:
            yield "content", delta["content"]


def new_stream_chunk_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex[:12]}"
