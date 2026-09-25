# 0008. pdfTeX templates take hyperref's dvipdfmx driver

Date: 2026-09-25 · Status: accepted

## Context

The compile loop writes DVI, so that the page and the downloaded PDF come from one output
(decision 0003), and item 14 makes the PDF from the DVI with xdvipdfmx. In DVI mode hyperref's
default driver is dvips, whose link specials xdvipdfmx ignores, so a PDF made that way would have
no links. Milestone 2 lists the driver as a decision item 6, the port of Jake's Resume, acts on.

## Decision

- A pdfTeX template loads hyperref with the `dvipdfmx` option, as Jake's port does with
  `\usepackage[hidelinks,dvipdfmx]{hyperref}`, and every later pdfTeX port does the same.
- A port changes only what the loop needs, and says so in a comment at the top of its preamble:
  the driver; `geometry` in place of whatever set the page size and margins, with defaults that
  reproduce the upstream layout, so that the page size and margins controls are ordinary compiles
  (plan section 5.4); no marker macros, since the prelude defines them (decision 0007); and the
  file ends where the body would begin, since the generator writes the body. The upstream
  licence notice stays in the preamble, verbatim, with the attribution in the package.
- A curated package lives in a folder named after its id, `apps/editor/src/templates/<id>/`,
  holding `template.json`, `preamble.tex`, any class or style files and `sample.json`, an
  invented resume that shows the template off; `curated.ts` assembles the folders at load and
  refuses one that does not validate or whose id is not its folder's name.

## Consequences

- Compiling from a dumped format drops the specials hyperref writes at the first shipout for its
  driver (`pdf:majorversion`, `pdf:minorversion`, `dvipdfmx:config`). Decision 0003 found this on
  XeTeX; item 6 found it on pdfTeX too. Item 14 re-emits them in the body or accepts xdvipdfmx's
  defaults, and checks the PDF's text layer, which is unverified until then.
- Only hyperref knows the driver. LaTeX's `l3backend` layer and the `color` package still write
  dvips specials (`header=l3backend-dvips.pro`, `color push`), which do not affect the page the
  editor draws from the DVI but may affect colour in the PDF. Item 14 decides whether the driver
  is set for the whole document, through the class option or `\PassOptionsToPackage`.
- LaTeX 2023 takes the first-level itemize bullet from the TS1 fonts, which the page cannot draw
  yet (decision 0007), and `drawPage` throws on such a font rather than reporting it, so one
  typed `$`, `€` or `°` loses the whole page until item 16 brings the fonts in or item 8 softens
  the failure. Jake's list sections therefore set their items one to a line without bullets, as
  its skills block does.
- The loader imports each folder statically, as JSON and as text through Vite's `?raw`, since the
  app is a bundle with no file system; the same module serves the tests and item 7's harness, which
  therefore run under Vitest.
