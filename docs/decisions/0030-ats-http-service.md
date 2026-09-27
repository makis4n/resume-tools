# 0030. The ATS HTTP service

Date: 2026-09-25 · Status: proposed

## Context

The ATS has an `analyze` function and no HTTP layer; the README names FastAPI as the obvious
default but leaves it open. The ATS product requirements (`docs/ats-prd.md`) add a second
endpoint, for reading requirements from a job description with a language model. They also require
`/v1/analyze` to stay deterministic, and need the draft contract to take additive changes safely.
The service is public and anonymous until the editor has accounts, and will call a paid model.

## Decision

- **Framework.** FastAPI, served by Uvicorn. New dependencies: `fastapi`, `uvicorn` and
  `python-multipart`, which FastAPI needs to read multipart form data. The HTTP layer stays in
  its own module; `analyze` and the extractors know nothing about HTTP.
- **Endpoints.**
  - `POST /v1/job-requirements` takes job-description text and returns a structured requirement
    list. It strips email addresses, phone numbers and URLs first, calls the model provider, and
    validates the reply against the requirement schema. Results are cached by a hash of the
    stripped text and the extractor version; the cache holds the hash and the list, never the text.
    Rule-based extraction runs when the provider is disabled, failing or over its daily cap. The
    response says which extractor produced the list.
  - `POST /v1/analyze` takes multipart form data: a required `file` holding a PDF and an optional
    `requirements` field holding a requirement list as JSON. It never calls a model provider, so
    the same PDF, list, rubric version and configuration always give the same result.
  - `GET /health` for the host's checks.
- **Contract.** Within `ats/v1`, while it is a draft:
  - Remove `additionalProperties: false` from the response and from `finding`. Clients ignore
    properties they do not know. With the current setting, deploying a new field before the editor
    updates would fail validation on every response.
  - Redefine `score` as the ATS-readiness score, and add an optional `match` object, present only
    when requirements were sent, for the job-match score and per-requirement evidence.
  - Add `origin` (`content` or `layout`) to each finding, and `producer` (`latex`, `word`,
    `google-docs`, `canva` or `other`), rubric version and analyser version to the response.
  - Add a requirement-list schema and an error schema with stable machine-readable codes, and
    document both endpoints' request fields.
- **Abuse.** Per-IP rate limits on both endpoints; a daily cap on model calls, after which
  requirement extraction falls back to rules for the rest of the day; cross-origin requests only
  from the configured editor origins; limits on request size, job-description length and
  processing time. Every limit is an environment variable listed in `apps/ats/.env.example`.
- **Logging.** No PDF bytes, extracted text or job-description text in logs.

## Consequences

- One Python web stack to learn and host; FastAPI's typed request models fit the repository's
  type-hint rule.
- The model is kept out of scoring by the shape of the API, not by convention: the only path from a
  model's output to a score passes through a list the user has seen.
- Two round trips for targeted analysis instead of one. The editor keeps the list for the session,
  so re-analysis costs one.
- The contract changes affect the editor's panel. Decision 0005 requests no review, so the author
  tells the editor owner directly.
- The daily-cap counter lives in the service. That is correct while it runs as one instance and
  needs a shared store if it ever runs as several.
- PDF extraction is not decided here. It sits behind `analyze`, and its libraries are chosen by
  benchmark in milestone 1.
- The model provider is not chosen here. It is picked at milestone 3 against a hand-checked set of
  job descriptions, and needs its own key in the service's environment.
