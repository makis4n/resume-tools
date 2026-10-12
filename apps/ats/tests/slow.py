"""Analysers for the time-limit tests. Top level, so a child process can import them by name."""

import os
import time
from typing import Any


def sleep_forever(_: bytes) -> dict[str, Any]:
    time.sleep(30)
    return {}


def hard_exit(_: bytes) -> dict[str, Any]:
    os._exit(1)


def raise_invented_error(_: bytes) -> dict[str, Any]:
    raise RuntimeError("Invented Person, 12 Invented Street")
