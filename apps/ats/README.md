# ATS

The applicant-tracking-system simulator and resume optimiser. Owner: @keaenlim.

Input is a finished resume PDF; output is JSON matching `packages/contracts/ats/v1/analysis.schema.json`, or an error matching `error.schema.json` next to it. The editor shows the result in a panel. The product requirements are in [docs/ats-prd.md](../../docs/ats-prd.md).

```sh
uv sync                     # Python 3.12 is fetched if needed; dev tools included
uv run ats-serve            # the service at http://localhost:8000
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

For reloading on changes while developing, run `uv run uvicorn ats.service:app --reload` instead.

`src/ats/service.py` is the HTTP layer, FastAPI served by Uvicorn (decision 0018): `POST /v1/analyze` takes multipart form data with a `file` field holding a PDF, and `GET /health` answers the host's checks. `src/ats/analyze.py` is the analysis itself and is still a placeholder that returns an empty result.

Settings come from the environment:

| Variable | Default | Meaning |
|---|---|---|
| `ATS_HOST` | `127.0.0.1` | Address `ats-serve` listens on |
| `ATS_PORT` | `8000` | Port `ats-serve` listens on |
| `ATS_MAX_UPLOAD_BYTES` | `5242880` | Largest PDF accepted, in bytes |
| `ATS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the service from a browser |

Where the service is hosted is still open; it needs a Python host.
