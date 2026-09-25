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
  (plan section 5.4); the accent colour named, as `rtaccent` in Jake's port, defined as upstream's
  colour and set wherever the template's accent goes, with xcolor in place of color, whose models
  cannot read the six hex digits the accent colour control gives, so that the control is an
  ordinary compile too (item 15); hyperref's bookmarks off, with `bookmarks=false`, since a
  one-page resume has no use for them and hyperref converts each section title into its bookmark
  in time that grows with the square of the title's length, about 4 s a pass for 8,000 characters
  against under a tenth of a second without; no marker macros, since the prelude defines them
  (decision 0007); and the file ends where the body would begin, since the generator writes the
  body.
- A port sets no field's text inside a transformed group, a TikZ node or anything else between a
  `pdf:btrans` and its `pdf:etrans`, since xdvipdfmx applies the transform and the page, drawn
  from the DVI, applies none, so it would draw the field where the PDF does not put it (decision
  0013, added after AltaCV's tags did). The harness's special check reports such a field.
- The licence notices of the template and of what it derives from stay in the preamble,
  verbatim, with the attribution in the package. Jake's Resume is based on sb2nov/resume, and
  about half of its preamble's code is sb2nov's, so the port carries Sourabh Bajaj's copyright
  line above Jake Gutierrez's, over the MIT permission notice the two share.
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
- Decision 0009 amends the list of what a port changes: a pdfTeX port also loads
  `\usepackage[T1]{fontenc}` and `\usepackage{lmodern}`, so that the page can draw the letters OT1
  cannot set, and the TS1 bullet and symbols; and `drawPage` no longer throws on a font it cannot
  draw.
- The loader imports each folder statically, as JSON and as text through Vite's `?raw`, since the
  app is a bundle with no file system; the same module serves the tests and item 7's harness, which
  therefore run under Vitest.
- Bookmarks off removes the one cost the review of item 6 found growing faster than a field's
  length, but nothing yet bounds a compile: the worker runs requests one at a time with no
  timeout, so a compile that runs long, for any reason, holds up every edit after it. Item 8,
  whose scheduler keeps one compile in flight, has to give it a time limit. The validation
  harness cannot bound a compile either, since the engine's call is synchronous: CI bounds it
  with the check job's time limit, and milestone 3's probe step, which runs the harness in the
  browser, has to run it in a worker it can terminate.
- Item 14 settled the two questions left to it above. Nothing is re-emitted: the PDF is PDF 1.5
  with xdvipdfmx's own compression either way, and lacks only named destinations nothing links
  to. The driver stays hyperref's alone: xdvipdfmx reads the dvips `color` and `papersize=`
  specials that `color` and geometry write, so a coloured rule reaches the PDF as `rg` and `RG`
  and the PDF is the page's size, and it passes over `l3backend`'s PostScript header. The
  validation harness checks the PDF's size and text layer.
- The page size comes from the output's `papersize=` special (pdfTeX) or its `pdf:pagesize` one
  (XeTeX, and geometry's xetex/dvipdfmx driver), which the page, the PDF and the harness all read
  the same way; xdvipdfmx is told a size (`-p`) only when the output names none, since a size given
  to it overrides `pdf:pagesize`, which is all XeTeX writes, and would clip an A4 page to Letter.
- xdvipdfmx does not honour `openin_any`, so a template's `\special` could read any file of the
  engine and embed it in the PDF. Before it runs, `session.pdf` scans every special and refuses one
  that reads a file or reconfigures the run: `pdf:image`, `pdf:img`, `pdf:epdf`, `pdf:fstream`,
  `pdf:mapfile`, `pdf:mapline`, dvips's `psfile=`, and a `dvipdfmx:config` whose option is anything
  but `C` (compatibility flags), `V` (PDF version) or `P` (permissions) — `f` loads a font map, `D`
  runs a command, and the rest change the output. Version one's PDFs therefore carry no images at
  all: a template's photo is an `extras` field (decision 0006), and a later item that wants images
  in the PDF must give xdvipdfmx a folder of its own to read from, not the shared tree.
