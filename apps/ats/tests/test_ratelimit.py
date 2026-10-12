import pytest
from starlette.types import Scope

from ats.ratelimit import RateLimiter, client_key


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def scope(peer: str | None = "198.51.100.1", *forwarded: str) -> Scope:
    headers = [(b"x-forwarded-for", value.encode()) for value in forwarded]
    return {"type": "http", "client": (peer, 5000) if peer else None, "headers": headers}


def test_a_burst_of_per_minute_is_allowed_then_refused_until_a_token_refills() -> None:
    clock = Clock()
    limiter = RateLimiter(6, 100, clock)
    assert all(limiter.take("a") is None for _ in range(6))
    wait = limiter.take("a")
    assert wait is not None
    assert abs(wait - 10) < 1e-6
    clock.now += 10
    assert limiter.take("a") is None
    assert limiter.take("a") is not None


def test_keys_have_separate_buckets_and_an_idle_key_is_full_again() -> None:
    clock = Clock()
    limiter = RateLimiter(2, 100, clock)
    assert limiter.take("a") is None
    assert limiter.take("a") is None
    assert limiter.take("a") is not None
    assert limiter.take("b") is None
    clock.now += 60
    assert limiter.take("a") is None
    assert limiter.take("a") is None
    assert limiter.take("a") is not None


def test_the_table_is_bounded_and_evicts_the_least_recently_seen_key() -> None:
    limiter = RateLimiter(1, 3, Clock())
    for key in ("a", "b", "c"):
        assert limiter.take(key) is None
    assert limiter.take("a") is not None  # "a" is now the most recently seen
    assert limiter.take("d") is None
    assert len(limiter.buckets) == 3
    assert list(limiter.buckets) == ["c", "a", "d"]


def test_without_trusted_proxies_forwarding_headers_are_ignored() -> None:
    assert client_key(scope("198.51.100.1", "203.0.113.9"), 0) == "198.51.100.1"


def test_one_trusted_proxy_uses_the_right_most_entry() -> None:
    spoofed = scope("10.0.0.1", "1.2.3.4, 5.6.7.8, 203.0.113.9")
    assert client_key(spoofed, 1) == "203.0.113.9"
    assert client_key(scope("10.0.0.1", "1.2.3.4, 5.6.7.8", "203.0.113.9"), 1) == "203.0.113.9"
    assert client_key(scope("10.0.0.1", "1.2.3.4, 203.0.113.9, 192.0.2.7"), 2) == "203.0.113.9"


def test_too_few_entries_or_a_non_ip_entry_falls_back_to_the_peer() -> None:
    assert client_key(scope("10.0.0.1", "203.0.113.9"), 2) == "10.0.0.1"
    assert client_key(scope("10.0.0.1"), 1) == "10.0.0.1"
    assert client_key(scope("10.0.0.1", "not-an-ip"), 1) == "10.0.0.1"


def test_ipv6_is_grouped_by_64_and_mapped_ipv4_is_ipv4() -> None:
    a = client_key(scope("2001:db8:1:2::1"), 0)
    b = client_key(scope("2001:db8:1:2:ffff::9"), 0)
    c = client_key(scope("2001:db8:1:3::1"), 0)
    assert a == b == "2001:db8:1:2::/64"
    assert c != a
    assert client_key(scope("::ffff:203.0.113.5"), 0) == "203.0.113.5"


def test_an_unparseable_peer_or_no_peer_still_gives_a_key() -> None:
    assert client_key(scope("testclient"), 0) == "testclient"
    assert client_key(scope(None), 0) == ""


def test_a_trusted_entry_with_a_port_is_keyed_by_its_address(
    caplog: pytest.LogCaptureFixture,
) -> None:
    assert client_key(scope("10.0.0.5", "203.0.113.9:54321"), 1) == "203.0.113.9"
    assert client_key(scope("10.0.0.5", "198.51.100.7:1111"), 1) == "198.51.100.7"
    assert client_key(scope("10.0.0.5", "[2001:db8:1:2::1]:443"), 1) == "2001:db8:1:2::/64"
    assert client_key(scope("10.0.0.5", "[2001:db8:1:2::1]"), 1) == "2001:db8:1:2::/64"
    assert not caplog.records


def test_falling_back_to_the_peer_behind_a_trusted_proxy_is_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level("WARNING", logger="ats.ratelimit"):
        assert client_key(scope("10.0.0.1", "unknown"), 1) == "10.0.0.1"
    assert len(caplog.records) == 1
