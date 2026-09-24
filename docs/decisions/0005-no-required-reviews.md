# 0005. No CODEOWNERS and no required reviews

Date: 2026-09-24 · Status: accepted

## Context

Decision 0001 required the other person's review on any change to their app or to a shared path,
and used `.github/CODEOWNERS` to request it. Branch protection never enforced either: it asks for
no approvals and no code-owner review. We have chosen to drop both.

## Decision

- Remove `.github/CODEOWNERS`.
- No pull request needs a review, including changes to the other person's app, `packages/`,
  `docs/decisions/` and `.github/`. The author merges once CI passes.
- Ownership stays as decision 0001 sets it, and the README's tree records it. The rest of 0001
  stands: pull requests only, squash merges, a new contract version for a breaking change.

## Consequences

- Neither of us is told when the other changes our app or the contract, unless the author says so.
  Changes to `packages/contracts` are the ones most likely to break the other side unnoticed.
- Nothing about branch protection changes.
