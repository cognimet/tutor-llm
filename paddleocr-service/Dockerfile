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

# Bake the English det/rec/cls models into the image. Downloading them lazily
# at request time raced concurrent first requests (corrupted models, SIGABRT)
# and repeated after every container restart since /root/.paddleocr isn't a
# volume. Pure stdlib (no paddle import — paddle's native code aborts under
# build-time QEMU), mirroring paddleocr's maybe_download() layout: files
# renamed to inference.* flat inside each model dir.
RUN python - <<'EOF'
import io, pathlib, tarfile, urllib.request

MODELS = {
    "det/en/en_PP-OCRv3_det_infer": "https://paddleocr.bj.bcebos.com/PP-OCRv3/english/en_PP-OCRv3_det_infer.tar",
    "rec/en/en_PP-OCRv4_rec_infer": "https://paddleocr.bj.bcebos.com/PP-OCRv4/english/en_PP-OCRv4_rec_infer.tar",
    "cls/ch_ppocr_mobile_v2.0_cls_infer": "https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar",
}
SUFFIXES = (".pdiparams", ".pdiparams.info", ".pdmodel")
for rel, url in MODELS.items():
    dest = pathlib.Path("/root/.paddleocr/whl") / rel
    dest.mkdir(parents=True, exist_ok=True)
    data = urllib.request.urlopen(url).read()
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar.getmembers():
            for suffix in SUFFIXES:
                if member.name.endswith(suffix):
                    (dest / f"inference{suffix}").write_bytes(tar.extractfile(member).read())
    assert (dest / "inference.pdiparams").exists(), f"model bake failed: {rel}"
print("models baked:", *MODELS)
EOF

COPY app.py .

EXPOSE 8002

# Single worker: the OCR engine is heavy and cached in-process.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]
