# 0034. CODEOWNERS for the two apps, reviews requested but not required

Date: 2026-09-30 · Status: accepted; amends 0005

## Context

Decision 0005 removed `.github/CODEOWNERS` along with required reviews, so neither of us is told
when the other changes our app. Changes to docs, decision records and shared configuration are
frequent and rarely need the other person, but a change inside the other person's app should
reach them.

## Decision

- `.github/CODEOWNERS` comes back with owners for the two apps only: `apps/editor/` is
  @makis4n's, `apps/ats/` is @keaenlim's, and the ATS panel inside the editor,
  `apps/editor/src/features/ats/`, is both, since it is the one place the editor consumes the
  ATS's output.
- Nothing else has an owner: `docs/` (the decision records included), `packages/`, `.github/`
  and the root configuration request no review.
- A request is not a requirement. Branch protection still asks for no approvals and no code-owner
  review, so the author merges once CI passes, as decision 0005 says.

## Consequences

- A pull request that touches the other person's app asks them to review it; one that stays in
  your own app, or in docs and configuration, asks nobody (GitHub never requests the author).
- Changes to `packages/contracts` still reach nobody automatically, as under 0005; the author says
  so in the pull request when a contract change matters to the other side.
