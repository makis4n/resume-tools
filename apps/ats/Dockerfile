# The ATS service's image (decision 0029). CI builds it from this folder and publishes it to
# ghcr.io/makis4n/resume-tools-ats; for development, run `uv run ats-serve` instead.
# Base images are pinned by digest, with the tag alongside for reading.

FROM ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 AS uv

FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS build
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

FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
RUN groupadd --system --gid 10001 ats \
  && useradd --system --no-create-home --uid 10001 --gid 10001 ats
COPY --from=build /app/.venv /app/.venv
# Listens on every interface inside the container. ATS_ALLOWED_ORIGINS, ATS_MAX_UPLOAD_BYTES and
# ATS_TRUSTED_PROXY_HOPS are set by the host (apps/ats/README.md).
ENV PATH=/app/.venv/bin:$PATH ATS_HOST=0.0.0.0 ATS_PORT=8000 PYTHONUNBUFFERED=1
# Numeric, so a host that requires a non-root user can tell without reading /etc/passwd.
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['ATS_PORT']}/health\", timeout=2)"]
CMD ["ats-serve"]
