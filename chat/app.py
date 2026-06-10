import os
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000").rstrip("/")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Ada-SI Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def litellm_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if LITELLM_MASTER_KEY:
        headers["Authorization"] = f"Bearer {LITELLM_MASTER_KEY}"
    return headers


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


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
    body = await request.body()

    try:
        client = httpx.AsyncClient(timeout=None)
        response = await client.send(
            client.build_request(
                "POST",
                f"{LITELLM_URL}/chat/completions",
                headers=litellm_headers(),
                content=body,
            ),
            stream=True,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"LiteLLM unreachable: {exc}") from exc

    if response.status_code != 200:
        error_body = await response.aread()
        await response.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=response.status_code,
            detail=error_body.decode("utf-8", errors="replace"),
        )

    media_type = response.headers.get("content-type", "text/event-stream")

    async def stream_response():
        try:
            async for chunk in response.aiter_bytes():
                if await request.is_disconnected():
                    break
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return StreamingResponse(stream_response(), media_type=media_type)
