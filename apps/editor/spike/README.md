# Engine spike

Throwaway harness for the first milestone of [the plan](../../../docs/plan.md). Findings
and the decisions they led to are in
[docs/decisions/0003-engine-spike-findings.md](../../../docs/decisions/0003-engine-spike-findings.md).
The code under `src/tex/` that the spike drives is not throwaway.

Two ways to run it: a browser page, and Node scripts for the experiments that only need
the engine.

## Assets

Everything large lives outside git, in `spike/assets/` for the scripts and in
`public/spike-assets/` for the page. Both are ignored.

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
   `sourcesans/OTF/SourceSans3-*.otf` (adobe-fonts/source-sans 3.052R).
4. Computer Modern Type 1 fonts and metrics: `node spike/extract-fonts.cjs` pulls them out
   of the bundle into `spike/assets/texfonts/`. Glyph outlines and web fonts are then built
   with the two Python scripts in the appendix, run with `uv run --with fonttools`, and the
   results copied to `public/spike-assets/fonts/*.json`, `public/spike-assets/tfm/*.tfm` and
   `public/spike-assets/webfonts/*.otf`. Python stays out of this app on purpose; the
   production path will read Type 1 fonts in TypeScript.
5. `public/spike-assets/` also needs the engine files from step 1 copied in. Vite copies all of
   `public/` into `dist/` on `pnpm build`, so remove `public/spike-assets/` before building the
   editor for real. Nothing deploys the build today.

## The page

```sh
pnpm dev            # then open http://localhost:5173/spike.html
```

It loads the engine in a worker (`public/spike/engine-worker.js`), dumps
`public/spike/jake-preamble.tex` into a format, compiles `public/spike/body.tex` (invented
content, 30 marked fields) and draws the DVI. Buttons: compile five times and print the
median, compile from the stock format, check that every glyph resolves to its own character,
hit-test every field from a click at a glyph centre, and open the overlay on the three-line
bullet and measure its drift. Clicking any glyph opens the overlay on that field; Escape
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
| `xetex-loop.cjs` | The XeTeX loop of decision 0003 on Awesome-CV: a format with no native font, the body from it with file-named NFSS declarations instead of fontspec; findings in `xetex-loop-report.md`. Needs `acv.cjs`'s output first |
| `extract-fonts.cjs` | Copy CM Type 1 fonts, TFMs and the pdftex map out of the bundle |
| `dvi-inspect.cjs <file>` | List a DVI or XDV file's fonts, specials and page structure |

The harness runs the Emscripten module in Node. Two hacks make that work: a fake IndexedDB
whose `open` fails, so the bundle loaders fall back to reading their `.data` file with
`fs`, and a global named `BusytexPipeline` that the loaders bind to. Between runs the first
64 MB of the heap are restored from a snapshot taken after initialisation, which is how
BusyTeX itself makes `main()` callable repeatedly.

## Appendix: font scripts

`glyphs.py`, run as `uv run --with fonttools python glyphs.py cmr10 cmbx10 ...` from a
directory holding `texfonts/`:

```python
"""Dump Type 1 glyph outlines (SVG path data, 1000 units per em, y up) and the built-in encoding to JSON."""
import json
import sys
from fontTools.t1Lib import T1Font
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.encodings.StandardEncoding import StandardEncoding

for name in sys.argv[1:]:
    f = T1Font(f"texfonts/{name}.pfb")
    gs = f.getGlyphSet()
    enc = f.font.get("Encoding")
    if not isinstance(enc, list):
        enc = list(StandardEncoding)
    glyphs = {}
    for gname in gs.keys():
        g = gs[gname]
        pen = SVGPathPen(gs)
        g.draw(pen)
        bp = BoundsPen(gs)
        g.draw(bp)
        glyphs[gname] = {"w": g.width, "d": pen.getCommands(), "b": bp.bounds}
    out = {"name": name, "fontMatrix": f.font["FontMatrix"], "encoding": enc, "glyphs": glyphs}
    with open(f"texfonts/{name}.json", "w") as fh:
        json.dump(out, fh)
```

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
