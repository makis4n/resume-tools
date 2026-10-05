# 0003. Engine spike findings

> Superseded by 0066 in its slow-laptop measurements: the slow laptop's run is dropped, and
> the targets are judged on an M4 Pro, in Node and in the browser.

Date: 2026-09-16 · Status: proposed; its slow-laptop measurements are dropped by 0066

## Context

The plan's first milestone is a spike that answers the questions the design rests on: can
pdfTeX in the browser recompile a resume from a saved format fast enough, can XeTeX keep
system fonts in a format, can the output be turned into clickable SVG with markers intact,
how far does an overlay drift from the real page, and what does a first load weigh. This
record holds the measurements and the changes they force. The numbers come from an M4 Pro
laptop, in Chrome inside the desktop app and in Node; the slow-laptop numbers the plan asks
for are still to be taken. The harness and page that produced them are in
`apps/editor/spike/` and `apps/editor/spike.html`.
The page was retired in milestone 2 item 23 (decision 0016); the Node scripts remain.

The engines are the prebuilt BusyTeX WebAssembly build of TeX Live 2023 (Emscripten
3.1.43), one 30 MB binary holding pdfTeX, XeTeX, LuaHBTeX and xdvipdfmx. Our own per-engine
build from TeX Live sources is still to do; nothing below depends on it except size.

## Findings

| Question | Answer |
|---|---|
| Jake's Resume from a saved format, warm, in the browser | 100 to 110 ms median (135 ms in Node); about 600 ms for the first compile after load; 1.4 s per compile of the whole document from the stock `pdflatex.fmt` (1.55 s in Node) |
| Dumping the preamble into a format | 1.4 to 1.7 s, 6.7 MB, and the body compiled from it is byte-identical to a compile from the stock format |
| XeTeX system fonts in a format | **No.** `\dump` fails with "Can't \dump a format with native fonts or font-mappings" as soon as any OpenType font or a TeX text mapping has been loaded, which `\documentclass` alone does on XeLaTeX |
| XeTeX, Awesome-CV, plain compile | 10.2 s per compile. Fontspec loads about fifteen faces and its probing costs 200 to 350 ms per face; XeTeX's own font loading is a one-off 160 ms for the first face and near zero after |
| XeTeX from a format that holds no native font | 235 ms for a body on metric fonts; fontspec itself adds 475 ms; one family loaded through fontspec brings a body to about 1 s |
| XeTeX, Awesome-CV, the loop decided below | 459 ms warm median in Node (847 ms with the machine under load), against 10.2 s with fontspec. The format dumps in 2.8 s to 9.0 MB. The first native face costs about 180 ms, the other eleven 5 ms together, the `tex-text` mapping nothing. Same pages, glyph runs and native fonts as the fontspec compile; xdvipdfmx makes the PDF in 210 ms. `apps/editor/spike/xetex-loop-report.md` has the breakdown |
| unicode-math on that loop | 3.6 s per compile (3,587 ms warm median) with `\setmathfont` naming the file, 3.8 s with a display formula on the page, against 395 ms for the same page with text symbols; it cannot be dumped, since it loads fontspec and a native font. Awesome-CV uses it only for a bullet and a centred dot: taking those two glyphs from the math font as an ordinary NFSS family costs 2 ms. Measured with New Computer Modern Math, an OpenType math font like Latin Modern Math; `spike/unicode-math.cjs` |
| SVG with markers | Every marker survives as a `\special`. On a 30-field page, 852 of 852 glyphs resolve to their own character and 30 of 30 fields resolve from a click at a glyph's centre |
| Overlay drift, three-line bullet, same font | Baseline within 0.5 pt, and 3 pt mean horizontal shift on the same line with the overlay set ragged-right like the page. The browser and TeX break one line differently, which moves 7 of 204 glyphs to another line and shifts glyphs around that break by up to 36 pt. An earlier reading of 12 pt mean came from the overlay justifying a paragraph TeX had set ragged, and is withdrawn |
| First load, pdfTeX path | Measured with TeX Live fetched on demand (`spike.html?ondemand=1`: the bundles unpacked into 13,840 individual files, each fetched the first time TeX opens it): building Jake's format fetches 74 files, 8.07 MB raw and 3.97 MB Brotli, of which the stock `pdflatex.fmt` is 6.48 MB raw and 3.66 MB Brotli, 53 package files 1.37 MB raw and 0.25 MB Brotli, and `ls-R` 0.17 MB raw; the first body compile then fetches 19 more files, 0.06 MB, and later compiles nothing. Mounting the file list (0.87 MB raw, 0.08 MB Brotli) takes 155 ms and the engine is ready in 237 ms instead of 565 ms. With the engine (30.4 MB raw, 9.5 MB Brotli, all engines in one binary) and the page's fonts (about 0.8 MB raw) the first load is about 14 MB compressed, against the 30 MB target |
| Rendering cost | Parsing the DVI, aligning fields and building the SVG takes 2 ms; putting 876 glyph elements in the DOM takes 2 ms |

## Decision

- pdfTeX templates keep the plan's edit loop unchanged: preamble dumped once into a format,
  body recompiled per edit. The target of 300 ms holds with room on this machine. A document
  opens with two compiles, because the first pass writes the auxiliary files the second one
  reads, and the worker keeps those files between edits; after that one compile per edit is
  converged unless the log asks for a rerun, in which case the worker runs once more.
- XeTeX templates get a different loop. The format is dumped from a preamble that never
  loads a native font, by forcing a metric font encoding before the document class
  (`\RequirePackage[OT1]{fontenc}` ahead of `\documentclass`) and by removing fontspec
  itself, not only the font packages: loading fontspec selects Latin Modern through the TU
  encoding and the dump fails. Fonts are declared with NFSS declarations that name the font
  files (`\DeclareFontShape{TU}{Roboto}{m}{n}{<->"[Roboto-Regular.ttf]:mapping=tex-text"}{}`),
  which the template package resolves at import time; fontspec runs there to discover files
  and features, and its `Ligatures=TeX` becomes the `tex-text` mapping. The declarations
  live in the format, since nothing loads until `\selectfont`, and the body carries content
  only. Measured on this machine: 459 ms per compile instead of ten seconds.
- The generated LaTeX wraps every editable field as
  `\texorpdfstring{\leavevmode\special{rt:b:<id>}<text>\special{rt:e:<id>}}{<text>}`.
  Without `\leavevmode` a field that starts a list item swallows the item's bullet. Without
  `\texorpdfstring` hyperref copies the marker text verbatim into the PDF bookmarks, where a
  reader shows it, which the product rules forbid; with it, bookmarks hold only the text and
  the markers still reach the DVI. Other moving contexts, running headers among them, are
  for the probe step to detect.
- The page is drawn from glyph outlines read out of the Type 1 fonts in the browser
  (`src/tex/type1.ts` interprets the charstrings; the spike first extracted them ahead of
  time with fontTools, which is now only the test oracle), one path per glyph and one
  `<use>` per typeset glyph, with the glyph's field and character offset as data
  attributes. The same outlines become the OpenType web font the overlay is set in. Hit
  areas are the glyphs' bounding boxes, not their painted shapes.
- Multi-line fields need the plan's fallback: the overlay must break lines where TeX did,
  since a differently broken line moves whole words. Within a line the drift is a few
  points, and single-line fields are within a point, so they need nothing. Decision 0004
  gives the overlay TeX's own line breaker and measures the drift at a pixel.
- XDV native-font runs are drawn from the font files' outlines: the renderer takes a source
  of outlines per native font (glyph paths in font units and the em size) and draws each
  glyph of a run at its own position, scaled to the font's size with xdvipdfmx's fake stretch
  and slant applied and the font's colour and opacity when it has one. The spike reads the
  files through opentype.js, a spike-only dependency; the editor will need its own reader or
  keep it. Emboldened runs, faces other than the first of a collection, and fonts whose
  outlines cannot be read are drawn as boxes rather than as shapes that differ from the PDF.
  Awesome-CV's first page draws in about 100 ms.

## Consequences

- Two compile loops to maintain, and XeTeX templates will feel slower than pdfTeX ones on
  every machine. The debounce for XeTeX templates should be longer, as the plan foresaw, and
  should assume the loaded-machine figure rather than the best case.
- `\dump` on XeTeX drops hyperref's first-shipout specials (PDF version, the dvipdfmx
  configuration, a colour push). Drawing is unaffected; the body must re-emit them if the
  downloaded PDF has to match a plain compile.
- The template package grows a "resolved fonts" section for XeTeX templates.
- The overlay needs its own line breaker using the TFM widths for any field that wraps;
  decision 0004 has it.
- First load is about 14 MB compressed with TeX Live files fetched on demand, which the
  spike worker now does; the engine binary is two thirds of it, so a per-engine build is
  still wanted, and the stock format is the next largest item. That format is fetched only
  to build the template's own format; a template format built once and served from the
  cache would replace both it and the package files, leaving a body compile at 0.06 MB of
  TeX Live files. Each on-demand file costs one synchronous request from the worker, so
  latency, not size, will decide how a cold start feels; the file list must be served with
  the engine and refreshed with TeX Live.
- unicode-math costs about 3.2 s per compile and cannot live in a format. A template that
  loads it only for symbols in text, as Awesome-CV does, gets the symbols from the math
  font as a plain family at import time, for 2 ms. A template that typesets mathematics
  keeps the package in the body, is marked slow, and gets the longer debounce; that case is
  rare in a resume. The math font itself was missing only because the spike's bundles are
  a subset of TeX Live; the on-demand file server holds all of it.
- The slow-laptop measurements the plan calls for remain open.

## Update, 24 September 2026

Most of the pdfTeX compile time measured above was kpathsea, TeX Live's file finder, and not
TeX. The trees the engine searched had no filename database, or one that covered only part of
them, so kpathsea listed folders to find each file, and in the engine every run starts from a
fresh heap, so it listed them again on every compile. The editor's engine session
(`apps/editor/src/engine/`, milestone 2 item 2) builds a database for every tree from the
manifest at start-up and tells kpathsea to use nothing else. The same Jake's Resume format and
body, measured in Node on the same laptop:

| | Spike | With the databases |
|---|---|---|
| Dump the preamble into a format | 1.4 to 1.7 s (3.4 s on this tree, which has more files) | 0.28 s |
| Compile the body from the format, warm median | 135 ms (280 ms on this tree) | 68 ms |

In Chrome on the same laptop, the engine starts in about 0.3 s, the format dumps in 0.37 s, a
new document's two passes take 0.15 s together, and an edit recompiles in 65 ms, against 100
to 110 ms in the spike. These were measured with the desktop app's browser pane in the
background, where a run under load came out four to five times slower, so the best of three is
reported.

The first load also no longer fetches TeX Live's `ls-R`, 0.17 MB. The XeTeX numbers were not
measured again; the session gives XeTeX the same databases.
