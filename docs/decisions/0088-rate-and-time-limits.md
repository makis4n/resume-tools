# 0088. The ATS's rate and time limits

Date: 2026-10-12 · Status: accepted

## Context

`docs/ats-prd.md` §8.2, §11.1 and milestone 1 in §13 ask for per-IP rate limits and request
limits on the public, anonymous ATS service. The upload-size limit already exists. Version one has
no sign-in, so the client's address is the only thing to limit by, and a PDF that is slow to
analyse should not be able to hold a worker for as long as it likes.

## Decision

- **Rate limit.** A token bucket per client, in plain ASGI middleware (`ats/ratelimit.py`), no new
  dependency. `POST /v1/analyze` allows `ATS_ANALYZE_RATE_LIMIT_PER_MINUTE` requests a minute
  (default 10; `0` turns it off), refilled evenly. Only POSTs to a limited path count: CORS
  preflights, `/health` and unknown paths do not. Milestone 3 adds `/v1/job-requirements` to the
  same middleware with its own limiter.
- **Refusal.** 429 with code `rate-limited`, a message that says how long to wait, and
  `Retry-After` in whole seconds. The middleware sits inside CORS, so the reply carries CORS
  headers and exposes `Retry-After` to the browser, and outside body reading, so a refused
  client's upload is never read.
- **Client address.** By default the TCP peer, and every forwarding header is ignored; uvicorn runs
  with `proxy_headers=False` so it cannot substitute one either. With `ATS_TRUSTED_PROXY_HOPS=N`
  the key is the Nth `X-Forwarded-For` entry from the right, the one the outermost trusted proxy
  appended, which a client cannot forge. RFC 7239 `Forwarded` is ignored. IPv4-mapped IPv6
  addresses count as IPv4, and other IPv6 addresses are grouped by /64, since one host usually
  holds a whole /64.
- **Bounded memory.** The limiter remembers at most `ATS_RATE_LIMIT_MAX_CLIENTS` clients (default
  10,000) and drops the least recently seen first. Dropping a client idle for a minute loses
  nothing; dropping a busier one gives that client a fresh bucket, so the limit fails open for it
  alone rather than refusing anyone wrongly.
- **Time limit.** Each analysis runs in a child process started from a `forkserver`, with
  `ats.analyze` preloaded, and is killed after `ATS_ANALYSIS_TIMEOUT_SECONDS` (default 10). A
  thread cannot be stopped, so a process is the only hard limit. The reply is 422
  `analysis-timeout`: the time depends on the file, and the same file would time out again, so
  it is not a transient 5xx. The child returns tags rather than exceptions, so no traceback that
  could quote the resume is printed; a child that dies is a 500 `internal-error`, logged by exit
  code or exception type only.
- **Light entry point.** Every child re-runs the main script's top level (CPython does not pass
  the main path to the forkserver preload). `ats-serve` is `ats.serve:main`, which imports
  uvicorn and the service only inside `main`, so a child does not pay for them.
- **Concurrency.** At most `min(4, CPUs)` analysis processes run at once, held by a semaphore in
  `ats/timelimit.py`. A request waits for a slot before its clock starts, so queueing is never
  reported as `analysis-timeout`. The wait is bounded by `ATS_SLOT_WAIT_SECONDS` (default 5); a
  request that gets no slot in that time is refused with 503 `server-busy` and `Retry-After`, so a
  client's burst of slow PDFs cannot queue other users out indefinitely or pin every threadpool
  thread. The anyio threadpool of 40 alone would allow 40 PDFium processes.
- **Settings are checked at start.** `ATS_ANALYSIS_TIMEOUT_SECONDS` must be finite, above 0 and at
  most 3600, and `ATS_SLOT_WAIT_SECONDS` from 0 to 3600; `inf` is refused by name rather than
  failing every analysis.
- **Forwarded entries.** A `:port` or `[v6]:port` suffix on the trusted entry is stripped before
  parsing. An entry that still is not an IP logs a warning and falls back to the peer.
- The three new codes (`rate-limited`, `analysis-timeout`, `server-busy`) are added to the
  description in `packages/contracts/ats/v1/error.schema.json`, an additive change within v1. The analyser version is not bumped: the analysis body does not
  change.

## Consequences

- Limits are per process, like the daily cap in decision 0030. Running several instances
  multiplies the allowance; a shared store is needed only if that happens.
- Behind a proxy, `ATS_TRUSTED_PROXY_HOPS` must be set on the host, or every client counts as the
  proxy and shares one bucket. Setting it too high lets clients choose their own key.
- Every analysis pays for a process start. Preloading keeps that small, but it is more than a
  thread.
- The child process is a time limit, not a sandbox; isolating the parser stays open in the PRD.
- The job-description-length limit and the daily model cap come with milestone 3.
