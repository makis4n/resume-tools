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

`src/ats/service.py` is the HTTP layer, FastAPI served by Uvicorn (decision 0030): `POST /v1/analyze` takes multipart form data with a `file` field holding a PDF, and `GET /health` answers the host's checks. `src/ats/analyze.py` is the analysis itself: it extracts the PDF's text and layout facts (`src/ats/extract.py`), classifies the producing tool (`src/ats/producer.py`), runs the milestone-1 readiness checks (`src/ats/readiness.py`) and scores them under the versioned rubric (`src/ats/rubric.py`, decision 0083). Contact and section checks and job matching are later milestones; reading order is decision 0086.

Settings come from the environment:

| Variable | Default | Meaning |
|---|---|---|
| `ATS_HOST` | `127.0.0.1` | Address `ats-serve` listens on |
| `ATS_PORT` | `8000` | Port `ats-serve` listens on |
| `ATS_MAX_UPLOAD_BYTES` | `5242880` | Largest PDF accepted, in bytes |
| `ATS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the service from a browser |

Where the service is hosted is still open; it needs a Python host. Whichever it is, it runs the container image CI publishes from `main` to `ghcr.io/makis4n/resume-tools-ats`, tagged `sha-<full commit SHA>` and `main` (decision 0029). `main` only ever moves forward: a run for an older commit, or a re-run of one, leaves it where it is. Only the five newest builds are kept, plus whichever build `main` holds, to stay inside the free plan's package storage, so a host pinned to a `sha-` tag has to move on before five more merges. The image listens on port 8000 on every interface, runs as an unprivileged user, and takes the settings above from its environment; set `ATS_ALLOWED_ORIGINS` to the editor's address. The package is private like the repository, so the host needs a token that can read packages. To build and check it locally, which is what CI does on every pull request:

```sh
docker build -t ats:local apps/ats                 # from the repository root
bash .github/scripts/smoke-ats-image.sh ats:local  # health, and replies checked against the contract
```
