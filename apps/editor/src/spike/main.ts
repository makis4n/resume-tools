/**
 * Spike page: compile a marked-up resume body in the browser, draw the DVI as SVG and
 * resolve clicks to fields. Throwaway; the tex/ modules it drives are not.
 */

import { type DviDocument, type DviFont, type PageItem, parseDvi } from "../tex/dvi";
import { alignGlyphs, collectFields, type Field } from "../tex/fields";
import { type FontOutlines, glyphText, textToCode } from "../tex/glyphs";
import { FIL_GLUE, LATEX_PARAMS } from "../tex/linebreak";
import { renderPage } from "../tex/svg";
import { parseTfm, scaleTfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import { type Layout, type OverlayHandle, openOverlay } from "./overlay";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const status = (s: string) => {
  $("status").textContent = s;
};
const log = (s: string) => {
  $("log").textContent = `${s}\n${$("log").textContent ?? ""}`.slice(0, 6000);
};
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

const worker = new Worker("/spike/engine-worker.js");
type WorkerMessage = { type: string; [k: string]: unknown };
// Replies carry the id of the request they answer, so overlapping calls cannot settle each other.
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (m: WorkerMessage) => void; reject: (e: Error) => void }
>();
worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const id = Number(e.data.id);
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (e.data.type === "error") p.reject(new Error(String(e.data.message)));
  else p.resolve(e.data);
};
const call = (msg: object, transfer: Transferable[] = []) =>
  new Promise<WorkerMessage>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });

const outlines = new Map<string, FontOutlines>();
const tfms = new Map<string, Uint8Array>();
async function loadFonts(doc: DviDocument) {
  const names = new Set([...doc.fonts.values()].map((f) => f.name));
  await Promise.all(
    [...names].map(async (n) => {
      if (!outlines.has(n)) {
        const bytes = async (url: string) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`${url}: ${r.status}`);
          return r.arrayBuffer();
        };
        const [o, t] = await Promise.all([
          bytes(`/spike/assets/type1/${n}.pfb`).then((b) => parseType1(new Uint8Array(b))),
          bytes(`/spike/assets/tfm/${n}.tfm`),
        ]);
        outlines.set(n, o);
        tfms.set(n, new Uint8Array(t));
      }
    }),
  );
}
const widthsFor = (font: DviFont) => {
  const t = tfms.get(font.name);
  return t ? scaleTfm(parseTfm(t), font.scale).widths : undefined;
};

/** Field texts, straight from the marked-up body. */
function fieldTexts(body: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const m of body.matchAll(/\\rtfield\{([^}]*)\}\{([^{}]*)\}/g))
    texts.set(m[1] ?? "", m[2] ?? "");
  return texts;
}

let doc: DviDocument | undefined;
let fields: Map<string, Field> | undefined;
let texts: Map<string, string> | undefined;
let overlay: OverlayHandle | undefined;
let preamble = "";
// ?ondemand=1: fetch TeX Live files one by one as TeX opens them instead of loading bundles.
const onDemand = new URLSearchParams(location.search).get("ondemand") === "1";
type Fetched = { requests: number; bytes: number; files: string[] };
const fetchedSoFar: string[] = [];
const logFetched = (what: string, f: Fetched | undefined) => {
  if (!f) return;
  fetchedSoFar.push(...f.files);
  log(
    `${what}: fetched ${f.requests} files, ${(f.bytes / 1e6).toFixed(2)} MB (${fetchedSoFar.length} so far)`,
  );
  (window as unknown as { fetchedFiles: string[] }).fetchedFiles = fetchedSoFar;
};

const svgEl = () => $("page").querySelector("svg") as SVGSVGElement | null;

/**
 * The paragraph TeX set a field in, for the overlay's line breaker. The spike knows only
 * Jake's bullets: \parshape 1 with LaTeX's list indentation and \raggedright, measured
 * with \message inside \resumeItem. A template package will carry this per field.
 */
const PT = 65536;
const BULLET_LINES = [{ indent: Math.round(34.93008 * PT), width: Math.round(507.09492 * PT) }];
function layoutFor(svg: SVGSVGElement, id: string): Layout | undefined {
  const first = svg.querySelector<SVGUseElement>(`use[data-field="${CSS.escape(id)}"]`);
  const name = first?.dataset.font;
  const size = Number(first?.dataset.size);
  const tfmBytes = name && tfms.get(name);
  const encoding = name && outlines.get(name)?.encoding;
  if (!tfmBytes || !encoding || !size) return undefined;
  const tfm = parseTfm(tfmBytes);
  const codes = textToCode(encoding);
  const ctm = svg.getScreenCTM();
  return {
    face: {
      tfm,
      metrics: scaleTfm(tfm, size * PT),
      codeFor: (ch) => codes.get(ch),
      hyphenChar: 45,
    },
    params: { ...LATEX_PARAMS, lines: BULLET_LINES, rightSkip: FIL_GLUE, parFillSkip: FIL_GLUE },
    pxPerSp: (ctm ? ctm.a : 1) / PT,
  };
}

let useBreaker = true;
async function showOverlay(id: string) {
  const svg = svgEl();
  const text = texts?.get(id);
  if (!svg || text === undefined) return;
  overlay?.close();
  overlay = openOverlay(svg, $("page"), id, text, useBreaker ? layoutFor(svg, id) : undefined);
  // The web font loads lazily on first use; measure only once it is in.
  await document.fonts.load(
    `${overlay.element.style.fontSize} ${overlay.element.style.fontFamily}`,
  );
  await document.fonts.ready;
  const r = overlay.report();
  log(
    `overlay ${r.field}: font ${r.font} ${r.fontPx.toFixed(2)}px, line ${r.lineHeightPx.toFixed(2)}px, align ${r.align}; ${r.glyphs} glyphs on ${r.svgLines} line(s) (overlay: ${r.overlayLines}); ${r.lineMismatches} on a different line; dx max ${r.maxDx.toFixed(2)}px mean ${r.meanDx.toFixed(2)}px; dy max ${r.maxDy.toFixed(2)}px`,
  );
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    overlay?.close();
    overlay = undefined;
  }
});

async function render(dvi: Uint8Array, body: string) {
  const t0 = performance.now();
  // Fonts are defined at the end of the DVI too, so a first parse without widths finds the names.
  const names = parseDvi(dvi, () => undefined);
  await loadFonts(names);
  const t1 = performance.now();
  doc = parseDvi(dvi, widthsFor);
  const page = doc.pages[0];
  if (!page) throw new Error("no page");
  const textOf = (item: PageItem) => {
    if (item.kind !== "glyph" || !doc) return undefined;
    const font = doc.fonts.get(item.font);
    const name = font && outlines.get(font.name)?.encoding[item.code];
    return name ? glyphText(name) : undefined;
  };
  fields = collectFields(page, textOf);
  texts = fieldTexts(body);
  let unmatched = 0;
  for (const f of fields.values()) unmatched += alignGlyphs(f, texts.get(f.id) ?? "");
  const svg = renderPage(doc, page, { outlines: (n) => outlines.get(n), fields });
  const t2 = performance.now();
  $("page").innerHTML = svg;
  const t3 = performance.now();
  const glyphs = page.items.filter((i) => i.kind === "glyph").length;
  log(
    `render: fonts ${(t1 - t0).toFixed(0)} ms (cached after first), parse+align+svg ${(t2 - t1).toFixed(0)} ms, DOM ${(t3 - t2).toFixed(0)} ms; ${glyphs} glyphs, ${fields.size} fields, ${unmatched} unmatched glyphs`,
  );
}

async function compile(body: string, times: number, stock = false) {
  const ms: number[] = [];
  let last: WorkerMessage | undefined;
  for (let i = 0; i < times; i++) {
    // The stock format knows nothing of the template, so it gets the whole document.
    last = await call({ type: "compile", body: stock ? `${preamble}\n${body}` : body, stock });
    ms.push(Number(last.ms));
    logFetched(`compile ${i + 1}`, last.fetched as Fetched | undefined);
    if (last.code !== 0 || !last.dvi) {
      log(`compile failed (exit ${String(last.code)}):\n${String(last.log).slice(-1500)}`);
      return;
    }
    log(
      `compile ${i + 1}: ${Number(last.ms).toFixed(0)} ms (+${Number(last.resetMs).toFixed(0)} ms heap reset)${stock ? " [stock format]" : ""}`,
    );
  }
  log(`median ${median(ms).toFixed(0)} ms over ${times}${stock ? " [stock format]" : ""}`);
  if (last?.dvi && !stock) await render(last.dvi as Uint8Array, body);
}

$("page").addEventListener("click", (e) => {
  const el = (e.target as Element).closest("[data-field]");
  for (const h of document.querySelectorAll(".hit")) h.classList.remove("hit");
  if (!el || !texts) {
    $("click").textContent = "no field under the click";
    return;
  }
  el.classList.add("hit");
  const id = el.getAttribute("data-field") ?? "";
  const offset = Number(el.getAttribute("data-offset"));
  const text = texts.get(id) ?? "";
  $("click").textContent =
    `field ${id}\noffset ${offset}\n"${text.slice(0, offset)}▮${text.slice(offset)}"`;
  showOverlay(id);
});

$("overlay").addEventListener("click", () => {
  useBreaker = true;
  showOverlay("exp1-i1");
});
$("overlay-browser").addEventListener("click", () => {
  useBreaker = false;
  showOverlay("exp1-i1");
});

$("hit").addEventListener("click", () => {
  // For every field, take its middle glyph and ask the DOM what sits at its centre.
  const svg = svgEl();
  if (!svg || !fields) return;
  let ok = 0;
  const bad: string[] = [];
  for (const id of fields.keys()) {
    const els = [...svg.querySelectorAll<SVGUseElement>(`use[data-field="${CSS.escape(id)}"]`)];
    const el = els[Math.floor(els.length / 2)];
    if (!el) {
      bad.push(`${id}: no glyphs`);
      continue;
    }
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (hit === el) ok++;
    else
      bad.push(`${id}: hit ${hit?.tagName} field=${(hit as HTMLElement | null)?.dataset?.field}`);
  }
  log(
    `hit-test: ${ok} of ${fields.size} fields resolve from a click at a glyph centre${bad.length ? `\n${bad.join("\n")}` : ""}`,
  );
});

$("check").addEventListener("click", () => {
  if (!fields || !texts || !doc) return;
  let ok_ = 0;
  const bad: string[] = [];
  for (const f of fields.values()) {
    const text = texts.get(f.id) ?? "";
    for (const g of f.glyphs) {
      const want = g.text;
      if (want === undefined) {
        bad.push(`${f.id}@${g.offset} glyph with no text`);
        continue;
      }
      const alternatives = want === "--" ? ["--", "\u2013"] : [want];
      const ok = g.inserted ? want === "-" : alternatives.some((w) => text.startsWith(w, g.offset));
      if (ok) ok_++;
      else
        bad.push(
          `${f.id}@${g.offset} glyph "${want}" text "${text.slice(g.offset, g.offset + 3)}"`,
        );
    }
  }
  log(
    `check: ${ok_} glyphs resolve to their own character, ${bad.length} do not${bad.length ? `\n${bad.slice(0, 10).join("\n")}` : ""}`,
  );
});

(async () => {
  const [pre, body] = await Promise.all([
    fetch("/spike/jake-preamble.tex").then((r) => r.text()),
    fetch("/spike/body.tex").then((r) => r.text()),
  ]);
  preamble = pre;
  status(onDemand ? "loading engine, TeX Live on demand…" : "loading engine and TeX Live bundles…");
  const ready = await call({
    type: "init",
    packages: ["texlive-basic", "ubuntu-texlive-latex-extra", "ubuntu-texlive-fonts-recommended"],
    onDemand,
  });
  const mounted = ready.mounted as { count: number; ms: number } | null;
  log(
    `engine ready in ${Number(ready.ms).toFixed(0)} ms, heap ${String(ready.heapMb)} MB${mounted ? `; ${mounted.count} on-demand files mounted in ${mounted.ms.toFixed(0)} ms` : ""}`,
  );
  logFetched("init", ready.fetched as Fetched | undefined);
  status("dumping the preamble into a format…");
  const dumped = await call({ type: "dump", preamble });
  log(
    `format: exit ${String(dumped.code)}, ${Number(dumped.ms).toFixed(0)} ms, ${(Number(dumped.size) / 1e6).toFixed(1)} MB`,
  );
  logFetched("format", dumped.fetched as Fetched | undefined);
  if (dumped.code !== 0) {
    status("format dump failed");
    log(String(dumped.log).slice(-2000));
    return;
  }
  status("compiling…");
  // Two passes: the first writes .aux/.out, the second is the converged page.
  await compile(body, 2);
  status("ready");
  $("compile").addEventListener("click", () => compile(body, 5));
  $("stock").addEventListener("click", () => compile(body, 2, true));
})().catch((e) => {
  status(`failed: ${e}`);
});
