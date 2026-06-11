FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY runner.py server.py ./

RUN mkdir -p /app/custom_tools /app/venv
RUN ln -sf /app/custom_tools /workspace

ENV TOOLS_DIR=/app/custom_tools
ENV VENV_PATH=/app/venv

EXPOSE 8090

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8090"]
