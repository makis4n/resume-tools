# Engine spike

Throwaway harness for the first milestone of [the plan](../../../docs/plan.md). Findings
and the decisions they led to are in
[docs/decisions/0003-engine-spike-findings.md](../../../docs/decisions/0003-engine-spike-findings.md).
The code under `src/tex/` that the spike drives is not throwaway.

Two ways to run it: a browser page, and Node scripts for the experiments that only need
the engine.

## Assets

Everything large lives outside git, in `spike/assets/` for the scripts and in
`spike/web/assets/` for the page. Both are ignored. The dev server serves `spike/web/` at
`/spike/` through a small plugin in `vite.config.ts`, so nothing under it can reach `dist/`.

1. Engine and TeX Live bundles from the BusyTeX WebAssembly release
   `build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1` (TeX Live 2023,
   Emscripten 3.1.43), into `spike/assets/busytex/`:
   `busytex.js`, `busytex.wasm`, `texlive-basic.{js,data}`,
   `ubuntu-texlive-latex-{base,recommended,extra}.{js,data}`,
   `ubuntu-texlive-fonts-recommended.{js,data}`. About 230 MB.
   ```sh
   gh release download build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1 \
     -R busytex/busytex -D spike/assets/busytex -p 'busytex.*' -p 'texlive-basic.*' -p 'ubuntu-texlive-*'
   ```
2. Templates into `spike/assets/templates/`: `jake/resume.tex` from jakegut/resume (MIT) and
   `awesome-cv/fa5/awesome-cv.cls` from posquit0/Awesome-CV at the last revision that used
   Font Awesome 5 (commit 964f99d3), plus `awesome-cv/examples/resume.tex` and
   `awesome-cv/examples/resume/*.tex`.
3. Fonts for Awesome-CV into `spike/assets/fonts/`: `roboto/Roboto-*.ttf` (from the
   Awesome-CV history, commit af40bb01), `fa5/FontAwesome5{Free-Solid-900,Free-Regular-400,
   Brands-Regular-400}.otf` (FortAwesome/Font-Awesome 5.15.4, renamed), and
   `sourcesans/OTF/SourceSans3-*.otf` (adobe-fonts/source-sans 3.052R), and an OpenType
   math font for `unicode-math.cjs`: `NewCMMath-Regular.otf` (typst/typst-assets,
   GUST font licence; Latin Modern Math would do as well but its GitHub copies are LFS
   pointers).
4. Computer Modern Type 1 fonts and metrics: `node spike/extract-fonts.cjs` pulls them out
   of the bundle into `spike/assets/texfonts/`. Copy the `.pfb` files to
   `spike/web/assets/type1/` and the `.tfm` files to `spike/web/assets/tfm/`; the page reads
   both directly (`src/tex/type1.ts` interprets the Type 1 charstrings in the browser). The
   web fonts the overlay is set in are still built with the Python script in the appendix, run
   with `uv run --with fonttools`, into `spike/web/assets/webfonts/*.otf`. Python stays out of
   this app on purpose; that script goes when the OpenType writer exists.
5. `spike/web/assets/` also needs the engine files from step 1 copied in.
6. For the on-demand mode (`spike.html?ondemand=1`), `node spike/extract-texlive.cjs` unpacks
   the bundles into `spike/web/assets/texlive/` as individual files (13,840 files, 257 MB)
   and writes `spike/web/assets/texlive-manifest.json`, the path and size of every file.
7. To draw XeTeX output, copy `assets/out/acv-loop.xdv` (from `xetex-loop.cjs`) to
   `spike/web/assets/xdv/` and the Roboto, Source Sans 3 and Font Awesome files from step 3
   to `spike/web/assets/xdv/fonts/`.

## The page

```sh
pnpm dev            # then open http://localhost:5173/spike.html, or spike.html?ondemand=1
```

It loads the engine in a worker (`spike/web/engine-worker.js`), dumps
`spike/web/jake-preamble.tex` into a format, compiles `spike/web/body.tex` (invented
content, 30 marked fields) and draws the DVI. With `?ondemand=1` the worker
loads no bundle: every file in the manifest becomes an empty file that knows its size, and
its contents are fetched with one synchronous request the first time TeX reads it; the log
then says what each step fetched, and `window.fetchedFiles` lists the paths for
`spike/fetched-size.cjs`. The native-font glyph runs of an XDV are drawn through opentype.js
(`src/spike/opentype.ts`), the only dependency the spike adds. Buttons: compile five times and print the
median, compile from the stock format, check that every glyph resolves to its own character,
hit-test every field from a click at a glyph centre, and open the overlay on the three-line
bullet and measure its drift, with TeX's line breaker (`src/tex/linebreak.ts`) or with the
browser's own breaks for comparison, and draw page one of the Awesome-CV XDV from step 7.
Clicking any glyph opens the overlay on that field; Escape
closes it.

## The scripts

All take `SPIKE_ASSETS` to point elsewhere and write outputs to `assets/out/`.

| Script | What it measures |
|---|---|
| `harness.cjs jake-stock` | Jake's Resume from the stock `pdflatex.fmt`, six runs |
| `jake-fmt.cjs` | Dump Jake's preamble to a format, compile the body from it, compare DVIs |
| `jake-fls.cjs` | Every file a body compile reads, with sizes, via `-recorder` |
| `acv.cjs` | Awesome-CV on XeTeX with shimmed font packages; format dumps with and without fonts |
| `xetex-bisect.cjs` | Where XeTeX's time goes: fontspec, faces by file, faces by name, packages |
| `xetex-bisect2.cjs` | A format dumped before any native font, and bodies compiled from it |
| `xetex-rawfont.cjs` | Raw `\font` loads against fontspec, to separate engine cost from package cost |
| `unicode-math.cjs [font]` | What unicode-math costs per compile on the loop, against text symbols and against the math font declared as a plain family |
| `xetex-loop.cjs` | The XeTeX loop of decision 0003 on Awesome-CV: a format with no native font, the body from it with file-named NFSS declarations instead of fontspec; findings in `xetex-loop-report.md`. Needs `acv.cjs`'s output first |
| `extract-fonts.cjs` | Copy CM Type 1 fonts, TFMs and the pdftex map out of the bundle |
| `extract-texlive.cjs` | Unpack the bundles into individual files plus a manifest, for the page's on-demand mode |
| `fetched-size.cjs <list.json>` | Raw, gzip and Brotli sizes of the files the on-demand page fetched, by kind |
| `dvi-inspect.cjs <file>` | List a DVI or XDV file's fonts, specials and page structure |

The harness runs the Emscripten module in Node. Two hacks make that work: a fake IndexedDB
whose `open` fails, so the bundle loaders fall back to reading their `.data` file with
`fs`, and a global named `BusytexPipeline` that the loaders bind to. Between runs the first
64 MB of the heap are restored from a snapshot taken after initialisation, which is how
BusyTeX itself makes `main()` callable repeatedly.

## Appendix: web font script

`t1tootf.py`, run as `uv run --with fonttools python t1tootf.py <outdir> cmr10 cmbx10 ...`:

```python
"""Build OpenType (CFF) web fonts from Type 1 fonts, so an overlay can be set in the page's own font."""
import sys
from fontTools.agl import toUnicode
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.t1Lib import T1Font

out_dir = sys.argv[1]
for name in sys.argv[2:]:
    t1 = T1Font(f"texfonts/{name}.pfb")
    gs = t1.getGlyphSet()
    names = [".notdef", *[n for n in gs.keys() if n != ".notdef"]]
    cmap = {}
    for n in names:
        u = toUnicode(n)
        if len(u) == 1 and ord(u) not in cmap:
            cmap[ord(u)] = n
    charstrings = {}
    metrics = {}
    for n in names:
        g = gs[n]
        bp = BoundsPen(gs)
        g.draw(bp)  # also sets g.width
        pen = T2CharStringPen(g.width, gs)
        g.draw(pen)
        charstrings[n] = pen.getCharString()
        metrics[n] = (g.width, bp.bounds[0] if bp.bounds else 0)
    fb = FontBuilder(1000, isTTF=False)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    fb.setupCFF(name, {"FullName": name, "FamilyName": name, "Weight": "Regular"}, charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": name, "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=1000, usWinDescent=300)
    fb.setupPost()
    fb.save(f"{out_dir}/{name}.otf")
```
