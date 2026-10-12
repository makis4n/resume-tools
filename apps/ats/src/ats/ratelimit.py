"""Per-client rate limit for the ATS's POST endpoints (decision 0088).

`RateLimitMiddleware` takes a mapping from path to `RateLimiter`. Today it holds `/v1/analyze`;
milestone 3 reuses the middleware by adding `/v1/job-requirements` with its own limiter.

Limits are per process, like the daily cap in decision 0030. Nothing here is thread-safe on
purpose: the limiter is only touched on the event loop.
"""

import ipaddress
import logging
import math
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from ats.errors import error_response

logger = logging.getLogger(__name__)

RATE_LIMITED = (
    "Too many requests were sent in a short time. Please wait about {} seconds and try again."
)


class RateLimiter:
    """A token bucket per key: capacity `per_minute`, refilled at `per_minute / 60` a second.

    The table of keys is bounded by `max_clients`. When it is full, adding a key evicts the least
    recently seen one. That loses nothing when the evicted client has been idle for 60 s or more
    (its bucket would be full again), and otherwise gives that one client a fresh bucket, so it
    fails open for that client only.
    """

    def __init__(
        self,
        per_minute: int,
        max_clients: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.capacity = float(per_minute)
        self.rate = per_minute / 60
        self.max_clients = max_clients
        self.clock = clock
        self.buckets: OrderedDict[str, tuple[float, float]] = OrderedDict()

    def take(self, key: str) -> float | None:
        """Spend one token. None if allowed, else the seconds until a token is free."""
        now = self.clock()
        if key in self.buckets:
            tokens, last_seen = self.buckets[key]
            tokens = min(self.capacity, tokens + (now - last_seen) * self.rate)
            self.buckets.move_to_end(key)
        else:
            if len(self.buckets) >= self.max_clients:
                self.buckets.popitem(last=False)
            tokens = self.capacity
        if tokens >= 1:
            self.buckets[key] = (tokens - 1, now)
            return None
        self.buckets[key] = (tokens, now)
        return (1 - tokens) / self.rate


def client_key(scope: Scope, trusted_proxy_hops: int) -> str:
    """The key a request is limited under.

    With no trusted proxies it is the TCP peer, and every forwarding header is ignored. With N
    trusted proxies, each of which appends the address it saw to X-Forwarded-For, it is the Nth
    entry from the right, which no client can forge. The RFC 7239 `Forwarded` header is ignored.
    IPv4-mapped IPv6 addresses become IPv4 and other IPv6 addresses are grouped by /64.
    """
    client = scope.get("client")
    peer = client[0] if client else None
    raw = peer
    if trusted_proxy_hops > 0:
        values = Headers(scope=scope).getlist("x-forwarded-for")
        entries = [part.strip() for value in values for part in value.split(",")]
        if len(entries) >= trusted_proxy_hops:
            raw = _strip_port(entries[-trusted_proxy_hops])
        if _parse(raw) is None:
            logger.warning(
                "ATS_TRUSTED_PROXY_HOPS=%d but the X-Forwarded-For entry is not an IP address "
                "or has too few entries; limiting by the TCP peer instead",
                trusted_proxy_hops,
            )
    return _normalise(raw, peer)


def _strip_port(entry: str) -> str:
    """Drop a `:port` from `1.2.3.4:80` or `[v6]:80`, and the brackets from `[v6]`."""
    if entry.startswith("["):
        end = entry.find("]")
        return entry[1:end] if end != -1 else entry
    if entry.count(":") == 1:
        return entry.split(":", 1)[0]
    return entry


def _parse(candidate: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    if candidate is None:
        return None
    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return None


def _normalise(raw: str | None, peer: str | None) -> str:
    for candidate in (raw, peer):
        address = _parse(candidate)
        if address is None:
            continue
        if isinstance(address, ipaddress.IPv6Address):
            if address.ipv4_mapped is not None:
                return str(address.ipv4_mapped)
            return str(ipaddress.ip_network(f"{address}/64", strict=False))
        return str(address)
    return peer or raw or ""


class RateLimitMiddleware:
    """Refuses a POST to a limited path once its client is out of tokens, unread body and all."""

    def __init__(
        self, app: ASGIApp, limits: Mapping[str, RateLimiter], trusted_proxy_hops: int
    ) -> None:
        self.app = app
        self.limits = limits
        self.trusted_proxy_hops = trusted_proxy_hops

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limiter = self.limits.get(scope["path"]) if scope["type"] == "http" else None
        if limiter is None or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return

        wait = limiter.take(client_key(scope, self.trusted_proxy_hops))
        if wait is None:
            await self.app(scope, receive, send)
            return

        seconds = max(1, math.ceil(wait))
        reply = error_response(429, "rate-limited", RATE_LIMITED.format(seconds))
        reply.headers["Retry-After"] = str(seconds)
        await reply(scope, receive, send)
