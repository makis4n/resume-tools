# Engine spike

The Node scripts of the first milestone of [the plan](../../../docs/plan.md), kept because the
decision records cite them. The findings and the decisions they led to are in
[0003](../../../docs/decisions/0003-engine-spike-findings.md) and
[0004](../../../docs/decisions/0004-overlay-line-breaking.md), and the XeTeX loop's breakdown is
in [xetex-loop-report.md](xetex-loop-report.md).

The spike's page is gone. It was `spike.html`, with its code in `src/spike/` and its engine
worker and assets in `spike/web/`, and it was retired in milestone 2 item 23: the editor is the
page now (`pnpm dev`), and it measures itself with `pnpm --filter @resume-tools/editor measure`
and the app's `?measure=1` (decision
[0016](../../../docs/decisions/0016-milestone-2-measurements.md)). The page's Jake's Resume, its
preamble and its marked-up body, are test fixtures now, in `src/tex/fixtures/`. The Python script
that built the page's web fonts went with it: the editor builds them in the browser from the
page's own outlines (`src/page/webfont.ts`).

A checkout from before then may still hold the page's downloaded assets in `spike/web/assets/`,
about 500 MB. Nothing reads them now, and git still ignores the folder, so delete it:
`rm -r spike/web`.

## Assets

Everything large lives outside git, in `spike/assets/`, which is ignored. Every script takes
`SPIKE_ASSETS` to point elsewhere, and writes what it makes to `assets/out/`.

1. The engine and the TeX Live bundles of the BusyTeX WebAssembly release
   `build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1` (TeX Live 2023,
   Emscripten 3.1.43), into `spike/assets/busytex/`: `busytex.js`, `busytex.wasm`,
   `texlive-basic.{js,data}`, `ubuntu-texlive-latex-{base,recommended,extra}.{js,data}` and
   `ubuntu-texlive-fonts-recommended.{js,data}`, about 230 MB. `fetch-engine` keeps the same
   release, checked against its recorded hashes, in `.engine/downloads/`, so copy them from
   there, or download them:
   ```sh
   gh release download build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1 \
     -R busytex/busytex -D spike/assets/busytex -p 'busytex.*' -p 'texlive-basic.*' -p 'ubuntu-texlive-*'
   ```
2. Templates, into `spike/assets/templates/`: `jake/resume.tex` from jakegut/resume (MIT), and
   `awesome-cv/fa5/awesome-cv.cls` from posquit0/Awesome-CV at the last revision that used Font
   Awesome 5 (commit 964f99d3), with `awesome-cv/examples/resume.tex` and
   `awesome-cv/examples/resume/*.tex`.
3. Fonts for Awesome-CV, into `spike/assets/fonts/`: `roboto/Roboto-*.ttf` (from the Awesome-CV
   history, commit af40bb01), `fa5/FontAwesome5{Free-Solid-900,Free-Regular-400,
   Brands-Regular-400}.otf` (FortAwesome/Font-Awesome 5.15.4, renamed) and
   `sourcesans/OTF/SourceSans3-*.otf` (adobe-fonts/source-sans 3.052R); and for
   `unicode-math.cjs`, an OpenType math font: `NewCMMath-Regular.otf` (typst/typst-assets, GUST
   font licence; Latin Modern Math would do as well, but its GitHub copies are LFS pointers).

## The scripts

Run them from `apps/editor`, as `node spike/<script>`.

| Script | What it measures | Needs |
|---|---|---|
| `harness.cjs jake-stock` | Jake's Resume from the stock `pdflatex.fmt`, six runs | 1, 2 |
| `jake-fmt.cjs` | Dump Jake's preamble to a format, compile the body from it, compare DVIs | 1, 2 |
| `jake-fls.cjs` | Every file a body compile reads, with sizes, via `-recorder`, for the page's Jake's Resume | 1 |
| `acv.cjs` | Awesome-CV on XeTeX with shimmed font packages; format dumps with and without fonts | 1, 2, 3 |
| `xetex-bisect.cjs` | Where XeTeX's time goes: fontspec, faces by file, faces by name, packages | 1, 3 |
| `xetex-bisect2.cjs` | A format dumped before any native font, and bodies compiled from it | 1, 3 |
| `xetex-rawfont.cjs` | Raw `\font` loads against fontspec, to separate engine cost from package cost | 1, 3 |
| `unicode-math.cjs [font]` | What unicode-math costs per compile on the loop, against text symbols and against the math font declared as a plain family | 1, 3 |
| `xetex-loop.cjs` | The XeTeX loop of decision 0003 on Awesome-CV: a format with no native font, the body from it with file-named NFSS declarations instead of fontspec; findings in `xetex-loop-report.md`. It compares with `acv.cjs`'s output, so run that first | 1, 2, 3 |
| `extract-fonts.cjs` | Copy the Computer Modern Type 1 fonts, their TFMs and the pdftex map out of the bundle, into `assets/texfonts/` | 1 |
| `extract-texlive.cjs` | Unpack the bundles into individual files and a manifest, into `assets/texlive/`, as the page's on-demand mode read them; `fetch-engine` builds the editor's tree the same way | 1 |
| `fetched-size.cjs <list.json>` | Raw, gzip and Brotli sizes of a list of the tree's paths, as the page reported fetching them, by kind, from `extract-texlive.cjs`'s tree | 1 |
| `dvi-inspect.cjs <file>` | List a DVI or XDV file's fonts, specials and page structure | |

The harness runs the Emscripten module in Node. Two hacks make that work: a fake IndexedDB
whose `open` fails, so the bundle loaders fall back to reading their `.data` file with `fs`, and
a global named `BusytexPipeline` that the loaders bind to. Between runs the first 64 MB of the
heap are restored from a snapshot taken after initialisation, which is how BusyTeX itself makes
`main()` callable repeatedly. The editor's engine session (`src/engine/session.ts`) grew out of
it, and reads the tree one file at a time instead of mounting the bundles.
