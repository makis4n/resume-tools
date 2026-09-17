# XeTeX loop on Awesome-CV: measurements

Produced by `spike/xetex-loop.cjs` on 2026-09-17, Node 24, M4 Pro laptop, BusyTeX build of
TeX Live 2023. The decision record `docs/decisions/0003-engine-spike-findings.md` proposes this
loop and predicts about half a second per compile; this is the first time it was run.

## Numbers

Quiet machine (load average about 7 from unrelated work; a run under load average 10 gave
roughly twice every number below, 847 ms for the body, so treat these as best case on this
laptop).

| Step | Result |
|---|---|
| Dump the format (class minus the three font packages and fontspec, `\RequirePackage[OT1]{fontenc}` in front of `\documentclass`) | 2.8 s, 8,998,232 bytes |
| Body compile, run 1 (writes `.aux` and `.out`) | 652 ms |
| Body compile, runs 2 to 6 | 467, 459, 464, 456, 459 ms; **warm median 459 ms** |
| Same body with the font declarations dumped into the format instead of sent per compile | 455 ms warm median, identical XDV |
| Plain compile with fontspec (`acv.cjs`, same session) | 10.1 to 10.8 s |
| `xdvipdfmx` on the loop's XDV | 210 ms, 58,461 bytes (the fontspec compile's PDF is 58,864 bytes) |

Cost breakdown, one small body per step, warm median of three:

| Body | ms | Delta |
|---|---|---|
| cm fonts only, no TU, no declarations | 234 | floor of a body compile from this format |
| `\usepackage[TU]{fontenc}` | 458 | +224: the package's `\usefont` selects Latin Modern regular, the first native face of the run, and a font the resume never uses |
| TU by `\renewcommand\encodingdefault{TU}` plus one declared Source Sans face, selected | 413 | +179: the first native face of the run |
| all shims declared, the 12 faces the resume uses each selected once at 10pt | 418 | +5 for 11 more faces |
| same without `mapping=tex-text` | 415 | the mapping costs nothing measurable |
| the full resume body (3 pages, 18 font instances, hyperref) | 459 | +41 for the document itself |

So the loop is the metric-font floor plus one fixed 180 ms for the first native face plus about
50 ms for everything else. The per-face 200 to 350 ms the record attributes to fontspec is gone.

Output comparison, `dvi-inspect.cjs` on `assets/out/acv-plain.xdv` (fontspec) against
`assets/out/acv-loop.xdv` (this loop):

| | fontspec | loop |
|---|---|---|
| pages | 3 | 3 |
| native glyph runs | 1379 | 1379 |
| rules | 5 | 5 |
| TFM fonts | cmsy8 | cmsy8 |
| native font instances | 18 | 18, same files at the same sizes |
| specials | 470 | 466 (see below) |
| file size | 111,064 | 110,884 |

Page 1 of the loop's PDF rendered and checked by eye: Roboto light and bold name, small caps in
the position line, job titles and footer, Font Awesome icons at 6.8pt, curly quotes in the quote
line, light italic dates. The `tex-text` mapping is needed and works: an `hbox{--}` is 5.256pt
with it and 6.811pt (two hyphens) without; `` ``'' `` is 9.33pt against 17.32pt.

## What had to change

1. **fontspec has to leave the class too, not just the three font packages.** With
   `\RequirePackage[quiet]{fontspec}` still in `awesome-cv.cls`, the dump fails:
   ```
   \font\TU/lmr/m/n/10.95=[lmroman10-regular]:mapping=tex-text;
   ! Can't \dump a format with native fonts or font-mappings.
   ```
   fontspec's own loading runs `\RequirePackage[TU]{fontenc}`, and fontenc ends with
   `\usefont\encodingdefault\familydefault\seriesdefault\shapedefault`, which selects Latin
   Modern at the class's 11pt size. `xetex-bisect2.cjs` did not hit this because it used
   `article` at 10pt, where the stock format already has a `TU/lmr/m/n/10` font name set, so
   nothing new was loaded. Pre-defining `TU/lmr/m/n/10.95` as `\nullfont` only moves the
   failure to `TU/lmr/bx/n/10.95`. The script strips `\RequirePackage[quiet]{fontspec}` and
   `\defaultfontfeatures{Ligatures=TeX}` from the class; the mapping goes into the declarations
   instead. The script runs the fontspec-kept dump once at the start to show the failure.
2. **The shims** (`shims()` in the script): `\DeclareFontFamily{TU}{Roboto}{}` and
   `\DeclareFontShape{TU}{Roboto}{m}{n}{<->"[fonts/Roboto-Regular.ttf]:mapping=tex-text"}{}` for
   every face, with series `m`, `b`, `l`, `mb` (Roboto) and `m`, `b`, `l`, `sb` (Source Sans 3),
   `bx` substituted to `b` and `sl` to `it` with `ssub*`, and small caps as the same file with
   `;+smcp` (Source Sans 3 has the feature; Roboto does not and the class never asks for it).
   `\roboto`, `\robotolight`, `\sourcesanspro`, `\sourcesansprolight` are
   `\fontencoding{TU}\fontfamily{..}\selectfont` plus `\fontseries{l}`. What sourcesanspro's
   `default` option does is three `\renewcommand`s: `\encodingdefault` to `TU`, `\rmdefault`
   and `\sfdefault` to the family.
3. **Icons are NFSS families, not a raw `\font`.** A raw `\font` has one size; the class sets the
   header line to 6.8pt with `\fontsize`, so `\FAsolid` is
   `\fontencoding{TU}\fontfamily{FA5solid}\selectfont` over a one-shape family, and `\faMobile`
   is `{\FAsolid\symbol{"F10B}}`. No mapping on the icon fonts.
4. **TU needs no package in the body.** `tuenc.def` is part of the stock `xelatex.fmt`, so the
   encoding exists in our format as well; `\fontencoding{TU}` works and the only thing to set is
   `\encodingdefault`, so that `\normalfont` does not fall back to OT1 Computer Modern.
   `\usepackage[TU]{fontenc}` in the body works too but costs 45 ms more and loads a Latin
   Modern face the document never uses.
5. **The declarations can live in the format.** `\DeclareFontShape` loads nothing until a face is
   selected, so a format dumped with all the shims and the `\encodingdefault` change but no
   `\selectfont` dumps fine (2.9 s, 8,999,879 bytes), and the body then carries only content:
   455 ms, same XDV. The record's "declared per compile" is a choice, not a need.
6. **Preamble split.** The example's `\name` ... `\quote` were moved out of the dumped preamble
   into the body, since those are what the user edits. They are plain `\def`s and work there.
   The class options, `\geometry`, `\colorlet`, `\setbool` and `\acvHeaderSocialSep` stay in the
   format.

The class patches from `acv.cjs` (tcolorbox dropped, unicode-math dropped, `\bullet` to
`\textbullet`, `\cdotp` to `{$\cdot$}`) are kept.

## Warnings and errors in the logs

- Body log: four `LaTeX Font Warning: Font shape 'OT1/cmr/m/n' in size <3.8> not available`
  lines (and OML, OMS) plus `Size substitutions with differences`. These are the Computer
  Modern math fonts at script-script size for the `$\cdot$` in the 7.6pt position line, a
  consequence of unicode-math being dropped, the same in both compiles (both XDVs use cmsy8).
  Nothing about undefined font shapes, nothing from fontspec.
- Dump log: clean except the fontspec-kept variant's failure quoted above.
- The loop's XDV lacks four specials the fontspec compile has: `pdf:majorversion 1`,
  `pdf:minorversion 5`, `dvipdfmx:config C 0x0010` and one `color push gray 0`. The first
  three are hyperref's `\AtBeginShipoutFirst` material (`hxetex.def` lines 79 and 226). This is
  a property of `\dump`, not of the font work: `article` plus `hyperref` plus `bookmark`, dumped
  and compiled with a one-letter body, loses the same three specials against a whole compile
  (checked in a scratch script; the specials sequence is otherwise identical). `xdvipdfmx`
  still writes PDF 1.5 and the PDF is 400 bytes smaller. Harmless for drawing the page; the
  body could re-emit them if the download PDF should match exactly.

## Against the decision record

- **Confirmed:** about half a second per compile, 459 ms here against 10.2 s with fontspec,
  the same page count, glyph runs and font instances as the fontspec output, and the PDF path
  still works.
- **Not enough on its own:** "forcing a metric font encoding before the document class" does not
  dump a class that loads fontspec. The template build step has to remove (or replace) fontspec
  and everything that calls it (`\defaultfontfeatures`, `\setmainfont`, `\newfontfamily`), not
  only the font packages. The record's sentence that fontspec "runs at import time" covers this
  in intent; the consequence for the importer is stronger than the record states.
- **Weaker than needed:** fonts do not have to be "declared per compile". Declarations belong in
  the format; only `\selectfont` must not run before `\dump`.
- **Numbers to update:** body floor 234 ms (record: 210), first native face about 180 ms
  (record: 160), the format is 9.0 MB against 6.7 MB for Jake's Resume. The record's XeTeX
  fontspec figures stand.
- **New:** a `\dump` loses hyperref's first-shipout specials on XeTeX. The pdfTeX comparison in
  `jake-fmt.cjs` was byte-identical, so this is worth a look when the XeTeX renderer or download
  path cares about PDF version specials.
- **Machine load matters:** the same script gave 847 ms under a load average of 10, so the
  slow-laptop numbers the plan asks for are still open, and the XeTeX debounce should assume
  the worse figure.

## Files

- `spike/xetex-loop.cjs`: the script. Run from `apps/editor` with `SPIKE_ASSETS` and
  `SPIKE_OUT` set, after `acv.cjs` has produced `acv-plain.xdv`.
- `$SPIKE_OUT/acv-loop-pre.fmt`, `acv-loop.xdv`, `acv-loop.pdf`: outputs.
