# Milestone 2: the curated editor

Written 24 September 2026, after the spike. This is the working plan for the second milestone in
[plan.md](plan.md) section 9. It turns the spike's harness into the editor and says in what order.
Each numbered item is one pull request, or a few if it grows past ten minutes of reading. Tick the
item in the same pull request that finishes it.

## The goal

From the plan: the package format, the three ported templates, page plus side-panel editing, the
style controls and fit to one page, browser storage, PDF export, and a warning when content spills
onto a second page.

**Done means** all three templates edit end to end within the targets in plan.md section 4.3,
every style control works on all three, and the validation harness runs on every change.

Not in this milestone: import (milestone 3), accounts (milestone 4), hosting and our own engine
build (milestone 5). Everything here runs on a laptop with the dev server.

## Where the spike left us

Kept and tested, in `apps/editor/src/tex/`: the DVI and XDV parser, the SVG renderer with field
markers, field collection and glyph alignment, TFM and Type 1 readers, and TeX's line breaker. The
numbers are in decisions 0003 and 0004: Jake's Resume recompiles in 100 to 110 ms, Awesome-CV in
459 ms on the XeTeX loop, the overlay sits within a pixel of the page, and a first load is about
14 MB.

Throwaway, in `apps/editor/spike/` and `src/spike/`: the engine worker, the page, the overlay and
the Node scripts. Their assets are downloaded by hand into ignored folders, and the TeX Live copy
the page uses holds three of BusyTeX's five bundles. It has no xcolor, TikZ, Font Awesome, Lato,
Roboto or Source Sans, so neither AltaCV nor Awesome-CV can compile against it.

## How the editor is laid out

All of it is in `apps/editor`, except the resume model.

| Where | What |
|---|---|
| `scripts/fetch-engine.ts` | Builds `.engine/`, ignored by git: the engine and a TeX Live 2023 tree, one file per path, with a manifest. The dev server serves it at `/engine/` |
| `src/engine/` | The engine session (on-demand files, heap reset, pdfTeX, XeTeX and xdvipdfmx runs), the worker around it, and a typed client. The same session runs in Node for tests and the harness |
| `src/tex/` | The converter from the spike, grown as the templates need |
| `src/page/` | Fonts found through the TeX Live tree, the page drawn as SVG, clicks resolved to fields |
| `src/templates/` | The package schema, the generator from model to LaTeX, and the curated packages |
| `src/editor/` | Document state and commands, the compile scheduler, the overlay, the side panel, the controls |
| `src/storage/` | Documents and formats in IndexedDB |
| `src/validate/` | The validation harness, run in CI |
| `scripts/measure.ts`, `src/measure/` | The editor measured against plan section 4.3: a command over every curated package in Node, and the app's `?measure=1` page (decision 0016) |
| `packages/resume-model` | The canonical model, version 1 of which this milestone settles |

## The work, in order

The order removes the biggest unknown first, as the plan's milestones do. Jake's Resume goes
end to end before the other two templates, so that the editing loop is proven on the fast path.

### Stage 1. The engine as product code

1. [x] **Fetch the engine and TeX Live for development.** `pnpm --filter @resume-tools/editor
   fetch-engine` downloads the pinned BusyTeX release (engine, `texlive-basic` and the four Ubuntu
   bundles), checks every file against a recorded hash, unpacks the bundles into one file per
   path, and writes the manifest. It replaces the spike README's manual steps for the engine.
2. [x] **Compile in a worker.** `src/engine/`: the session, a module worker and a client whose
   replies carry request ids. A format dump, a body compile, two passes when a document opens,
   and a rerun when the log asks for one. Done when Jake's spike preamble and body compile from
   product code in the browser and in Node, as fast as the spike did.
3. [x] **Draw the page.** `src/page/`: TFMs and Type 1 fonts looked up through the manifest and
   `pdftex.map`, outlines cached, the SVG drawn by `src/tex/svg.ts` in a React component, and a
   click resolved to a field and a character offset. Done when the spike's checks pass as tests:
   every glyph resolves to its own character, and every field resolves from a click.

### Stage 2. Templates as data

4. [x] **Decide the package format and model version 1.** Decision record 0006. A package is
   data rather than code, because the import pipeline will produce packages and the cache will
   store them. It holds the preamble, any class files, the style parameters, and snippets that
   map the model onto the template's macros, written in a small template language with slots.
   One generic generator walks the model. The same record settles the model changes the three
   templates need, such as ids on bullets, a section kind, labelled list items and dates stored as
   dates.
5. [x] **Generate LaTeX from the model.** Every user character either typesets or is dropped, so
   no text a user types can act as LaTeX. Rich runs become bold, italic and links. Markers wrap
   every field, and the paragraph special from decision 0004 goes next to each begin marker.
   Empty optional fields are left out, and field ids come from model ids so they survive a
   reorder. Pure functions with unit tests.
6. [x] **Port Jake's Resume.** Confirm the MIT licence, keep the attribution, and change only what
   the loop needs: hyperref's dvipdfmx driver, and geometry for page size and margins. The sample
   resume is invented.
7. [x] **Run the validation harness in CI.** For each curated package, compile the sample in Node
   and check that two passes converge, that every field keeps its markers and its glyphs align
   with its text, and that it fits on one page, since decision 0006 declares no page count. The
   PDF and the controls join the harness when they land. CI already builds `.engine/` from a
   cache keyed on the fetch script (item 2), so the harness runs in the existing job. Done when a
   package that loses a marker fails CI.

### Stage 3. Editing on the page

8. [x] **Open a document and recompile as it changes.** Document state is the model plus the
   style values as one JSON blob, changed only through commands, which gives undo for free. The
   scheduler debounces per engine, keeps one compile in flight and drops stale ones, and swaps
   the page without a flash. A compile error becomes a plain message, never a log.
9. [x] **Edit a plain field in place.** The spike's overlay as product code. A click opens the
   field at the clicked character. The text is set in a web font built in the browser from the
   page's own Type 1 outlines, with opentype.js as the writer, which retires the Python script.
   Lines break with TeX's breaker, using the parameters the paragraph special carries. Dates
   open a picker, because the date format control needs them stored as dates. A keystroke in the
   overlay stays under 16 ms.
10. [x] **Bold, italic and links.** Rich fields in Tiptap with the three marks and nothing else,
    TeX's line breaks shown through ProseMirror decorations, and one font face per run for the
    breaker. A link's address is edited in a popover.
11. [x] **Structure from the side panel.** Add, remove and reorder sections, entries, bullets and
    header links, and edit what the page does not show, such as link addresses.
12. [x] **Undo and redo** across page and panel, with one step per field visit rather than per
    keystroke.

### Stage 4. Keeping and exporting

13. [x] **Keep documents in the browser.** Dexie holds documents and each template's formats.
    TeX Live files use the HTTP cache under immutable paths, plus a prefetch of the files a
    template is known to read, since TeX asks for them synchronously. A small document list opens,
    creates and deletes documents.
14. [x] **Download a PDF, and warn about a second page.** xdvipdfmx in the worker turns the same
    DVI into the PDF. The PDF's text must be extractable, because the ATS reads it. A warning
    shows when the DVI has more than one page. The Ubuntu bundles' font maps are not in
    `pdftex.map`, which lists only TeX Live's basic fonts, so the fetch script has to merge them
    first, as `updmap` would; item 16 needs the same.

### Stage 5. Style controls

15. [x] **The controls that need no new fonts.** Each parameter is declared in the package and
    applied after the format and before `\begin{document}`, so a change costs one ordinary
    compile. This item covers page size, margins, accent colour, density and date format on
    Jake's Resume.
16. [x] **Fonts beyond Computer Modern.** `pdftex.map` entries, encoding vectors, virtual fonts
    and glyph names from the Adobe Glyph List, in the renderer and in the web fonts. Both the
    font control and AltaCV need them, since TeX Live's other pdfTeX families are re-encoded or
    virtual.
17. [x] **Font and font size.** Three or four families per template, from TeX Live. Sizes run
    from 9 to 12 pt in half points, with one format per size where the class fixes the size when
    it loads, and scalable Computer Modern for the half sizes.
18. [x] **Fit to one page.** The search in the worker: density, then margins, then font size,
    stopping at the first setting that fits. It undoes in one click.

### Stage 6. The other two templates

19. [x] **Grow the TeX Live tree.** TeX Live 2023 packages from the historic `tlnet-final`
    archive, checked against its package database, with `ls-R` and `pdftex.map` regenerated.
    This brings in pgf and TikZ, Font Awesome 5, Lato, Roboto and Source Sans, and tikzfill, which
    tcolorbox's skins library loads. It needs network access to a TeX Live mirror, which this
    development environment does not have yet.
20. [x] **Port AltaCV.** It stays on pdfTeX. A renamed class under the LPPL with attribution, pdfx
    dropped because the loop writes DVI, two columns through paracol, and icons from Font
    Awesome's Type 1 fonts. Measure what TikZ and tcolorbox in the format cost per compile before
    anything else.
21. [ ] **XeTeX templates.** Decision 0003's loop in the worker: a format holding no native font,
    and fonts declared by file. Native fonts are drawn through opentype.js, which becomes a
    runtime dependency, and the overlay's web fonts are the OpenType files themselves. The body
    re-emits the hyperref specials that `\dump` drops, so the PDF matches a plain compile.
22. [ ] **Port Awesome-CV.** A renamed class, its fonts from TeX Live, the name split into first
    and last, its controls, and XeTeX's longer debounce.

### Stage 7. Closing the milestone

23. [x] **Measure on the slow laptop and retire the spike page.** All three templates, every
    target in section 4.3, with the numbers recorded next to decision 0003's. A first pass on
    Jake's Resume should happen as soon as item 9 lands, so a miss shows up early. The spike's
    Node scripts stay, since the decision records cite them.

## Decisions this milestone makes

These are the defaults the work above assumes. Each gets a record in `docs/decisions/` in the
pull request that acts on it.

- **The TeX Live copy for development and CI is BusyTeX's TeX Live 2023,** extended from TeX
  Live 2023's final package archive (item 19). The engine and the files must be the same year,
  or formats and packages disagree. Our own engine build, and moving to a newer TeX Live, wait for
  milestone 5, since neither changes what the editor can do.
- **A template package is data, and one generator serves every package** (item 4).
- **Packages live in `apps/editor/src/templates/`** until the import pipeline or the shared cache
  needs them somewhere else. Moving them later is a rename.
- **opentype.js is the editor's OpenType reader and web font writer** (items 9 and 21). The spike
  treated it as temporary, and an OpenType writer of our own is not worth writing.
- **Dates are stored as dates and edited with a picker** (items 4 and 9). Typing a date as text
  would have to be parsed back, and the date format control cannot work on text.
- **pdfTeX templates load hyperref with the dvipdfmx driver** (item 6), so the PDF from the DVI
  keeps its links.

## Risks

- **Measured on a fast machine only, so far** (item 23, decision 0016). On an M4 Pro, Jake's
  Resume meets the keystroke target (0.07 ms against 16) and the typical edit (82 ms against
  300), and misses the first load as the dev server serves it, 42 MB uncompressed against 30,
  which milestone 5's CDN and engine build have to bring under. The slow laptop, AltaCV,
  Awesome-CV and fit to one page are still to measure, with the same command and page.
- **Awesome-CV may not meet the slow-laptop target.** The loop measured 459 ms at best and
  847 ms under load on an M4 Pro, against 500 ms on a 2019 laptop. The plan already accepts
  that XeTeX templates feel slower. The milestone bar should say so explicitly for XeTeX, or
  item 21 has to find more speed. Decide once item 23 has the numbers.
- **ProseMirror and TeX's line breaks** (item 10). ProseMirror owns the editable DOM, so the
  breaks have to come in as decorations. If that fights the editor, rich fields fall back to the
  browser's breaks until the compile lands, which decision 0004 accepts only for hyphenation. That
  fallback would need a new record.
- **TikZ and tcolorbox in AltaCV's format** could push its compile past 300 ms. Measure first in
  item 20.
- **Fonts beyond Computer Modern** (item 16) is converter work of unknown size: virtual fonts,
  re-encoding, and fonts whose glyph names are not standard.
- **The engine tree in CI** is about 200 MB. It is restored from the cache on most runs, and a
  cache miss costs a few minutes of download.
- **Network access to a TeX Live mirror** is needed for item 19, and is blocked in this
  environment.

## Owed from the spike, and where each lands

| Item | Where |
|---|---|
| Slow-laptop numbers | A first pass after item 9, then item 23 |
| The paragraph special the marker macro should emit (decision 0004) | Item 5 |
| An OpenType writer so the Python web font script can go | Item 9, using opentype.js |
| Hyphenation in the line breaker | Only when a port needs it; none is known to |
| Our own per-engine build in Docker | Milestone 5; it changes size and licensing, not behaviour |

## Owed from item 4's review, and where each lands

The adversarial review of decision 0006 (pull request #16) confirmed six findings, all fixed in
that pull request. Four questions it settled by assigning them to a later item rather than by code:

| Item | Where |
|---|---|
| Format names, one per combination of format-bound values, that fit the session's 64-character rule whatever the length of the package id | Item 5 |
| A bound on the generated body, since a package may expand a list slot any number of times | Item 5 |
| A stored choice a revised package no longer offers: store only the choices the user made, and decide whether such a document opens on the default or refuses | Item 13, done: a document keeps only its own choices, and one the package no longer offers is dropped, so it opens on the default (decision 0010) |
| Ids unique across packages: the loader refuses or re-mints an imported id not minted under the prefix decision 0006 sets | Milestone 3 |
