"""Entry point of `ats-serve`, kept light on purpose.

The analysis children come from a forkserver, and every child runs the main script's top level
again (CPython passes no main path to the forkserver's preload, so `__main__` cannot be preloaded).
The console script's top level is `from ats.serve import main`, so it must not import FastAPI,
uvicorn or `ats.service`; those load inside `main`, in the parent only. A test pins this.
"""

import os


def main() -> None:
    """Run the service locally: `uv run ats-serve`."""
    import uvicorn

    uvicorn.run(
        "ats.service:app",
        host=os.environ.get("ATS_HOST", "127.0.0.1"),
        port=int(os.environ.get("ATS_PORT", "8000")),
        # scope["client"] stays the TCP peer; only ATS_TRUSTED_PROXY_HOPS reads X-Forwarded-For.
        proxy_headers=False,
    )
