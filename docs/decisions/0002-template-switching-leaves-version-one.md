# 0002. Template switching leaves version one

Date: 2026-09-16 · Status: accepted

## Context

Switching templates with content preserved was in the version-one scope in 0001 and in the plan. It was removed to make version one smaller.

## Decision

- Version one supports one template per document.
- The canonical resume model stays as the storage format, and every template package keeps its mapping onto it, so switching can be added later as a feature rather than a migration.
- Template switching moves to the top of the after-launch list.

## Consequences

- Less work in the curated-editor milestone, and no switch warning to design.
- The import rule about template-specific extras still applies: nothing is dropped on import.
- `packages/resume-model` is unchanged.
