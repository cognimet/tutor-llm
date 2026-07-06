# PaddlePaddle has no arm64 Linux wheels on PyPI — build for amd64 (native on
# Intel, emulated on Apple Silicon). Keep in sync with the compose `platform`.
FROM --platform=linux/amd64 python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System libs PaddleOCR/OpenCV need at runtime (no GUI/X11).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

EXPOSE 8002

# Single worker: the OCR engine is heavy and cached in-process.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]
