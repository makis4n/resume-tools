# ATS

The applicant-tracking-system simulator and resume optimiser. Owner: @keaenlim.

Input is a finished resume PDF; output is JSON matching `packages/contracts/ats/v1/analysis.schema.json`. The editor shows the result in a panel.

```sh
uv sync                     # Python 3.12 is fetched if needed; dev tools included
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

`src/ats/analyze.py` is the entry point and is a placeholder. The HTTP layer is not chosen yet; FastAPI is the obvious default, and `POST /v1/analyze` taking multipart form data with a `file` field is the shape the contract assumes. Where the service is hosted is also open; it needs a Python host.
