FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py tools_engine.py sandbox.py tool_creator.py litellm_client.py debug_log.py ./
RUN mkdir -p custom_tools staging
COPY static ./static

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
