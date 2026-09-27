import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { bound, fastestAsync } from "../test/timing";
import { type Candidate, candidatesOf, marked } from "./candidates";
import { readTree } from "./fonts";
import { type Intake, intake } from "./intake";
import { bodyOf, bodyOfText, buildTree, parseBody, readBody, type Signatures } from "./parse";
import {
  type Aggregate,
  aggregate,
  type CompileSet,
  type GlyphPlace,
  kindOf,
  type Own,
  type Probe,
  type ProbeCandidate,
  probe,
  probeOrder,
  probeUses,
  settle,
  suspectsIn,
  uncoveredRuns,
} from "./probe";
import type { GlyphStream, ReferenceItem } from "./reference";
import { reference } from "./reference";
import { isRefusal } from "./refusal";
import { signatures } from "./signatures";

// Every document, class, tree and log here is invented for these tests: invented commands with
// invented names that say so, and invented words. Nothing is taken from a real resume.

/** An invented candidate: a call's argument of `name`, at `index`, from `start`. */
function candidate(
  id: string,
  name = "inventedcall",
  index = 1,
  extra: Partial<Candidate> = {},
): Candidate {
  return {
    id,
    kind: "argument",
    where: "body",
    of: "call",
    name,
    index,
    start: 0,
    end: 0,
    text: "Invented",
    empty: false,
    ...extra,
  };
}

/** How an invented candidate behaves when wrapped. */
type Behaviour = "ok" | "breaks" | "moves" | "torn" | NonNullable<Own["reason"]>;

/**
 * An invented engine: a compile of a set stops when it holds a candidate that `breaks`, moves the
 * page when it holds one that `moves`, and shows each candidate's own failure; `torn` is one whose
 * markers never come and leave torn ones behind. With `name`, a compile names the first
 * candidate that stopped or moved it, as the real one names what it read.
 */
function engine(behaviours: Record<string, Behaviour>, name = false) {
  const compiled: string[][] = [];
  const compile: CompileSet = async (set) => {
    compiled.push(set.map((each) => each.id));
    const breakers = set.filter((each) => behaviours[each.id] === "breaks");
    if (breakers.length > 0)
      return {
        broke: true,
        same: false,
        torn: false,
        own: new Map(),
        suspects: name ? [breakers[0]?.id ?? ""] : [],
      };
    const own = new Map<string, Own>(
      set.map((each, i) => {
        const behaviour = behaviours[each.id] ?? "ok";
        const glyphs: GlyphPlace[] = [[0, i]];
        if (behaviour === "ok" || behaviour === "moves") return [each.id, { ok: true, glyphs }];
        if (behaviour === "torn") return [each.id, { ok: false, reason: "vanished" }];
        return [each.id, { ok: false, reason: behaviour, glyphs }];
      }),
    );
    const movers = set.filter((each) => behaviours[each.id] === "moves");
    return {
      broke: false,
      same: movers.length === 0,
      ...(movers.length === 0 ? {} : { difference: "position" as const }),
      torn: set.some((each) => behaviours[each.id] === "torn"),
      own,
      ...(name && movers.length > 0 ? { suspects: [movers[0]?.id ?? ""] } : {}),
    };
  };
  return { compile, compiled };
}

const verdictsOf = (settlement: Awaited<ReturnType<typeof settle>>) =>
  Object.fromEntries(
    [...settlement.verdicts].map(([id, { verdict, settled }]) => [id, `${verdict} ${settled}`]),
  );

describe("settling the candidates", () => {
  test("settles a set that passes whole in one compile", async () => {
    const set = Array.from({ length: 10 }, (_, i) => candidate(`c${i + 1}-1`));
    const { compile, compiled } = engine({});
    const found = await settle(set, compile, 64);
    expect(compiled).toHaveLength(1);
    expect(found.compiles).toBe(1);
    expect(Object.values(verdictsOf(found))).toEqual(Array(10).fill("editable together"));
    expect(found.evidence.get("c3-1")).toEqual([[0, 2]]);
  });

  test("takes what a candidate's own markers show as its own, beside the rest", async () => {
    const set = ["ok", "twice", "case", "misaligned", "split", "vanished"].map((behaviour, i) =>
      candidate(`c${i + 1}-1`, `inventedcall${i}`),
    );
    const { compile, compiled } = engine({
      "c2-1": "twice",
      "c3-1": "case",
      "c4-1": "misaligned",
      "c5-1": "split",
      "c6-1": "vanished",
    });
    const found = await settle(set, compile, 64);
    expect(compiled).toHaveLength(1);
    expect(verdictsOf(found)).toEqual({
      "c1-1": "editable together",
      "c2-1": "twice together",
      "c3-1": "case together",
      "c4-1": "misaligned together",
      "c5-1": "split together",
      "c6-1": "vanished together",
    });
  });

  test("splits a set a candidate stops until it stops one alone, and tries first one it names", async () => {
    const set = Array.from({ length: 16 }, (_, i) => candidate(`c${i + 1}-1`));
    const blind = engine({ "c11-1": "breaks" });
    const found = await settle(set, blind.compile, 64);
    expect(found.verdicts.get("c11-1")).toEqual({ verdict: "breaks", settled: "alone" });
    expect([...found.verdicts.values()].filter((each) => each.verdict === "editable")).toHaveLength(
      15,
    );
    // Halving finds one of sixteen in two compiles a level.
    expect(found.compiles).toBeLessThanOrEqual(1 + 2 * Math.log2(16));
    const named = engine({ "c11-1": "breaks" }, true);
    const quick = await settle(set, named.compile, 64);
    const only = (settlement: typeof found) =>
      Object.fromEntries([...settlement.verdicts].map(([id, { verdict }]) => [id, verdict]));
    expect(only(quick)).toEqual(only(found));
    // The whole set, the named one alone, and the rest.
    expect(named.compiled).toEqual([
      set.map((each) => each.id),
      ["c11-1"],
      set.filter((each) => each.id !== "c11-1").map((each) => each.id),
    ]);
  });

  test("finds a candidate that moves the page, and tries again without those that failed", async () => {
    const set = Array.from({ length: 8 }, (_, i) => candidate(`c${i + 1}-1`, `inventedcall${i}`));
    const { compile } = engine({ "c3-1": "moves", "c6-1": "twice" });
    const found = await settle(set, compile, 64);
    expect(verdictsOf(found)).toMatchObject({ "c3-1": "moved alone", "c6-1": "twice together" });
    for (const id of ["c1-1", "c2-1", "c4-1", "c5-1", "c7-1", "c8-1"])
      expect(found.verdicts.get(id)?.verdict).toBe("editable");
    expect(found.verdicts.get("c3-1")?.detail).toBe("position");
  });

  test("tries alone one whose markers never came when others were torn, where the torn ones are its own", async () => {
    const set = [candidate("c1-1", "inventedtorn"), candidate("c2-1", "inventedplain")];
    const { compile, compiled } = engine({ "c1-1": "torn" });
    const found = await settle(set, compile, 64);
    expect(found.verdicts.get("c1-1")).toEqual({
      verdict: "misaligned",
      detail: "torn",
      settled: "alone",
    });
    expect(found.verdicts.get("c2-1")?.verdict).toBe("editable");
    expect(compiled).toEqual([["c1-1", "c2-1"], ["c1-1"]]);
  });

  test("tries the others of a kind one of which stopped a compile alone among themselves", async () => {
    const bad = Array.from({ length: 6 }, (_, i) => candidate(`c${i + 1}-2`, "inventedbad", 2));
    const good = Array.from({ length: 6 }, (_, i) => candidate(`c${i + 1}-1`, "inventedgood", 1));
    const behaviours = Object.fromEntries(bad.map((each) => [each.id, "breaks" as const]));
    const { compile } = engine(behaviours);
    const found = await settle(probeOrder([...bad, ...good]), compile, 64);
    const bads = bad.map((each) => found.verdicts.get(each.id));
    expect(bads.every((each) => each?.verdict === "breaks")).toBe(true);
    expect(bads.filter((each) => each?.settled === "alone")).toHaveLength(1);
    expect(bads.filter((each) => each?.settled === "like")).toHaveLength(5);
    expect(good.every((each) => found.verdicts.get(each.id)?.verdict === "editable")).toBe(true);
    expect(found.compiles).toBeLessThanOrEqual(8);
  });

  test("leaves what the budget does not reach untested", async () => {
    const set = Array.from({ length: 8 }, (_, i) => candidate(`c${i + 1}-1`, `inventedcall${i}`));
    const { compile, compiled } = engine(
      Object.fromEntries(set.map((each) => [each.id, "breaks" as const])),
    );
    const found = await settle(set, compile, 3);
    expect(compiled).toHaveLength(3);
    expect(found.compiles).toBe(3);
    const untested = [...found.verdicts.values()].filter((each) => each.verdict === "untested");
    expect(untested.length).toBeGreaterThan(0);
    expect(untested.every((each) => each.settled === "budget")).toBe(true);
    expect(found.verdicts.size).toBe(8);
  });

  test("orders candidates by kind, a paragraph inside an argument with that argument's kind", () => {
    const owner = candidate("c1-1", "inventedraw", 1, { unprobed: "raw" });
    const part = candidate("t1", "", undefined, { kind: "paragraph", within: "c1-1" });
    const loose = candidate("t2", "", undefined, { kind: "paragraph" });
    const second = candidate("c2-1", "inventedraw", 1, { unprobed: "raw" });
    const other = candidate("t3", "", undefined, { kind: "paragraph", within: "c2-1" });
    const owners = new Map([owner, second].map((each) => [each.id, each]));
    expect(kindOf(part, owners)).toBe(kindOf(other, owners));
    expect(kindOf(loose, owners)).not.toBe(kindOf(part, owners));
    expect(probeOrder([part, loose, other], owners).map((each) => each.id)).toEqual([
      "t1",
      "t3",
      "t2",
    ]);
  });
});

/** An invented candidate with a verdict. */
function decided(
  id: string,
  verdict: ProbeCandidate["verdict"],
  extra: Partial<ProbeCandidate> = {},
): ProbeCandidate {
  return { ...candidate(id), verdict, settled: "together", ...extra };
}

describe("gathering the verdicts", () => {
  const find = (list: Aggregate[], name: string, index?: number) =>
    list.find((each) => each.name === name && each.index === index);

  test("per macro and argument: editable when every call probed is, else the first failure", () => {
    const { macros, standard } = aggregate([
      decided("c1-1", "editable"),
      decided("c2-1", "editable"),
      decided("c1-2", "editable", { index: 2 }),
      decided("c2-2", "twice", { index: 2 }),
      decided("c3-2", "breaks", { index: 2 }),
      decided("c1-3", "raw", { index: 3, unprobed: "raw", settled: "unprobed" }),
      decided("c2-3", "editable", { index: 3 }),
      decided("s1", "editable", {
        kind: "section",
        name: "section",
        index: undefined,
        of: undefined,
      }),
    ]);
    expect(find(macros, "inventedcall", 1)).toMatchObject({
      verdict: "editable",
      calls: 2,
      counts: { editable: 2 },
    });
    expect(find(macros, "inventedcall", 2)).toMatchObject({
      verdict: "twice",
      counts: { editable: 1, twice: 1, breaks: 1 },
    });
    // A call that holds a raw chunk is locked alone; the rest decide.
    expect(find(macros, "inventedcall", 3)).toMatchObject({
      verdict: "editable",
      counts: { raw: 1, editable: 1 },
    });
    expect(standard).toEqual([
      expect.objectContaining({ of: "standard", name: "section", verdict: "editable" }),
    ]);
  });

  test("keeps an empty call's failure apart, and a container's parts and a raw argument's parts", () => {
    const { macros, standard } = aggregate([
      decided("c1-1", "editable"),
      decided("c2-1", "moved", { empty: true }),
      decided("c1-2", "container", { index: 2, unprobed: "container", settled: "unprobed" }),
      decided("c2-2", "moved", { index: 2, empty: true }),
      decided("c1-3", "raw", { index: 3, unprobed: "raw", settled: "unprobed" }),
      decided("t1", "editable", {
        kind: "paragraph",
        name: "",
        index: undefined,
        of: undefined,
        within: "c1-3",
      }),
      decided("t2", "misaligned", {
        kind: "paragraph",
        name: "",
        index: undefined,
        of: undefined,
        within: "c1-3",
      }),
      decided("i1", "editable", {
        kind: "item",
        name: "itemize",
        index: undefined,
        of: undefined,
        within: "c1-2",
      }),
    ]);
    expect(find(macros, "inventedcall", 1)).toMatchObject({ verdict: "editable", empty: "moved" });
    expect(find(macros, "inventedcall", 2)).toMatchObject({ verdict: "container", empty: "moved" });
    expect(find(macros, "inventedcall", 3)).toMatchObject({
      verdict: "raw",
      parts: { total: 2, editable: 1 },
    });
    // An item in a container is a standard node; a paragraph in an argument is among its parts.
    expect(standard.map((each) => each.name)).toEqual(["item"]);
  });

  test("an argument none of whose calls was settled is untested, and a failure outranks it", () => {
    const { macros } = aggregate([decided("c1-1", "untested"), decided("c2-1", "editable")]);
    expect(find(macros, "inventedcall", 1)?.verdict).toBe("untested");
    expect(
      aggregate([decided("c1-1", "untested"), decided("c2-1", "vanished")]).macros[0]?.verdict,
    ).toBe("vanished");
  });
});

describe("the glyphs no editable field covers", () => {
  const glyph = (h: number): ReferenceItem => ({
    kind: "glyph",
    font: "cmr10",
    size: 655360,
    code: 65,
    h,
    v: 100,
  });
  const stream: GlyphStream = {
    pages: [{ items: Array.from({ length: 10 }, (_, i) => glyph(i * 1000)) }],
    size: { width: 612, height: 792 },
    fonts: { tex: ["cmr10"], native: [], shipped: [] },
    specials: [],
  };

  test("are set down to a locked candidate, a raw chunk between the fields around them, or the template", () => {
    const candidates = [
      decided("c1-1", "editable", { start: 0, end: 10 }),
      decided("c2-1", "misaligned", { start: 20, end: 30 }),
      decided("c3-1", "editable", { start: 40, end: 50 }),
    ];
    const evidence = new Map<string, GlyphPlace[]>([
      [
        "c1-1",
        [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
      ],
      [
        "c2-1",
        [
          [0, 5],
          [0, 6],
        ],
      ],
      [
        "c3-1",
        [
          [0, 8],
          [0, 9],
        ],
      ],
    ]);
    const { runs, covered } = uncoveredRuns(
      stream,
      candidates,
      evidence,
      [{ start: 12, end: 15, why: "math" }],
      60,
    );
    expect(covered).toBe(5);
    expect(
      runs.map(({ from, to, by, candidate: id, raw }) => ({ from, to, by, id, raw: raw?.why })),
    ).toEqual([
      { from: 3, to: 5, by: "raw", id: undefined, raw: "math" },
      { from: 5, to: 7, by: "candidate", id: "c2-1", raw: undefined },
      { from: 7, to: 8, by: "chrome", id: undefined, raw: undefined },
    ]);
    expect(runs[0]?.first).toEqual({ h: 3000, v: 100 });
    expect(runs[0]?.last).toEqual({ h: 4000, v: 100 });
  });

  test("are set down to a locked candidate that set no evidence, before a raw chunk", () => {
    const candidates = [
      decided("c1-1", "editable", { start: 0, end: 10 }),
      decided("c2-1", "moved", { start: 20, end: 30 }),
      decided("c3-1", "editable", { start: 40, end: 50 }),
    ];
    const evidence = new Map<string, GlyphPlace[]>([
      ["c1-1", [[0, 0]]],
      ["c3-1", [[0, 9]]],
    ]);
    const { runs } = uncoveredRuns(
      stream,
      candidates,
      evidence,
      [{ start: 32, end: 35, why: "math" }],
      60,
    );
    expect(runs).toEqual([
      expect.objectContaining({ from: 1, to: 9, by: "candidate", candidate: "c2-1" }),
    ]);
  });
});

describe("what a compile that stopped names", () => {
  test("is the candidates whose markers its first error's context shows TeX reading", () => {
    const log = [
      "(./import.tex",
      "! Missing number, treated as zero.",
      "<to be read again> ",
      "                   \\rtfield ",
      "l.12 \\inventedgap{\\rtfield{c4-1}{2em}}",
      "                                    Invented words \\rtfield{c5-1}{x}",
      "More words, \\rtfield{c6-1}{later}",
    ].join("\n");
    expect(suspectsIn(log, new Set(["c4-1", "c5-1", "c6-1"]))).toEqual(["c4-1", "c5-1"]);
    expect(suspectsIn(log, new Set(["c9-1"]))).toEqual([]);
    expect(suspectsIn("No error at all.", new Set(["c4-1"]))).toEqual([]);
  });
});

describe("the probe's work outside TeX", () => {
  /** An invented body of `calls` entries, every tenth's second argument a length. */
  const body = (calls: number) =>
    Array.from(
      { length: calls },
      (_, i) =>
        `\\inventedentry{Invented role ${i}}{${i % 10 === 0 ? "2em" : `Invented place ${i}`}}\n`,
    ).join("");
  const SIGNATURES: Signatures = {
    commands: { inventedentry: { kind: "template", spec: "m m" } },
    environments: {},
  };

  test("grows with the body, compiles aside", async () => {
    const run = (calls: number) => {
      const tree = parseBody(bodyOfText(body(calls)), SIGNATURES);
      if (isRefusal(tree)) throw new Error(tree.message);
      return async () => {
        const { candidates, raw } = candidatesOf(tree);
        marked(tree.source, candidates);
        const behaviours = Object.fromEntries(
          candidates
            .filter((each) => each.text === "2em")
            .map((each) => [each.id, "breaks" as const]),
        );
        const settled = await settle(
          probeOrder(candidates),
          engine(behaviours, true).compile,
          Number.POSITIVE_INFINITY,
        );
        const results = candidates.map((each) => ({
          ...each,
          ...(settled.verdicts.get(each.id) ?? {
            verdict: "untested" as const,
            settled: "budget" as const,
          }),
        }));
        aggregate(results);
        uncoveredRuns(
          {
            pages: [],
            size: { width: 0, height: 0 },
            fonts: { tex: [], native: [], shipped: [] },
            specials: [],
          },
          results,
          settled.evidence,
          raw,
          tree.source.length,
        );
      };
    };
    const small = run(200);
    const large = run(2000);
    const [tenth = 0, whole = 0] = await fastestAsync([small, large], 5);
    // Ten times the calls, with ten times the lengths, costs about ten times as much.
    expect(whole).toBeLessThan(bound(50, tenth));
  }, 60_000);
});

describe.skipIf(!engineAvailable())("the probe, on the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /** An invented upload through the intake, the reference, the signatures, the parse and the probe. */
  async function probed(files: Record<string, string>, budget?: number): Promise<Probe> {
    const zipped = Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    );
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken as Intake);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const preamble = readBody(bodyOfText(body.preamble));
    const found = await signatures(
      session,
      taken,
      made,
      body,
      probeUses(read, isRefusal(preamble) ? undefined : preamble),
    );
    if (isRefusal(found)) throw new Error("no signatures");
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    return probe(session, fonts, taken, made, built, found, budget === undefined ? {} : { budget });
  }

  const verdict = (found: Probe, name: string, index = 1) =>
    found.macros.find((each) => each.name === name && each.index === index);

  /** An invented class whose macros show each of the probe's verdicts. */
  const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedprobe}[2026/09/27 an invented class for the probe's tests]
\LoadClass{article}
\RequirePackage[hidelinks]{hyperref}
\pagestyle{myheadings}
\newcommand{\cvname}[1]{\def\@cvname{#1}}
\newcommand{\cvheader}{{\Large\@cvname}\par}
\newcommand{\cvplain}[1]{\textbf{#1}\par}
\newcommand{\cvmail}[1]{\href{mailto:#1}{#1}\par}
\newcommand{\cvlink}[1]{\href{#1}{Invented link}\par}
\newcommand{\cvtwice}[1]{#1, and again #1\par}
\newcommand{\cvshout}[1]{\MakeUppercase{#1}\par}
\newcommand{\cvgap}[1]{\hspace{#1}Invented gap\par}
\newcommand{\cvhead}[1]{\markright{#1}#1\par}
\newcommand{\cvmaybe}[1]{\ifx&#1&\else(#1)\fi\par}
`;
  const BODY = String.raw`\begin{document}
\cvheader
\cvplain{Invented plain words}
\cvmail{quill@example.invalid}
\cvlink{https://example.invalid/quill}
\cvtwice{Invented twice}
\cvshout{Invented loud}
\cvgap{2em}
\cvhead{Invented head}
\cvmaybe{}
\cvmaybe{Invented maybe}
\cvplain{}
\end{document}
`;

  test("finds each verdict on an invented pdfTeX document, from its format", async () => {
    const found = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\cvname{Quill Invented}\n${BODY}`,
      "inventedprobe.cls": CLASS,
    });
    expect(found.engine).toBe("pdftex");
    expect(found.path).toBe("format");
    expect(found.format).toMatch(/^import-[0-9a-f]{8}$/);
    expect(found.baseline).toBeUndefined();
    expect(found.compiles).toBeLessThanOrEqual(found.budget);
    // The preamble's call that stores the name is issued again, marked.
    expect(verdict(found, "cvname")).toMatchObject({ verdict: "editable" });
    expect(verdict(found, "cvplain")).toMatchObject({ verdict: "editable", calls: 2 });
    expect(verdict(found, "cvmail")?.verdict).toBe("twice");
    expect(verdict(found, "cvlink")?.verdict).toBe("vanished");
    expect(verdict(found, "cvtwice")?.verdict).toBe("twice");
    expect(verdict(found, "cvshout")?.verdict).toBe("case");
    expect(verdict(found, "cvgap")?.verdict).toBe("breaks");
    expect(["twice", "moved"]).toContain(verdict(found, "cvhead")?.verdict);
    // An empty argument the macro tests moves the page; the others of it are editable.
    expect(verdict(found, "cvmaybe")).toMatchObject({ verdict: "editable", empty: "moved" });
    expect(found.candidates.find((each) => each.name === "cvplain" && each.empty)?.verdict).toBe(
      "editable",
    );
    expect(found.glyphs.covered).toBeGreaterThan(0);
    expect(found.glyphs.covered).toBeLessThan(found.glyphs.reference);
  }, 60_000);

  test("finds the same on an invented XeTeX document, compiled whole", async () => {
    const found = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\usepackage{fontspec}\n\\cvname{Quill Invented}\n\\begin{document}\n\\cvheader\n\\cvplain{Invented plain words}\n\\cvmail{quill@example.invalid}\n\\cvshout{Invented loud}\n\\cvgap{2em}\n\\end{document}\n`,
      "inventedprobe.cls": CLASS,
    });
    expect(found.engine).toBe("xetex");
    expect(found.path).toBe("whole");
    expect(found.fallback).toBeUndefined();
    expect(verdict(found, "cvname")?.verdict).toBe("editable");
    expect(verdict(found, "cvplain")?.verdict).toBe("editable");
    expect(verdict(found, "cvmail")?.verdict).toBe("twice");
    expect(verdict(found, "cvshout")?.verdict).toBe("case");
    expect(verdict(found, "cvgap")?.verdict).toBe("breaks");
  }, 60_000);

  test("compiles whole a pdfTeX document whose preamble does not dump, and probes nothing of one the prelude stops", async () => {
    // A preamble that ends inside a group cannot be dumped.
    const grouped = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\begingroup\n\\begin{document}\n\\cvplain{Invented plain words}\n\\end{document}\n`,
      "inventedprobe.cls": CLASS,
    });
    expect(grouped.path).toBe("whole");
    expect(grouped.fallback).toBe("dump");
    expect(verdict(grouped, "cvplain")?.verdict).toBe("editable");
    // A document that defines the marker macro's name for itself stops the prelude.
    const taken = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\newcommand{\\rtfield}{Invented}\n\\begin{document}\n\\cvplain{Invented plain words}\n\\end{document}\n`,
      "inventedprobe.cls": CLASS,
    });
    expect(taken.baseline).toBe("stopped");
    expect(taken.compiles).toBe(0);
    expect(taken.candidates.every((each) => each.verdict === "untested")).toBe(true);
  }, 60_000);

  test("leaves what its budget does not reach untested", async () => {
    const found = await probed(
      {
        "cv.tex": `\\documentclass{inventedprobe}\n\\begin{document}\n\\cvgap{1em}\n\\cvgap{2em}\n\\cvplain{Invented}\n\\cvtwice{Invented}\n\\end{document}\n`,
        "inventedprobe.cls": CLASS,
      },
      1,
    );
    expect(found.compiles).toBe(1);
    expect(found.candidates.every((each) => each.verdict === "untested")).toBe(true);
  }, 60_000);
});
