# 0003. Engine spike findings

Date: 2026-09-16 · Status: proposed

## Context

The plan's first milestone is a spike that answers the questions the design rests on: can
pdfTeX in the browser recompile a resume from a saved format fast enough, can XeTeX keep
system fonts in a format, can the output be turned into clickable SVG with markers intact,
how far does an overlay drift from the real page, and what does a first load weigh. This
record holds the measurements and the changes they force. The numbers come from an M4 Pro
laptop, in Chrome inside the desktop app and in Node; the slow-laptop numbers the plan asks
for are still to be taken. The harness and page that produced them are in
`apps/editor/spike/` and `apps/editor/spike.html`.

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
| XeTeX from a format that holds no native font | 210 ms for a body on metric fonts; fontspec itself adds 475 ms; one family loaded through fontspec brings a body to about 1 s |
| SVG with markers | Every marker survives as a `\special`. On a 30-field page, 852 of 852 glyphs resolve to their own character and 30 of 30 fields resolve from a click at a glyph's centre |
| Overlay drift, three-line bullet, same font | Baseline within 0.5 pt, and 3 pt mean horizontal shift on the same line with the overlay set ragged-right like the page. The browser and TeX break one line differently, which moves 7 of 204 glyphs to another line and shifts glyphs around that break by up to 36 pt. An earlier reading of 12 pt mean came from the overlay justifying a paragraph TeX had set ragged, and is withdrawn |
| First load, pdfTeX path | Not measured as a transfer: nothing in the spike fetches TeX Live files on demand yet, and the page loads three whole bundles, 199 MB. Projected from file sizes: engine 30.4 MB raw, 12.1 MB gzip, 9.5 MB Brotli, for all engines in one binary; format 6.7 MB, 6.3 MB gzip; the 0.1 MB of TeX Live files a body compile reads, found with the engine's recorder; glyph outlines about 50 KB per font. About 16 MB compressed once files are fetched on demand |
| Rendering cost | Parsing the DVI, aligning fields and building the SVG takes 2 ms; putting 876 glyph elements in the DOM takes 2 ms |

## Decision

- pdfTeX templates keep the plan's edit loop unchanged: preamble dumped once into a format,
  body recompiled per edit. The target of 300 ms holds with room on this machine. A document
  opens with two compiles, because the first pass writes the auxiliary files the second one
  reads, and the worker keeps those files between edits; after that one compile per edit is
  converged unless the log asks for a rerun, in which case the worker runs once more.
- XeTeX templates get a different loop. The format is dumped from a preamble that never
  loads a native font, by forcing a metric font encoding before the document class
  (`\RequirePackage[OT1]{fontenc}` ahead of `\documentclass`). Fonts are then declared per
  compile with plain XeTeX `\font` and NFSS declarations that the template package resolves
  at build time, not through fontspec at compile time. Fontspec, where a template needs it,
  runs at import time to discover the font files and features, and its result is baked into
  the package. Expected cost on this machine: roughly half a second per compile instead of
  ten.
- The generated LaTeX wraps every editable field as
  `\texorpdfstring{\leavevmode\special{rt:b:<id>}<text>\special{rt:e:<id>}}{<text>}`.
  Without `\leavevmode` a field that starts a list item swallows the item's bullet. Without
  `\texorpdfstring` hyperref copies the marker text verbatim into the PDF bookmarks, where a
  reader shows it, which the product rules forbid; with it, bookmarks hold only the text and
  the markers still reach the DVI. Other moving contexts, running headers among them, are
  for the probe step to detect.
- The page is drawn from glyph outlines extracted from the Type 1 fonts ahead of time, one
  path per glyph and one `<use>` per typeset glyph, with the glyph's field and character
  offset as data attributes. The same outlines become the OpenType web font the overlay is
  set in. Hit areas are the glyphs' bounding boxes, not their painted shapes.
- Multi-line fields need the plan's fallback: the overlay must break lines where TeX did,
  since a differently broken line moves whole words. Within a line the drift is a few
  points, and single-line fields are within a point, so they need nothing.
- XDV rendering of native-font runs is parsed but not yet drawn; it needs the font files'
  outlines in the browser and comes with the XeTeX work above.

## Consequences

- Two compile loops to maintain, and XeTeX templates will feel slower than pdfTeX ones on
  every machine. The debounce for XeTeX templates should be longer, as the plan foresaw.
- The template package grows a "resolved fonts" section for XeTeX templates.
- The overlay needs its own line breaker using the TFM widths for any field that wraps.
- First load is under 30 MB only as a projection, only compressed, and only once TeX Live
  files are fetched on demand, which is not built. A per-engine build is still wanted to cut
  the 30 MB binary, and the format is the next largest item.
- unicode-math was dropped from the Awesome-CV test because its math font was not in the
  bundles at hand; it will add to the per-compile cost of that template and should be
  measured when the TeX Live file server exists.
- The slow-laptop measurements the plan calls for remain open.
