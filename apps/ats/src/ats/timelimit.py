"""A hard processing-time limit for one analysis (decision 0088).

The analysis runs in a child process that is killed when the time is up. A thread cannot be
stopped, and pypdfium2 releases the GIL, so a deadline inside the process would not work.

Children come from a forkserver: it is single-threaded, so forking from it is safe while uvicorn
has threads. It preloads `ats.analyze`. Each child also runs the main script's top level again,
which is why `ats.serve` stays light. At most `MAX_CONCURRENT_ANALYSES` children run at once,
because each holds a PDFium document; a request waits for a slot before its clock starts. This is
a time limit, not a sandbox.
"""

import multiprocessing
import os
import threading
from collections.abc import Callable
from multiprocessing.connection import Connection
from typing import Any

from ats.analyze import NotAPdfError
from ats.extract import EncryptedPdfError, UnreadablePdfError

multiprocessing.set_forkserver_preload(["ats.analyze"])

MAX_CONCURRENT_ANALYSES = max(1, min(4, os.cpu_count() or 1))
_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_ANALYSES)

_TAGS: dict[type[Exception], str] = {
    NotAPdfError: "not-a-pdf",
    EncryptedPdfError: "encrypted",
    UnreadablePdfError: "unreadable",
}


class AnalysisTimeoutError(Exception):
    """The analysis did not finish in time and its process was killed."""


class AnalysisCrashedError(Exception):
    """The analysis process died or failed unexpectedly. The message is a type name or exit code."""


def _child(analyser: Callable[[bytes], dict[str, Any]], pdf: bytes, send: Connection) -> None:
    # Sends tags, not exceptions, so no traceback is printed that could quote the resume.
    try:
        outcome: tuple[str, Any] = ("ok", analyser(pdf))
    except (NotAPdfError, EncryptedPdfError, UnreadablePdfError) as error:
        outcome = (_TAGS[type(error)], None)
    except Exception as error:
        outcome = ("crash", type(error).__name__)
    send.send(outcome)
    send.close()


def run_with_time_limit(
    analyser: Callable[[bytes], dict[str, Any]], pdf: bytes, seconds: float
) -> dict[str, Any]:
    with _SLOTS:
        return _run(analyser, pdf, seconds)


def _run(analyser: Callable[[bytes], dict[str, Any]], pdf: bytes, seconds: float) -> dict[str, Any]:
    ctx = multiprocessing.get_context("forkserver")
    recv, send = ctx.Pipe(duplex=False)
    child = ctx.Process(target=_child, args=(analyser, pdf, send), daemon=True)
    try:
        child.start()
        send.close()
        if not recv.poll(seconds):
            child.kill()
            child.join()
            raise AnalysisTimeoutError
        try:
            tag, value = recv.recv()
        except EOFError:
            child.join()
            raise AnalysisCrashedError(f"exit code {child.exitcode}") from None
    finally:
        recv.close()
        if child.is_alive():
            child.kill()
        if child.pid is not None:
            child.join()

    if tag == "ok":
        return value  # type: ignore[no-any-return]
    if tag == "not-a-pdf":
        raise NotAPdfError
    if tag == "encrypted":
        raise EncryptedPdfError
    if tag == "unreadable":
        raise UnreadablePdfError
    raise AnalysisCrashedError(str(value))
