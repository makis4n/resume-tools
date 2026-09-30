# 0035. The corpus runs by hand

Date: 2026-09-30 · Status: accepted; amends 0018 and 0033

## Context

Decisions 0018 and 0033 run `.github/workflows/corpus.yml` on a schedule, nightly and then weekly,
and milestone 3's item 17 adds the import run to it, about an hour on the free runner. A scheduled
run finds nothing new: every input is pinned, the documents by commit and SHA-256 (decision 0017),
the engine and its tree by the scripts that build them, and the naming answers by what is
committed, since CI holds no model key. On unchanged code a run repeats the last one; it finds
something only after a change, and the changes that can move it are few and easy to name. The
repository is private, so every run spends counted Actions minutes.

## Decision

- The workflow runs only when a person starts it (`workflow_dispatch`), from the Actions tab or
  with `gh workflow run corpus.yml --ref <branch>`, on any branch; never on a schedule, a push or
  a pull request. The same steps run locally through `corpus.ts`.
- A change is worth a run when it can move what the workflow reports: the import pipeline
  (`apps/editor/src/import/`), the naming request and its masking (`packages/naming/`), the corpus
  scripts and manifest (`apps/editor/scripts/corpus*.ts`, `apps/editor/corpus/`), and the
  engine's TeX Live tree (`apps/editor/scripts/fetch-engine.ts` and the scripts it uses). A change
  to what the naming request holds matters most, since the leak check is the proof that no
  resume text leaves the browser (decision 0033).
- Whether to run it is the author's call, and a run is never a merge requirement. AGENTS.md tells
  agents to suggest one, with the command, when their change touches those paths, and to start
  one only when asked; the README says the same for people.

## Consequences

- No minutes go on unchanged code; a run's cost falls on the change that needs it.
- The leak check no longer runs by itself: a change to the request's masking can merge unchecked
  when nobody starts a run. The agent's suggestion and the pull request's description stand in
  for the schedule.
- Item 17's bar, three runs in a row that agree, is met with runs started by hand, and its check
  against `corpus/baseline.json` runs whenever the workflow does.
- Decisions 0018 and 0033 describe the scheduled workflow; their status lines point here.
