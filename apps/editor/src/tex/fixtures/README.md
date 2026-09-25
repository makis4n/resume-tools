# Test fixtures

Nothing here is real resume content; the DVI files were compiled from invented text.

| File | What it is |
|---|---|
| `jake.dvi` | Jake's Resume template compiled by pdfTeX with its example content replaced by invented text; one page |
| `hello.xdv` | A one-line XeTeX document in Source Sans 3, for the XDV opcodes |
| `cm*.tfm` | Computer Modern font metrics from the amsfonts distribution in TeX Live |
| `cmr10.pfb` | Computer Modern Roman 10 pt, Type 1, from the same distribution. Copyright (c) 1997, 2009 American Mathematical Society, SIL Open Font License 1.1 with Reserved Font Name CMR10; the licence is in `OFL.txt` |
| `cmr10.outlines.json` | The reference for `type1.test.ts`: `cmr10.pfb` as fontTools reads it, see below |
| `accents.dvi` | OT1 accents in `cmr10`: `caf\'e \'Etude na\"\i ve` in one field, and `\textasciitilde mara\^{}x` in another, compiled from the stock `pdflatex.fmt` by the editor's engine session in Node (`session.compile("pdftex", "stock", ...)`) |
| `8r.enc` | The TeX Base 1 encoding vector, from TeX Live's `fonts/enc/dvips/base`, public domain |
| `ptmr8t.vf`, `ptmr8t.tfm` | Times in T1, the virtual font over the raw `ptmr8r` and its metrics, from PSNFSS in TeX Live, LaTeX Project Public License |
| `jake-preamble.tex`, `body.tex` | The spike page's Jake's Resume, kept when the page was retired (milestone 2 item 23): the template's preamble with the spike's `\rtfield` marker macro, and a body of invented content with 30 marked fields. The session and page tests compile them, and so does `spike/jake-fls.cjs` |

## Regenerating `cmr10.outlines.json`

The reference was produced by fontTools with the script below (`uv run --with fonttools
python glyphs.py cmr10`, next to a `texfonts/` directory holding the `.pfb`). Its `name` is
the file's basename rather than the PostScript `/FontName`, and it carries a `fontMatrix`
key the parser does not return; the test compares only `encoding`, widths, path segments
and bounds. Path data uses fontTools' `H`, `V` and implicit repeated commands, which the
test normalises before comparing.

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
