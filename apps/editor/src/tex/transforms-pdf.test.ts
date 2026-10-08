import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outlineNodes } from "@resume-tools/resume-model";
import { strToU8 } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { readTree } from "../import/fonts";
import { treeImages } from "../import/intake";
import type { Probe } from "../import/probe";
import { COMPATIBILITY, readOutput } from "../import/reference";
import { isRefusal } from "../import/refusal";
import { type ImportDeps, importResume } from "../import/run";
import { drawPage } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { pdfOffsets, virtualCodes, worstOf as worstOfKind } from "../test/pdf-offsets";
import { parseTfm } from "../tex/tfm";
import { parseVf } from "../tex/vf";

// The page applies what xdvipdfmx's graphics state does to what it sets (decision 0081): a TikZ
// node's text, which pgf's dvipdfmx driver sets through a `pdf:btrans` translation, and graphicx's
// rotated and scaled boxes, `pdf:btrans rotate` and `x:scale`. Every text and every name here is
// invented.

/**
 * TikZ nodes as a template sets them, alone and in a picture, a scope shifting some; and graphicx's
 * rotated and scaled boxes. In Latin Modern's Type 1 fonts on either engine, whose glyphs are read
 * against the PDF by their codes.
 */
const NODES = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{tikz}
\pagestyle{empty}
\begin{document}
Plain words before \tikz[baseline=(t.base)]\node[draw,rounded corners,inner sep=2pt](t){Lantern tag};
and after.

\begin{tikzpicture}
\node at (2,1) {Second node};
\node[anchor=west] at (0,-1) {Third node};
\begin{scope}[shift={(3,0.5)}]\node[draw]{Shifted node};\end{scope}
\node[rotate=30] at (6,0) {Tilted node};
\end{tikzpicture}

\rotatebox{30}{Turned words} and \scalebox{1.5}[0.8]{Scaled words} and \rotatebox{90}{Upright}
\end{document}
`;

/**
 * A node set plainly, and five under a scope's `transform canvas`, which pgf writes as a `cm` of
 * its own around the node: turned, shifted, grown, and given a half turn twice over, which pgf
 * writes as `-1 0 0 -1 0 0 cm`, the half turn of its own pair around every node's text.
 */
const CANVAS = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{tikz}
\pagestyle{empty}
\begin{document}
Before words.

\begin{tikzpicture}
\node at (0,1) {Plain node};
\begin{scope}[transform canvas={rotate=30}]\node at (3,0) {Canvas turned};\end{scope}
\begin{scope}[transform canvas={shift={(2,0)}}]\node at (0,-1) {Canvas shifted};\end{scope}
\begin{scope}[transform canvas={scale=2}]\node at (1,-1) {Canvas grown};\end{scope}
\begin{scope}[transform canvas={rotate=180}]\node at (2,-2) {Canvas upside};\end{scope}
\begin{scope}[transform canvas={xscale=-1,yscale=-1}]\node at (4,-2) {Canvas mirrored};\end{scope}
\end{tikzpicture}
\end{document}
`;

/**
 * Words in a virtual font, Helvetica in T1 (`phvr8t`, drawn from the raw `phvr8r`), plainly and
 * in a node: its ligatures, quotes and accented letters are other codes in the raw font.
 */
const VIRTUAL = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{helvet}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{tikz}
\pagestyle{empty}
\begin{document}
Plain fine words.

\tikz\node{\textquotedblleft Office\textquotedblright{} caf\'e flow, \textbf{fifty} -- final};
\end{document}
`;

/** Words in a native font, set plainly, in a node, turned, scaled and tilted. */
const NATIVE = String.raw`\documentclass{article}
\usepackage{fontspec}
\usepackage{graphicx}
\usepackage{tikz}
\pagestyle{empty}
\begin{document}
Plain native words.

\tikz\node{Upright native node};

\rotatebox{30}{Turned native words}

\scalebox{1.5}[0.8]{Scaled native words}

\tikz\node[rotate=60]{Tilted native node};
\end{document}
`;

/**
 * Words scaled by `x:bscale`, and words after its `x:escale`, which undoes the scale about
 * another point and so leaves what follows moved.
 */
const BSCALE = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\pagestyle{empty}
\begin{document}
Before words.

\special{x:gsave}\special{x:bscale 1.5 1.5}Grown words \special{x:escale}after words\special{x:grestore}

Last words.
\end{document}
`;

/** The worst offset of one kind, printed beside the test that judges it, so a run shows each number. */
function worstOf(
  found: Parameters<typeof worstOfKind>[0],
  kind: Parameters<typeof worstOfKind>[1],
): ReturnType<typeof worstOfKind> {
  const worst = worstOfKind(found, kind);
  const test = expect.getState().currentTestName?.split(" > ").pop();
  console.info(
    `${test}: ${kind ?? "none"}, ${worst.operators} operators, ${worst.glyphs} glyphs, the most off ${worst.max.toFixed(4)} pt`,
  );
  return worst;
}

describe.skipIf(!engineAvailable())("translations, rotations and scales against the PDF", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let deps: ImportDeps;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    deps = {
      session,
      fonts,
      tree: readTree(manifest.files, manifest.fonts),
      treeImage: treeImages(
        manifest.files,
        (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
      ),
    };
  }, 60_000);

  /** A document compiled as an import's reference is, with dvipdfmx's drivers, and its PDF. */
  async function compiled(tex: string, job: string, engine: "pdftex" | "xetex" = "pdftex") {
    const result = session.compile(engine, "stock", strToU8(tex), {
      job,
      maxPasses: 2,
      files: COMPATIBILITY[engine],
    });
    if (!result.output) throw new Error(result.error);
    const made = session.pdf(job, { compress: 0 });
    if (!made.pdf) throw new Error(made.error);
    const { doc } = await readOutput(fonts, result.output);
    return { output: result.output, doc, pdf: made.pdf };
  }

  test.each(["pdftex", "xetex"] as const)(
    "sets every glyph a translation, a rotation or a scale moves where the PDF shows it, on %s",
    async (engine) => {
      const { doc, pdf } = await compiled(NODES, `nodes-${engine}`, engine);
      const found = pdfOffsets(doc, pdf);
      expect(found.unaligned).toBe(0);
      // The three upright nodes of the picture and the one inline, each its operator; and what is set
      // in none.
      const moved = worstOf(found, "translation");
      expect(moved.operators).toBe(4);
      expect(moved.max).toBeLessThan(0.5);
      expect(worstOf(found, undefined).max).toBeLessThan(0.5);
      // The tilted node and the two rotated boxes, and the scaled box, turned and scaled as the PDF
      // turns and scales them, their ends too.
      const turned = worstOf(found, "rotate");
      expect(turned.operators).toBe(3);
      expect(turned.max).toBeLessThan(0.5);
      const scaled = worstOf(found, "scale");
      expect(scaled.operators).toBe(1);
      expect(found.operators.every((each) => each.kind !== "matrix" && each.kind !== "other")).toBe(
        true,
      );
      expect(scaled.max).toBeLessThan(0.5);
    },
    60_000,
  );

  test("keeps text under a scope's transform canvas other: the PDF moves it, the page does not", async () => {
    // pgf writes the canvas's matrix as a cm of its own, which xdvipdfmx keeps no account of, so
    // the page leaves the text where the node's own translation puts it, and marks it.
    const { doc, pdf } = await compiled(CANVAS, "canvas");
    const found = pdfOffsets(doc, pdf);
    expect(found.unaligned).toBe(0);
    const plain = worstOf(found, "translation");
    expect(plain.operators).toBe(1);
    expect(plain.max).toBeLessThan(0.5);
    const canvas = worstOf(found, "other");
    expect(canvas.operators).toBe(5);
    expect(canvas.max).toBeGreaterThan(20);
    expect(worstOf(found, undefined).max).toBeLessThan(0.5);
  }, 60_000);

  test("compares a virtual font's glyphs in a node by the codes its packets set", async () => {
    const { doc, pdf } = await compiled(VIRTUAL, "virtual");
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const paths = new Map(
      Object.keys(manifest.files).map((path) => [path.slice(path.lastIndexOf("/") + 1), path]),
    );
    const read = (file: string) => {
      const path = paths.get(file);
      return path === undefined
        ? undefined
        : new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path)));
    };
    const codesOf = virtualCodes(
      (name) => {
        const bytes = read(`${name}.vf`);
        return bytes && parseVf(bytes);
      },
      (name) => {
        const bytes = read(`${name}.tfm`);
        return bytes && parseTfm(bytes);
      },
    );
    // By the DVI's own codes, the operators with a ligature, a quote or an accent are not found.
    expect(pdfOffsets(doc, pdf).unaligned).toBeGreaterThan(0);
    const found = pdfOffsets(doc, pdf, codesOf);
    expect(found.unaligned).toBe(0);
    const translated = found.counts.find((each) => each.kind === "translation");
    expect(translated?.glyphs).toBeGreaterThan(20);
    expect(translated?.compared).toBe(translated?.glyphs);
    const plain = found.counts.find((each) => each.kind === undefined);
    expect(plain?.compared).toBe(plain?.glyphs);
    expect(worstOf(found, "translation").max).toBeLessThan(0.5);
    expect(worstOf(found, undefined).max).toBeLessThan(0.5);
  }, 60_000);

  test("sets a native font's glyphs where the PDF shows them, in a translation, a rotation or a scale", async () => {
    const { doc, pdf } = await compiled(NATIVE, "native", "xetex");
    const found = pdfOffsets(doc, pdf);
    expect(found.unaligned).toBe(0);
    expect(found.operators.every((each) => each.native)).toBe(true);
    for (const [kind, operators] of [
      [undefined, 1],
      ["translation", 1],
      ["rotate", 2],
      ["scale", 1],
    ] as const) {
      const worst = worstOf(found, kind);
      expect(worst.placed, kind).toBeGreaterThanOrEqual(operators);
      expect(worst.max, kind).toBeLessThan(0.5);
    }
  }, 60_000);

  test("moves what follows an x:escale about another point as the PDF does", async () => {
    const { doc, pdf } = await compiled(BSCALE, "bscale", "xetex");
    const found = pdfOffsets(doc, pdf);
    expect(found.unaligned).toBe(0);
    const scaled = worstOf(found, "scale");
    const after = worstOf(found, "translation");
    expect(scaled.operators).toBeGreaterThanOrEqual(1);
    expect(after.operators).toBeGreaterThanOrEqual(1);
    expect(Math.max(scaled.max, after.max, worstOf(found, undefined).max)).toBeLessThan(0.5);
  }, 60_000);

  test("draws a rotated or scaled glyph turned or scaled about its origin, its box with it", async () => {
    const { output } = await compiled(NODES, "drawn");
    const page = await drawPage(output, fonts, new Map());
    // Each glyph the SVG turns: its matrix's linear part is a rotation by 30 degrees, y down.
    const turned = [...page.svg.matchAll(/transform="matrix\(([-\d. ]+)\)"/g)].map((match) =>
      (match[1] ?? "").split(" ").map(Number),
    );
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    const thirty = turned.filter(
      ([a = 0, b = 0, c = 0, d = 0]) =>
        Math.abs(a - cos) < 1e-5 &&
        Math.abs(b + sin) < 1e-5 &&
        Math.abs(c - sin) < 1e-5 &&
        Math.abs(d - cos) < 1e-5,
    );
    // "Turned words" and "Tilted node", and nothing set in a translation is turned.
    expect(thirty.length).toBe("Turnedwords".length + "Tiltednode".length);
    expect(
      turned.some(([a = 0, , , d = 0]) => Math.abs(a - 1.5) < 1e-5 && Math.abs(d - 0.8) < 1e-5),
    ).toBe(true);
    // An i set upright is taller than wide; turned a quarter, its box is wider than tall.
    const lying = page.glyphs.filter(
      (glyph) => glyph.text === "i" && glyph.right - glyph.left > glyph.bottom - glyph.top,
    );
    expect(lying.length).toBe(1);
  }, 60_000);

  test("lets a field in a translation be edited, and keeps one rotated, scaled or on a canvas locked", async () => {
    // Each kind in a macro of the upload's own, whose argument the probe marks as a field.
    const tex = String.raw`\documentclass{article}
\usepackage{tikz}
\usepackage{graphicx}
\pagestyle{empty}
\newcommand{\tag}[1]{\tikz[baseline=(t.base)]\node[draw,rounded corners,inner sep=2pt](t){#1};}
\newcommand{\turned}[1]{\rotatebox{30}{#1}}
\newcommand{\squeezed}[1]{\scalebox{1.5}[0.8]{#1}}
\newcommand{\person}[1]{\par\noindent\textbf{#1}\par}
\newcommand{\tiltbadge}[1]{\begin{tikzpicture}\begin{scope}[transform canvas={rotate=30}]\node[draw]{#1};\end{scope}\end{tikzpicture}}
\newcommand{\movedbadge}[1]{\begin{tikzpicture}\begin{scope}[transform canvas={shift={(2,0)}}]\node[draw]{#1};\end{scope}\end{tikzpicture}}
\newcommand{\bigbadge}[1]{\begin{tikzpicture}\begin{scope}[transform canvas={scale=2}]\node[draw]{#1};\end{scope}\end{tikzpicture}}
\begin{document}
\person{Quill Wren}
\tag{Lantern Works} \tag{Mill Press} \tag{Heron Lane}

\turned{Upright Finch}

\squeezed{Wide Owl}

\vspace{2cm}
\tiltbadge{Slate Harbour}

\vspace{2cm}
\movedbadge{Copper Gate}

\vspace{2cm}
\bigbadge{Amber Field}
\end{document}
`;
    let probed: Probe | undefined;
    const outcome = await importResume([{ name: "cv.tex", bytes: strToU8(tex) }], {
      ...deps,
      observe: { probed: ({ probe }) => (probed = probe) },
    });
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    const verdicts = new Map(
      (probed?.candidates ?? []).map((each) => [
        each.text,
        { verdict: each.verdict, detail: each.detail, transform: each.transform },
      ]),
    );
    for (const [text, each] of verdicts)
      console.info(
        `${text}: ${[each.verdict, each.detail, each.transform].filter(Boolean).join(" / ")}`,
      );
    for (const tag of ["Lantern Works", "Mill Press", "Heron Lane"])
      expect(verdicts.get(tag), tag).toEqual({
        verdict: "editable",
        detail: undefined,
        transform: undefined,
      });
    expect(verdicts.get("Upright Finch")).toEqual({
      verdict: "moved",
      detail: "transform",
      transform: "rotate",
    });
    expect(verdicts.get("Wide Owl")).toEqual({
      verdict: "moved",
      detail: "transform",
      transform: "scale",
    });
    // Under a scope's transform canvas, which the page does not follow, each stays locked, as other.
    for (const badge of ["Slate Harbour", "Copper Gate", "Amber Field"])
      expect(verdicts.get(badge), badge).toEqual({
        verdict: "moved",
        detail: "transform",
        transform: "other",
      });
    // The outline makes a field of each tag and none of the rotated or scaled text, and the page
    // the checks compile is the upload's.
    const [section] = outcome.document.resume.sections;
    if (section?.kind !== "outline") throw new Error("no outline");
    const texts = [...outlineNodes(section.parts)].flatMap((step) =>
      step.kind === "part" && (step.part.kind === "rich" || step.part.kind === "text")
        ? [
            typeof step.part.text === "string"
              ? step.part.text
              : step.part.text.map((run) => run.text).join(""),
          ]
        : [],
    );
    expect(texts).toEqual(expect.arrayContaining(["Lantern Works", "Mill Press", "Heron Lane"]));
    expect(texts).not.toContain("Upright Finch");
    expect(texts).not.toContain("Wide Owl");
    for (const badge of ["Slate Harbour", "Copper Gate", "Amber Field"])
      expect(texts).not.toContain(badge);
    console.info(`the outline's fields: ${texts.join(", ")}`);
    expect(outcome.report.checks.outcome).toBe("assembled");
  }, 180_000);
});
