# Stage 1: Build React frontend
FROM node:22-alpine AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py tools_engine.py tool_verify.py tool_creator.py litellm_client.py debug_log.py runtime_client.py build_pipeline.py prompts_config.py forger_guidance.py ./
RUN mkdir -p custom_tools staging

COPY --from=frontend-build /static ./static

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
