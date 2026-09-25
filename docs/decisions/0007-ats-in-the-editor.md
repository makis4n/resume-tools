# 0007. The ATS in the editor

Date: 2026-09-25 · Status: proposed; needs the editor owner's agreement

## Context

Decision 0001 places the ATS panel inside the editor, in `apps/editor/src/features/ats`, owned by
both of us. `docs/editor-plan.md` mentions neither the panel nor the ATS: its side panel holds
structure edits, and its milestones do not include the analysis. The ATS product requirements
(`docs/ats-prd.md`) add a second way in, a page that checks a PDF from any tool, and need the
editor to hand over the exact PDF it offers for download. All three are changes to the editor, so
they need its owner's agreement. `editor-plan.md` is not edited; this record carries them.

## Decision

- **Panel.** A **Resume analysis** tab in the editor's side panel, beside the structure edits. It
  holds the job-description flow, the **Analyse resume** button and the results. Nothing in it
  shows LaTeX, compiler output or service errors.
- **Check page.** A page in the editor app, working title `/check`, that takes a PDF from the
  user's device and shows the same job-description flow and results. It never opens the PDF in
  the editor.
- **One implementation.** The panel and the check page share one API client, one requirement-review
  component and one results component, all in `apps/editor/src/features/ats`. The client validates
  responses against `packages/contracts` and ignores properties it does not know (decision 0006).
- **The PDF.** The compile path exposes the downloadable PDF's bytes to the panel, the same bytes
  the download button saves. The panel compiles first if the resume has changed since the last
  compile.
- **Who builds what.** Keaen builds the contents of `features/ats`. The editor owner decides where
  the tab and the route sit, and adds the hook that exposes the PDF.
- **Curated-template gate.** Each curated template, compiled with invented content, passes the ATS
  readiness checks with no critical finding and no layout warning. A failure is a template bug.
  The mechanism is settled when the editor first produces PDFs: most likely the editor's CI
  compiles the templates and hands the PDFs to a job that runs the ATS checks over HTTP or its
  command line, so neither app imports the other.

## Consequences

- The side panel gains a second purpose, and the product gains a page the plan does not describe.
- ATS milestone 2 waits on the editor's PDF export, which is part of the curated-editor milestone.
  ATS milestones 0 and 1 do not wait: they use synthetic PDFs.
- Templates that fail the gate need fixing before launch, such as missing Unicode mappings for
  icon fonts or ligatures, or a two-column reading order. That is editor work the plan did not
  count.
- The check page sends outside PDFs to the ATS. The plan's rule that resume content stays in the
  browser still holds, because sending a PDF to the ATS is its stated exception and always follows
  a user action.
