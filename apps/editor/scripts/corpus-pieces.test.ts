import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8 } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import type { CheckEvent } from "../src/import/checks";
import { readTree } from "../src/import/fonts";
import { type Intake, treeImages } from "../src/import/intake";
import { ownersOf } from "../src/import/outline";
import type { Probe, ProbeCandidate, UncoveredRun } from "../src/import/probe";
import type { Reference, ReferenceGlyph } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { type AssemblyChecks, type LockReason, reportOfImport } from "../src/import/report";
import { type ImportDeps, type Imported, importResume } from "../src/import/run";
import { STANDARD, STANDARD_ENVIRONMENTS } from "../src/import/standard";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { JAKE_FORK } from "../src/test/jake-fork";
import type { ImportRow } from "./corpus-import";
import {
  addsUp,
  definedNames,
  loadedTreeFiles,
  type Names,
  namerOf,
  PIECE_BUCKETS,
  PIECE_NAME,
  pieceName,
  piecesOf,
  pieceTables,
  TrialClock,
  uploadNames,
} from "./corpus-pieces";
import { DIAGNOSTICS, runComparison, runDifferences } from "./corpus-run";

// Every document, name, word and count here is invented for these tests; SECRET stands for a
// document's text, which nothing the runner prints or writes may show.

const SECRET = "Quillwort Larkfield";

const none = (): Names => ({ macros: new Set(), environments: new Set() });

describe("the names a text defines", () => {
  test("finds a macro or an environment however TeX, LaTeX, xparse, etoolbox or expl3 defines it", () => {
    const text = String.raw`
      \newcommand{\alpha}[1]{#1} \renewcommand*\beta{} \providecommand{ \gamma }{}
      \def\delta#1{} \gdef \epsilon{} \let\zeta\relax \DeclareRobustCommand\eta{}
      \NewDocumentCommand{\theta}{m}{} \newrobustcmd{\iota}{} \cs_new:Npn \kappa {}
      \newenvironment{lambda}{}{} \NewDocumentEnvironment{mu*}{}{}{} \newlist{nu}{itemize}{1}
      \csdef{xi}{} \expandafter\def\csname omicron\endcsname{}
      \textbf{notdefined} \pi{called, never defined}`;
    const { macros, environments } = definedNames(text);
    for (const name of [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
      "iota",
      "kappa",
      "xi",
      "omicron",
    ])
      expect(macros.has(name), name).toBe(true);
    for (const name of ["lambda", "mu*", "nu", "xi"])
      expect(environments.has(name), name).toBe(true);
    expect(macros.has("pi")).toBe(false);
    expect(macros.has("textbf")).toBe(false);
    expect(environments.has("notdefined")).toBe(false);
  });

  test("tells an upload's own .tex from its classes and packages", () => {
    const bytes = (text: string) => strToU8(text);
    const { user, uploaded } = uploadNames(String.raw`\newcommand{\mine}{}`, {
      "part.tex": bytes(String.raw`\def\alsomine{}`),
      "invented.cls": bytes(String.raw`\newcommand{\classes}{}\newenvironment{block}{}{}`),
      "photo.png": bytes(String.raw`\def\notatext{}`),
    });
    expect([...user.macros].sort()).toEqual(["alsomine", "mine"]);
    expect([...uploaded.macros]).toEqual(["classes", "block"]);
    expect([...uploaded.environments]).toEqual(["block"]);
  });

  test("reads the tree's files a log names, across the lines TeX breaks it at", () => {
    const log = [
      "This is pdfTeX (/texlive/texmf-dist/tex/latex/base/article.cls",
      "Document Class: article (/texmf/texmf-dist/tex/latex/inv",
      "ented/invented.sty) (/tmp/job/upload.cls) (/texmf/texmf-dist/tex/latex/base/size10.clo)",
    ].join("\n");
    const tree = new Set([
      "/texlive/texmf-dist/tex/latex/base/article.cls",
      "/texmf/texmf-dist/tex/latex/invented/invented.sty",
      "/texmf/texmf-dist/tex/latex/base/size10.clo",
    ]);
    expect(loadedTreeFiles(log, (path) => tree.has(path)).sort()).toEqual([...tree].sort());
  });
});

describe("a piece's name", () => {
  const sources = {
    user: { macros: new Set(["resumeItem", "cventry"]), environments: new Set(["myList"]) },
    uploaded: { macros: new Set(["headerthing"]), environments: new Set(["boxed"]) },
    known: (_kind: string, name: string) => ["cventry", "cvitem", "itemize"].includes(name),
  };

  test("is the name only where something public defines it and the document does not", () => {
    expect(pieceName("macro", "cvitem", sources)).toBe("cvitem");
    expect(pieceName("environment", "itemize", sources)).toBe("itemize");
    // The document's own definition wins, a redefinition of a public name among them.
    expect(pieceName("macro", "resumeItem", sources)).toBe("user macro");
    expect(pieceName("macro", "cventry", sources)).toBe("user macro");
    expect(pieceName("environment", "myList", sources)).toBe("user environment");
    // Only its own class defines it: a bucket; nothing does, or it is no name: another.
    expect(pieceName("macro", "headerthing", sources)).toBe("class macro");
    expect(pieceName("environment", "boxed", sources)).toBe("class environment");
    expect(pieceName("macro", "unheard", sources)).toBe("other macro");
    expect(pieceName("macro", SECRET, { ...sources, known: () => true })).toBe("other macro");
  });

  test("knows a public name from LaTeX's tables, the engine, the tree's files the log names, and the upstream classes", () => {
    const namer = namerOf({
      intake: { main: { text: String.raw`\newcommand{\resumeItem}[1]{#1}` }, files: {} },
      log: "(/texmf/texmf-dist/tex/latex/invented/invented.cls)",
      signatures: { commands: { sigstandard: { kind: "standard" } }, environments: {} },
      standard: { macros: STANDARD, environments: STANDARD_ENVIRONMENTS },
      inTree: (path) => path === "/texmf/texmf-dist/tex/latex/invented/invented.cls",
      treeNames: () =>
        definedNames(
          String.raw`\newcommand{\cventry}{} \newenvironment{cvlist}{}{} \section{Heading}`,
        ),
      shared: definedNames(String.raw`\newcommand{\cvsection}{}`),
    });
    expect(namer("macro", "textbf")).toBe("textbf");
    expect(namer("environment", "itemize")).toBe("itemize");
    expect(namer("macro", "sigstandard")).toBe("sigstandard");
    expect(namer("macro", "cventry")).toBe("cventry");
    expect(namer("environment", "cvlist")).toBe("cvlist");
    expect(namer("macro", "cvsection")).toBe("cvsection");
    expect(namer("macro", "resumeItem")).toBe("user macro");
    expect(namer("macro", "unheard")).toBe("other macro");
    // A word in braces a tree's file only writes, a heading's, defines nothing.
    expect(namer("environment", "Heading")).toBe("other environment");
  });

  test("is a bucket for a name the document defines in any way, as either kind", () => {
    // Something public writes every name, as a package's heading may: the document's own wins.
    const known = () => true;
    for (const source of [
      String.raw`\newcommand{\Publications}{}`,
      String.raw`\newtheorem{Publications}{P}`,
      String.raw`\newtheorem*{Publications}{P}`,
      String.raw`\newtcolorbox[auto counter]{Publications}{}`,
      String.raw`\newmdenv[linewidth=1pt]{Publications}`,
      String.raw`\DeclareDocumentEnvironment{Publications}{}{}{}`,
      String.raw`\NewEnviron{Publications}{}`,
      String.raw`\LetLtxMacro\Publications\section`,
      String.raw`\newfontfamily\Publications{Invented Sans}`,
      String.raw`\def\Publications{}\def\endPublications{}`,
    ]) {
      const sources = { ...uploadNames(source, {}), known };
      expect(pieceName("environment", "Publications", sources), source).toBe("user environment");
      expect(pieceName("macro", "Publications", sources), source).toBe("user macro");
    }
    const tree = definedNames(
      String.raw`\section{Publications} \begin{Experience} \def\endHonours{} \newenvironment{cvlist}{}{}`,
    );
    expect([...tree.environments].sort()).toEqual(["Honours", "cvlist"]);
  });
});

/** An invented line of glyphs at `v`, each character one, a space a gap, as TeX sets them. */
function line(text: string, v: number): ReferenceGlyph[] {
  const size = 10 * 65536;
  const glyphs: ReferenceGlyph[] = [];
  let at = 0;
  for (const character of text) {
    if (character === " ") {
      at += 0.3 * size;
      continue;
    }
    glyphs.push({
      kind: "glyph",
      font: "invented10",
      size,
      code: character.codePointAt(0) ?? 0,
      text: character,
      h: at,
      v,
      width: size / 2,
    });
    at += size / 2;
  }
  return glyphs;
}

/** Invented checks of an outline, the owners and the retype's runs given. */
function checks(changes: Partial<AssemblyChecks>): AssemblyChecks {
  return {
    outcome: "assembled",
    fields: { editable: 0, raw: 0, required: 0, locked: {} },
    words: { editable: 0, locked: {} },
    sections: { mapped: 0, locked: 0 },
    required: [],
    controls: { offered: [], proven: [], dropped: [] },
    redefinitions: { applied: [], dropped: [], placement: "class" },
    repeatable: [],
    findings: [],
    compiles: 0,
    ms: 0,
    decisions: {},
    all: [],
    ...changes,
  };
}

/**
 * An invented import's page, each line set by one piece: a field; an entry's argument the checks
 * kept; a line of the document's own macro the retype reaches; a paragraph the probe's budget left
 * untested; a list's item set twice; an argument no field holds; one only an uploaded class
 * defines, the checks' budget left untried; and the template's own label.
 */
function inventedImport() {
  const texts = [
    "Quill Invented",
    "Invented Engineer Wren",
    "Languages Quill Wren Tools",
    "Five invented words set here",
    "Two more",
    "Page",
    "Quill Wren",
    "Spare word",
  ];
  const lines = texts.map((text, i) => line(text, i * 20 * 65536));
  const glyphs = lines.flat();
  const starts: number[] = [];
  let total = 0;
  for (const each of lines) {
    starts.push(total);
    total += each.length;
  }
  const run = (
    i: number,
    by: UncoveredRun["by"],
    more: Partial<UncoveredRun> = {},
  ): UncoveredRun => ({
    page: 0,
    from: starts[i] ?? 0,
    to: (starts[i] ?? 0) + (lines[i]?.length ?? 0),
    first: { h: 0, v: 0 },
    last: { h: 0, v: 0 },
    by,
    ...more,
  });
  const candidate = (
    id: string,
    changes: Partial<ProbeCandidate> & Pick<ProbeCandidate, "kind" | "name" | "verdict">,
  ) =>
    ({
      id,
      where: "body",
      start: 0,
      end: 0,
      text: SECRET,
      empty: false,
      settled: "together",
      ...changes,
    }) as ProbeCandidate;
  const candidates = [
    candidate("c1-1", {
      kind: "argument",
      of: "call",
      name: "cventry",
      index: 1,
      verdict: "editable",
    }),
    candidate("c1-2", {
      kind: "argument",
      of: "call",
      name: "cventry",
      index: 2,
      verdict: "editable",
    }),
    candidate("t3", { kind: "paragraph", name: "", verdict: "untested", settled: "budget" }),
    candidate("i2", { kind: "item", name: "itemize", verdict: "twice" }),
    candidate("c2-1", {
      kind: "argument",
      of: "call",
      name: "cventry",
      index: 1,
      verdict: "editable",
    }),
    candidate("c3-1", {
      kind: "argument",
      of: "call",
      name: "headerthing",
      index: 1,
      verdict: "editable",
    }),
  ];
  const runs = [
    run(0, "candidate", { candidate: "c1-1" }),
    run(1, "candidate", { candidate: "c1-2" }),
    run(2, "raw", { raw: { start: 0, end: 0, why: "command", name: "skillline" } }),
    run(3, "candidate", { candidate: "t3" }),
    run(4, "candidate", { candidate: "i2" }),
    run(5, "chrome"),
    run(6, "candidate", { candidate: "c2-1" }),
    run(7, "candidate", { candidate: "c3-1" }),
  ];
  const kept = new Map<string, LockReason>([
    ["c1-2", "differs"],
    ["c3-1", "untested"],
  ]);
  const owners = ownersOf(runs, candidates, new Map([["c1-1", "f1"]]), kept);
  const imported = {
    report: {
      checks: checks({
        owners,
        retype: [{ page: 0, from: starts[2] ?? 0, to: (starts[2] ?? 0) + (lines[2]?.length ?? 0) }],
      }),
      locked: [],
      reference: { pages: [{ items: glyphs }], bibliographyLeftOut: false, images: [] },
      images: { replaced: [], dropped: [] },
      warnings: [],
    },
    document: { resume: {} },
  } as unknown as Imported;
  const name = (kind: "macro" | "environment", each: string) =>
    pieceName(kind, each, {
      user: definedNames(String.raw`\newcommand{\skillline}{}`),
      uploaded: definedNames(String.raw`\newcommand{\headerthing}[1]{#1}`),
      known: (_kind, known) => known === "cventry" || known === "itemize",
    });
  return { imported, runs, candidates, name };
}

describe("the words not in place, by piece", () => {
  test("set each word down to its piece, with why and where it was decided, adding up to the report's", () => {
    const { imported, runs, candidates, name } = inventedImport();
    const { pieces, words } = piecesOf({ imported, runs, candidates, name });
    expect(pieces).toEqual([
      { piece: "paragraph", why: "untested", kept: "untested", by: "probe", words: 5 },
      { piece: "user macro", why: "retype", kept: "raw", by: "parse", words: 4 },
      { piece: "cventry", arg: 2, why: "differs", kept: "differs", by: "checks", words: 3 },
      { piece: "class macro", arg: 1, why: "untested", kept: "untested", by: "checks", words: 2 },
      { piece: "cventry", arg: 1, why: "shape", kept: "shape", by: "outline", words: 2 },
      { piece: "itemize", why: "twice", kept: "twice", by: "probe", words: 2 },
    ]);
    // The same words as the report counts, reason by reason.
    const report = reportOfImport(imported);
    expect(words).toEqual(report.words);
    expect(report.words).toMatchObject({
      editable: 2,
      retype: 4,
      locked: 14,
      byReason: { differs: 3, untested: 7, twice: 2, shape: 2 },
    });
    expect(addsUp(pieces, report.words)).toBe(true);
    expect(addsUp(pieces.slice(1), report.words)).toBe(false);
    expect(JSON.stringify(pieces)).not.toContain(SECRET);
    expect(JSON.stringify(pieces)).not.toContain("skillline");
    expect(JSON.stringify(pieces)).not.toContain("headerthing");
  });
});

/** An invented session whose compile, dump and PDF each take the milliseconds their name says. */
function fakeSession(spend: (ms: number) => void): EngineSession {
  const result = (ms: string) => {
    spend(Number(ms));
    return { ok: true, passes: [], log: "" };
  };
  return {
    compile: (_engine: string, format: string) => result(format),
    dump: (_engine: string, name: string) => result(name),
    pdf: (job: string) => result(job),
  } as unknown as EngineSession;
}

describe("the compiles, by kind of trial", () => {
  test("set each compile down to its step, or the checks' phase, the probe's last its bisection's", () => {
    let now = 0;
    const clock = new TrialClock(() => now);
    const session = clock.timed(fakeSession((ms) => (now += ms)));
    const compile = (ms: number, isCompile = true) =>
      isCompile
        ? session.compile("pdftex", String(ms), "")
        : session.dump("pdftex", String(ms), "", {});
    clock.enter("reference");
    compile(100);
    clock.enter("signatures");
    compile(10);
    clock.enter("probe");
    compile(5, false);
    compile(20);
    compile(30);
    compile(40);
    clock.enter("validate");
    compile(7, false);
    const events: CheckEvent[] = [
      { phase: "check 1" },
      { phase: "check 1 bisection" },
      { budget: "check 1", left: 3 },
      { phase: "check 2" },
      { budget: "check 2", left: 2 },
      { phase: "check 3" },
      { budget: "check 3", left: 4 },
    ];
    clock.onCheck(events[0] as CheckEvent);
    compile(1);
    clock.onCheck(events[1] as CheckEvent);
    compile(2);
    compile(2);
    clock.onCheck(events[2] as CheckEvent);
    clock.onCheck(events[3] as CheckEvent);
    compile(3);
    clock.onCheck(events[4] as CheckEvent);
    clock.onCheck(events[5] as CheckEvent);
    compile(4);
    clock.onCheck(events[6] as CheckEvent);
    const trials = clock.result(2);
    expect(trials.compiles).toEqual({
      reference: 1,
      signatures: 1,
      probe: 1,
      "probe bisection": 2,
      "check 1": 1,
      "check 1 bisection": 2,
      "check 2": 1,
      "check 3": 1,
    });
    expect(trials.ms).toMatchObject({ probe: 20, "probe bisection": 70, "check 1 bisection": 4 });
    expect(Object.keys(trials.compiles)[0]).toBe("reference");
    expect(trials.dumps).toEqual({ n: 2, ms: 12 });
    expect(trials.pdfs).toEqual({ n: 0, ms: 0 });
    expect(trials.budgets).toEqual({
      checks: { hits: 2, fields: 5 },
      units: { hits: 1, groups: 4 },
    });
  });
});

describe("the PDFs", () => {
  test("are counted and timed apart from the dumps and the compiles", () => {
    let now = 0;
    const clock = new TrialClock(() => now);
    const session = clock.timed(fakeSession((ms) => (now += ms)));
    clock.enter("validate");
    session.pdf("11");
    session.dump("pdftex", "3", "", {});
    const trials = clock.result(0);
    expect(trials.pdfs).toEqual({ n: 1, ms: 11 });
    expect(trials.dumps).toEqual({ n: 1, ms: 3 });
    expect(trials.compiles).toEqual({});
  });
});

describe("the tables per family", () => {
  const row = (
    id: string,
    family: ImportRow["family"],
    pieces: ImportRow["pieces"],
  ): ImportRow => ({
    id,
    family,
    outcome: "partial",
    engine: "pdftex",
    rate: 0.5,
    ...(pieces === undefined ? {} : { pieces }),
    compiles: { all: 5, checks: 3, trials: { reference: 1, probe: 1, "check 1": 3 }, dumps: 2 },
    budgets: {
      probe: { hits: 1, fields: 4 },
      checks: { hits: 0, fields: 0 },
      units: { hits: 1, groups: 2 },
    },
    times: { wall: 10, trials: { reference: 1500, probe: 500, "check 1": 900 }, dumps: 300 },
  });

  test("name the pieces, why and the trials, and nothing a document wrote", () => {
    const rows = [
      row("moderncv-0001", "moderncv", [
        { piece: "cventry", arg: 6, why: "retype", kept: "differs", by: "checks", words: 40 },
        { piece: "user macro", why: "raw", kept: "raw", by: "parse", words: 7 },
      ]),
      row("moderncv-0002", "moderncv", [
        { piece: "cventry", arg: 6, why: "retype", kept: "differs", by: "checks", words: 2 },
        { piece: SECRET, why: "untested", kept: "untested", by: "probe", words: 1 },
      ]),
      { ...row("jake-0001", "jake", undefined), outcome: "refused" as const },
    ];
    const table = pieceTables(rows);
    expect(table).toContain("**moderncv**, 2 imported: 50 words not in place");
    expect(table).toContain("| `cventry` #6 | retype, kept: differs | checks | 42 | 2 |");
    expect(table).toContain("| user macro | raw | parse | 7 | 1 |");
    expect(table).toContain("| (unnamed) | untested | probe | 1 | 1 |");
    expect(table).toContain("| reference | 2 | 3.0 s | 2 |");
    expect(table).toContain("| check 1 | 6 | 1.8 s | 2 |");
    expect(table).toContain("| dumps | 4 | 0.6 s | 2 |");
    expect(table).toContain("the probe's in 2 documents (8 candidates untested)");
    expect(table).toContain("check 3's in 2 documents (4 groups untried)");
    expect(table).toContain("**all**, 2 imported");
    expect(table).not.toContain("**jake**");
    expect(table).not.toContain(SECRET);
    expect(table).not.toContain("no pieces");
  });

  test("say how many rows have no pieces, their words not added up", () => {
    const rows = [
      row("other-0001", "other", [
        { piece: "paragraph", why: "raw", kept: "raw", by: "parse", words: 3 },
      ]),
      row("other-0002", "other", undefined),
    ];
    expect(pieceTables(rows)).toContain("1 of the 2 has no pieces");
  });
});

describe("comparing runs", () => {
  const file = (documents: unknown[]) => ({ version: 2, mode: { documents: "some" }, documents });
  const old = [
    { id: "jake-0001", outcome: "success", compiles: { all: 9, checks: 4 }, times: { wall: 1 } },
    { id: "jake-0002", outcome: "partial", compiles: { all: 7, checks: 3 }, times: { wall: 1 } },
  ];
  const newer = old.map((each) => ({
    ...each,
    compiles: { ...each.compiles, trials: { reference: 1 }, dumps: 2 },
    pieces: [{ piece: "paragraph", why: "raw", kept: "raw", by: "parse", words: 1 }],
    times: { wall: 2, trials: { reference: 30 } },
  }));

  test("set aside the fields one run lacks throughout, and name them", () => {
    expect(runComparison(file(old), file(newer))).toEqual({
      differences: [],
      lacking: ["compiles.dumps", "compiles.trials", "pieces"],
    });
    expect(runDifferences(file(newer), file(old))).toEqual([]);
  });

  test("set aside only the row's diagnostics, and compare every other field one run lacks", () => {
    const row = (id: string, extra: object) => ({
      id,
      family: "other",
      outcome: "partial",
      times: { wall: 1 },
      ...extra,
    });
    const run = (documents: object[]) => ({ version: 1, documents });
    expect(
      runDifferences(
        run([row("a", { latinModern: true }), row("b", {})]),
        run([row("a", {}), row("b", {})]),
      ),
    ).toEqual(["a.latinModern: true against absent"]);
    expect(
      runDifferences(
        run([row("a", { words: { body: 5, retype: 2 } })]),
        run([row("a", { words: { body: 5 } })]),
      ),
    ).toEqual(["a.words.retype: 2 against absent"]);
    expect(runDifferences(run([row("a", { refusal: null })]), run([row("a", {})]))).toEqual([
      "a.refusal: null against absent",
    ]);
    expect(DIAGNOSTICS).toEqual([
      "pieces",
      "budgets",
      "compiles.trials",
      "compiles.dumps",
      "compiles.pdfs",
    ]);
  });

  test("still compare the fields both have, and a document one run lacks", () => {
    const changed = newer.map((each) =>
      each.id === "jake-0002" ? { ...each, compiles: { ...each.compiles, all: 8 } } : each,
    );
    expect(runDifferences(file(old), file(changed))).toEqual([
      "jake-0002.compiles.all: 7 against 8",
    ]);
    const found = runDifferences(file(old), file(newer.slice(1)));
    expect(found.some((line) => line.startsWith("jake-0001: {"))).toBe(true);
    // A field both runs have, which one row lacks, still differs.
    const lacking = newer.map((each) =>
      each.id === "jake-0001" ? { ...each, pieces: undefined } : each,
    );
    expect(runDifferences(file(newer), file(lacking))).toHaveLength(1);
  });
});

describe.skipIf(!engineAvailable())("the diagnostics, on the engine", () => {
  let deps: ImportDeps;
  let manifest: EngineManifest;

  beforeAll(async () => {
    manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    deps = {
      session: await startNodeSession(),
      fonts: new FontLibrary(new TexLiveIndex(manifest), async (path) =>
        readFileSync(join(ENGINE_DIR, "files", path)),
      ),
      tree: readTree(manifest.files, manifest.fonts),
      treeImage: treeImages(
        manifest.files,
        (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
      ),
    };
  }, 60_000);

  test("change nothing an import does, and add up to its compiles and its report's words", async () => {
    // An invented fork of Jake's Resume, whose list commands its own preamble defines.
    const files = [{ name: "resume.tex", bytes: strToU8(JAKE_FORK) }];
    const plain = await importResume(files, deps);
    const clock = new TrialClock();
    let probed: { intake: Intake; reference: Reference; probe: Probe } | undefined;
    const observed = await importResume(
      files,
      {
        ...deps,
        session: clock.timed(deps.session),
        observe: {
          probed: (found) => {
            probed = found;
          },
          checks: clock.onCheck,
        },
      },
      (progress) => clock.enter(progress.step),
    );
    if (isRefusal(plain) || isRefusal(observed)) throw new Error("the fork was refused");
    if (probed === undefined) throw new Error("the probe went unheard");
    // The same import: its compiles, its document, its outline and its words.
    expect(observed.report.compiles).toBe(plain.report.compiles);
    expect(observed.report.checks.compiles).toBe(plain.report.checks.compiles);
    expect(observed.document).toEqual(plain.document);
    expect(observed.report.outline).toEqual(plain.report.outline);
    expect(observed.report.checks.owners).toEqual(plain.report.checks.owners);
    expect(reportOfImport(observed).words).toEqual(reportOfImport(plain).words);

    const trials = clock.result(probed.probe.compiles);
    const sum = (record: Partial<Record<string, number>>, test = (_kind: string) => true) =>
      Object.entries(record).reduce((all, [kind, n]) => all + (test(kind) ? (n ?? 0) : 0), 0);
    expect(sum(trials.compiles)).toBe(observed.report.compiles);
    expect(sum(trials.compiles, (kind) => kind.startsWith("check"))).toBe(
      observed.report.checks.compiles,
    );
    expect(trials.compiles.reference).toBeGreaterThan(0);
    expect(trials.compiles["check 1"]).toBeGreaterThan(0);
    expect(trials.compiles.other).toBeUndefined();

    // The reference compile's log names the tree's files it loaded, the fork's class among them.
    const loaded = loadedTreeFiles(probed.reference.log, (path) => path in manifest.files);
    expect(loaded.some((path) => path.endsWith("/base/article.cls"))).toBe(true);
    expect(loaded.some((path) => path.endsWith("/titlesec/titlesec.sty"))).toBe(true);
    const namer = namerOf({
      intake: probed.intake,
      log: probed.reference.log,
      signatures: probed.probe.signatures,
      standard: { macros: STANDARD, environments: STANDARD_ENVIRONMENTS },
      inTree: (path) => path in manifest.files,
      treeNames: (path) => definedNames(readFileSync(join(ENGINE_DIR, "files", path), "latin1")),
      shared: none(),
    });
    const { pieces } = piecesOf({
      imported: observed,
      runs: probed.probe.runs ?? [],
      candidates: probed.probe.candidates,
      name: namer,
    });
    expect(addsUp(pieces, reportOfImport(observed).words)).toBe(true);
    // No piece is named by a name the fork defines, as its list commands.
    const defined = definedNames(JAKE_FORK);
    expect(defined.macros.has("resumeSubheading")).toBe(true);
    for (const each of pieces) {
      expect(defined.macros.has(each.piece) || defined.environments.has(each.piece)).toBe(false);
      expect(PIECE_BUCKETS.includes(each.piece) || PIECE_NAME.test(each.piece)).toBe(true);
    }
  }, 120_000);

  test("come through an observer that throws, the import as it would be without one", async () => {
    const files = [{ name: "resume.tex", bytes: strToU8(JAKE_FORK) }];
    const plain = await importResume(files, deps);
    const fails = () => {
      throw new Error("an observer's fault");
    };
    const observed = await importResume(files, {
      ...deps,
      observe: { probed: fails, checks: fails },
    });
    if (isRefusal(plain)) throw new Error("the fork was refused");
    expect(isRefusal(observed)).toBe(false);
    if (isRefusal(observed)) return;
    expect(observed.report.compiles).toBe(plain.report.compiles);
    expect(observed.document).toEqual(plain.document);
  }, 120_000);
});
