# The ATS service's image (decision 0020). CI builds it from this folder and publishes it to
# ghcr.io/makis4n/resume-tools-ats; for development, run `uv run ats-serve` instead.
# Base images are pinned by digest, with the tag alongside for reading.

FROM ghcr.io/astral-sh/uv:0.12.19@sha256:04d046b13e60d6bcec73cbc5e1cad25d680dea90c8573340950a0ac2d1aef424 AS uv

FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f AS build
COPY --from=uv /uv /usr/local/bin/uv
# The image's own Python, not one uv downloads, and a venv that holds its own copy of the package
# so that it is the only thing the final stage needs.
ENV UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
# Dependencies first, so a change to the source alone reuses this layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
RUN groupadd --system --gid 10001 ats \
  && useradd --system --no-create-home --uid 10001 --gid 10001 ats
COPY --from=build /app/.venv /app/.venv
# Listens on every interface inside the container. ATS_ALLOWED_ORIGINS and ATS_MAX_UPLOAD_BYTES
# are set by the host (apps/ats/README.md).
ENV PATH=/app/.venv/bin:$PATH ATS_HOST=0.0.0.0 ATS_PORT=8000 PYTHONUNBUFFERED=1
# Numeric, so a host that requires a non-root user can tell without reading /etc/passwd.
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['ATS_PORT']}/health\", timeout=2)"]
CMD ["ats-serve"]
