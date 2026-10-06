import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OUTLINE_PLACEHOLDER,
  type OutlinePart,
  type OutlineUnit,
  outlineNodes,
} from "@resume-tools/resume-model";
import { strToU8 } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { Document } from "../editor/document";
import { withOutcomeMarks } from "../editor/early-import";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import {
  batchesOf,
  bisect,
  coversLeft,
  emptiedCopy,
  judged,
  keepsPage,
  LONG_AND_SPECIAL,
  MUTATIONS,
  marked,
  mutated,
  ownStop,
  type Trial,
  trialsOf,
  tried,
  UNITS_EVIDENCE,
  UNITS_MARGIN,
} from "./checks";
import { readTree } from "./fonts";
import { treeImages } from "./intake";
import { isRefusal } from "./refusal";
import { reportOfImport } from "./report";
import { type ImportDeps, type ImportStage, importResume } from "./run";

// The second pass's item 6: the checks without answers. Every text here is invented.

const kept = (latex: string): OutlinePart => ({ kind: "kept", latex });
const rich = (id: string, text: string, required?: boolean): OutlinePart => ({
  kind: "rich",
  id,
  text: [{ text }],
  ...(required === undefined ? {} : { required }),
});
const unit = (id: string, gap: string, parts: OutlinePart[]): OutlineUnit => ({ id, gap, parts });

/** An invented outline: a heading field, and a list of two bullets, one holding a nested list. */
const parts: OutlinePart[] = [
  kept("\\begin{document}\\section*{"),
  rich("f-head", "Work"),
  kept("}\\begin{itemize}"),
  {
    kind: "group",
    id: "g1",
    units: [
      unit("g1-u1", "\n", [kept("\\item "), rich("f-a", "Set type")]),
      unit("g1-u2", "\n", [
        kept("\\item "),
        rich("f-b", "Kept the press"),
        {
          kind: "group",
          id: "g2",
          units: [unit("g2-u1", "\n", [kept("\\sub{"), rich("f-c", "Inked"), kept("}")])],
        },
      ]),
    ],
  },
  kept("\\end{itemize}\\end{document}"),
];

/** Every field's id and text, in order. */
const fieldsOf = (list: readonly OutlinePart[]) =>
  [...outlineNodes(list)].flatMap((step) =>
    step.kind === "part" && (step.part.kind === "rich" || step.part.kind === "text")
      ? [`${step.part.id}=${JSON.stringify(step.part.text)}`]
      : [],
  );

describe("check 3's trials", () => {
  const groups = new Map([
    [
      "g1",
      [
        { start: 10, end: 20, next: 21 },
        { start: 21, end: 40, next: 40 },
      ],
    ],
    ["g2", [{ start: 30, end: 38, next: 38 }]],
  ]);

  test("copy every group's last unit, and remove the first and the last only of two or more", () => {
    // Decision 0050's first rule: a group of one unit is never left without it.
    expect(trialsOf(groups)).toEqual([
      { group: "g1", kind: "copy", span: { start: 40, end: 40 } },
      { group: "g1", kind: "first", span: { start: 10, end: 21 } },
      { group: "g1", kind: "last", span: { start: 20, end: 40 } },
      { group: "g2", kind: "copy", span: { start: 38, end: 38 } },
    ]);
  });

  test("batch trials whose changes do not overlap, an outer removal apart from an inner one", () => {
    const trials: Trial[] = [
      { group: "g1", kind: "last", span: { start: 20, end: 40 } },
      { group: "g2", kind: "last", span: { start: 30, end: 38 } },
      { group: "g3", kind: "last", span: { start: 50, end: 60 } },
    ];
    expect(batchesOf(trials).map((batch) => batch.map((each) => each.group))).toEqual([
      ["g1", "g3"],
      ["g2"],
    ]);
    // Copies only put text in, so they all go together.
    const copies = trialsOf(groups).filter((each) => each.kind === "copy");
    expect(batchesOf(copies)).toHaveLength(1);
  });

  test("make a copy of the last unit as it stood, its fields emptied, a required one holding a placeholder", () => {
    const copy = emptiedCopy(
      parts[3]?.kind === "group" ? (parts[3].units[1] as OutlineUnit) : unit("x", "", []),
      (() => {
        let n = 0;
        return () => `copy-${++n}`;
      })(),
      (id) => id === "f-c",
    );
    expect(copy.gap).toBe("\n");
    expect(fieldsOf(copy.parts)).toEqual([
      "copy-2=[]",
      `copy-5=${JSON.stringify([{ text: OUTLINE_PLACEHOLDER }])}`,
    ]);
    // Its kept text is the unit's own, byte for byte.
    expect(copy.parts.flatMap((part) => (part.kind === "kept" ? [part.latex] : []))).toEqual([
      "\\item ",
    ]);
  });

  test("make each trial in an outline's parts, an inner group's with an outer one's", () => {
    const copied = tried(
      parts,
      [
        { group: "g1", kind: "copy", span: { start: 0, end: 0 } },
        { group: "g2", kind: "copy", span: { start: 0, end: 0 } },
      ],
      () => false,
    );
    const g1 = copied[3];
    if (g1?.kind !== "group") throw new Error("no group");
    expect(g1.units.map((each) => each.id)).toEqual(["g1-u1", "g1-u2", "copy-3"]);
    // The inner group got its copy, and the outer copy is of the unit before it did.
    expect(fieldsOf(copied)).toEqual([
      'f-head=[{"text":"Work"}]',
      'f-a=[{"text":"Set type"}]',
      'f-b=[{"text":"Kept the press"}]',
      'f-c=[{"text":"Inked"}]',
      "copy-2=[]",
      "copy-4=[]",
      "copy-7=[]",
    ]);
    const first = tried(
      parts,
      [{ group: "g1", kind: "first", span: { start: 0, end: 0 } }],
      () => false,
    );
    expect(fieldsOf(first)).toEqual([
      'f-head=[{"text":"Work"}]',
      'f-b=[{"text":"Kept the press"}]',
      'f-c=[{"text":"Inked"}]',
    ]);
  });

  test("judge a copy by the reference's glyphs kept, in order or reflowed, and a removal by its roles", () => {
    const either = () => "either" as const;
    expect(judged("copy", ["a", "b"], ["a", "x", "b"], either)).toBe("holds");
    expect(judged("copy", ["a", "b"], ["b", "x", "a"], either)).toBe("reflows");
    expect(judged("copy", ["a", "b"], ["a", "x"], either)).toBe("breaks");
    expect(judged("copy", ["a", "b"], undefined, either)).toBe("stops");
    // A removal must take out what its unit sets, and keep the rest: a glyph set in another font
    // after it, as a size declared in the unit running on would, breaks it (decision 0050's second
    // rule).
    const role = (at: number) => (at === 1 ? "delete" : "keep");
    expect(judged("first", ["a", "b", "c"], ["a", "c"], role)).toBe("holds");
    expect(judged("first", ["a", "b", "c"], ["a", "C"], role)).toBe("breaks");
    expect(judged("first", ["a", "b", "c"], ["a", "b", "c"], role)).toBe("breaks");
    expect(keepsPage("reflows")).toBe(true);
    expect(keepsPage("breaks")).toBe(false);
    expect(keepsPage(undefined)).toBe(false);
  });

  test("stop where the budget cannot cover the trials left, and only on enough evidence", () => {
    const budget = 64;
    // Before its first compile, or with fewer than four trials decided, it covers them.
    expect(coversLeft({ decided: 0, failed: 0, left: 346, spent: 0, budget })).toBe(true);
    expect(coversLeft({ decided: 2, failed: 2, left: 344, spent: 9, budget })).toBe(true);
    // Half the trials decided failed alone, and over three hundred are left: it cannot; nor with a
    // quarter of them failing and two hundred left.
    expect(coversLeft({ decided: 4, failed: 2, left: 342, spent: 10, budget })).toBe(false);
    expect(coversLeft({ decided: 4, failed: 1, left: 202, spent: 12, budget })).toBe(false);
    // One failure among the decided ones, fifty left: it can, with room to spare.
    expect(coversLeft({ decided: 6, failed: 1, left: 50, spent: 7, budget })).toBe(true);
    expect(coversLeft({ decided: 43, failed: 0, left: 85, spent: 2, budget })).toBe(true);
    // Nothing left is covered whatever was spent.
    expect(coversLeft({ decided: 30, failed: 30, left: 0, spent: 63, budget })).toBe(true);
    expect(UNITS_EVIDENCE).toBe(4);
    expect(UNITS_MARGIN).toBe(3);
  });

  test("bisect a batch to the trials that fail alone, within a budget", async () => {
    let budget = 10;
    const test = async (set: readonly number[]) => {
      if (budget-- <= 0) return undefined;
      return set.includes(3) ? "breaks" : "holds";
    };
    const verdicts = await bisect([1, 2, 3, 4], test, (verdict) => verdict === "holds");
    expect([...verdicts]).toEqual([
      [1, "holds"],
      [2, "holds"],
      [3, "breaks"],
      [4, "holds"],
    ]);
    budget = 0;
    const spent = await bisect([1, 2], test, (verdict) => verdict === "holds");
    expect([...spent.values()]).toEqual([undefined, undefined]);
  });
});

describe("check 2's mutations and the marks", () => {
  test("set every chosen field to a text, a rich one to one run, nothing for an empty one", () => {
    const long = mutated(parts, (id) => id !== "f-head", "Invented");
    expect(fieldsOf(long)).toEqual([
      'f-head=[{"text":"Work"}]',
      'f-a=[{"text":"Invented"}]',
      'f-b=[{"text":"Invented"}]',
      'f-c=[{"text":"Invented"}]',
    ]);
    expect(fieldsOf(mutated(parts, () => true, ""))).toEqual([
      "f-head=[]",
      "f-a=[]",
      "f-b=[]",
      "f-c=[]",
    ]);
  });

  test("try the long and special texts in one, the special text at both of a field's edges", () => {
    expect(LONG_AND_SPECIAL.startsWith(MUTATIONS.special)).toBe(true);
    expect(LONG_AND_SPECIAL.endsWith(MUTATIONS.special)).toBe(true);
    expect(LONG_AND_SPECIAL).toContain(MUTATIONS.long);
  });

  /** Fields as `ownStop` hears them, each id its kind's unless given. */
  const heard = (...ids: string[]) =>
    ids.map((id) => ({ id, kind: id.includes(":") ? (id.split(":")[0] as string) : id }));

  test("take a stop for the text's own once fields of three kinds, and two no compile named, stop it alone", () => {
    const own = ownStop();
    const trying = heard("a", "b", "c", "d", "e", "f", "g", "h");
    own.heard(trying, true);
    for (const named of ["a", "b"]) {
      own.heard(heard(named), true);
      expect(own.asks()).toBe(false);
    }
    own.heard(heard("c"), true);
    // Three kinds stopped it alone, but what is left without them has not stopped yet.
    expect(own.asks()).toBe(false);
    own.heard(heard("d", "e", "f", "g", "h"), true);
    expect(own.asks()).toBe(true);
    // The first and the last of the fields none tried alone, then asked once only.
    const unnamed = own.unnamed(trying);
    expect(unnamed.map((each) => each.id)).toEqual(["d", "h"]);
    expect(own.asks()).toBe(false);
    expect(own.shown()).toBe(false);
    for (const each of unnamed) own.heard([each], true, true);
    expect(own.shown()).toBe(true);
  });

  test("never take a stop for the text's own where a field is its cause", () => {
    // A set went through: some field takes the text.
    const passed = ownStop();
    passed.heard(heard("a", "b", "c", "d", "e"), true);
    passed.heard(heard("a", "b"), false);
    for (const named of ["c", "d", "e"]) passed.heard(heard(named), true);
    passed.heard(heard("f", "g"), true);
    expect(passed.asks()).toBe(false);
    // The fields that stopped it alone are all of one kind, which may be what stops it.
    const oneKind = ownStop();
    for (const named of ["x:1", "x:2", "x:3", "x:4"]) oneKind.heard(heard(named), true);
    oneKind.heard(heard("y", "z"), true);
    expect(oneKind.asks()).toBe(false);
    // Several fields named rightly, each its own cause: one no compile named takes the text.
    const named = ownStop();
    for (const each of ["a", "b", "c"]) named.heard(heard(each), true);
    named.heard(heard("d", "e", "f"), true);
    expect(named.asks()).toBe(true);
    const [first, second] = named.unnamed(heard("a", "b", "c", "d", "e", "f"));
    if (first === undefined || second === undefined) throw new Error("no unnamed field");
    named.heard([first], true, true);
    named.heard([second], false, true);
    expect(named.shown()).toBe(false);
    // The fields no compile named are of kinds none tried alone was of, each of another.
    const kinds = ownStop();
    for (const each of ["a", "b", "c"]) kinds.heard(heard(each), true);
    kinds.heard(heard("a:2", "d:1", "d:2", "e"), true);
    expect(kinds.asks()).toBe(true);
    expect(kinds.unnamed(heard("a:2", "d:1", "d:2", "e")).map((each) => each.id)).toEqual([
      "d:1",
      "e",
    ]);
  });

  test("mark required fields and fixed groups, with why, and nothing else", () => {
    const out = marked(parts, new Set(["f-a"]), new Map([["g2", "copy" as const]]));
    const steps = [...outlineNodes(out)].flatMap((step) =>
      step.kind !== "part"
        ? []
        : step.part.kind === "group"
          ? [`${step.part.id}:${step.part.fixed ?? "-"}`]
          : step.part.kind === "rich"
            ? [`${step.part.id}:${step.part.required === true ? "required" : "-"}`]
            : [],
    );
    expect(steps).toEqual(["f-head:-", "g1:-", "f-a:required", "f-b:-", "g2:copy", "f-c:-"]);
    expect(rich("x", "y", true)).toMatchObject({ required: true });
  });
});

/**
 * An invented resume whose template's macros fail the checks on purpose: its name stops TeX when
 * empty, its motto when it is set wider than 200 points, and its jobs when there are more than two
 * of them; and a list of bullets that takes anything.
 */
const CHECKED = String.raw`\documentclass{article}
\pagestyle{empty}
\newcounter{jobs}
\newcommand{\job}[1]{\stepcounter{jobs}\ifnum\value{jobs}>2 \errmessage{Only two jobs}\fi\par\noindent\textbf{#1}\par}
\newcommand{\motto}[1]{\setbox0\hbox{#1}\ifdim\wd0>200pt \errmessage{The motto is too long}\fi\par\noindent #1\par}
\newcommand{\person}[1]{\setbox0\hbox{#1}\ifdim\wd0=0pt \errmessage{A name is needed}\fi\par\noindent #1\par}
\begin{document}
\person{Quill Wren}
\motto{Careful type, kept}
\job{Lantern Works}
\job{Mill and Sons}
\begin{itemize}
\item Set invented type by hand
\item Kept the press running
\item Wrote invented notes
\end{itemize}
\end{document}
`;

describe.skipIf(!engineAvailable())("the checks on the engine (the second pass's item 6)", () => {
  let deps: ImportDeps;
  beforeAll(async () => {
    const manifest = JSON.parse(
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

  test("keep a field that stops on text, require one that stops when empty, and fix a group a copy stops", async () => {
    const outcome = await importResume([{ name: "cv.tex", bytes: strToU8(CHECKED) }], deps);
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    const { outline, checks } = outcome.report;
    const [section] = outcome.document.resume.sections;
    if (section?.kind !== "outline") throw new Error("no outline");
    const fields = [...outlineNodes(section.parts)].flatMap((step) =>
      step.kind === "part" && (step.part.kind === "rich" || step.part.kind === "text")
        ? [step.part]
        : [],
    );
    const groups = [...outlineNodes(section.parts)].flatMap((step) =>
      step.kind === "part" && step.part.kind === "group" ? [step.part] : [],
    );
    const textOf = (part: (typeof fields)[number]) =>
      typeof part.text === "string" ? part.text : part.text.map((run) => run.text).join("");
    // The motto stops TeX on a long text: it is kept as the upload wrote it, and no field.
    expect(fields.map(textOf)).not.toContain("Careful type, kept");
    expect(outline.kept).toEqual({ text: 1 });
    expect(checks.fields.locked.text).toBe(1);
    // The name stops TeX when empty: it stays a field, required.
    expect(fields.filter((part) => part.required === true).map(textOf)).toEqual(["Quill Wren"]);
    expect(outline.required).toBe(1);
    // The jobs take no third: their group is fixed, its copy having stopped the compile; the
    // bullets take anything.
    const jobs = groups.find((group) => group.units.length === 2);
    const bullets = groups.find((group) => group.units.length === 3);
    expect(jobs?.fixed).toBe("stops");
    expect(bullets?.fixed).toBeUndefined();
    expect(outline.fixed).toEqual({ stops: 1 });
    // The page is the original's, and the report names the kept motto in plain words.
    expect(checks.outcome).toBe("assembled");
    const report = reportOfImport(outcome);
    expect(report.shares).toBeDefined();
    expect(report.notes.join(" ")).toContain(
      "1 of your resume's 2 lists and runs of entries keeps",
    );
    expect(report.notes.join(" ")).not.toMatch(/[\\{}]/);
  }, 60_000);

  test("say as each check ends what it settled, and open the page, then the fields, on it (decision 0071)", async () => {
    const stages: ImportStage[] = [];
    const outcome = await importResume([{ name: "cv.tex", bytes: strToU8(CHECKED) }], {
      ...deps,
      onStage: (stage) => stages.push(stage),
    });
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    // Check 1 finds the outline sets the page at its first compile, every field to stay locked;
    // check 2 keeps the motto as text, so its outline is another, compiled again by the checks, whose
    // page comes with the fields, the name required. Check 3 then fixes the jobs, in the outcome.
    expect(stages.map((stage) => [stage.phase, stage.output !== undefined])).toEqual([
      ["page", true],
      ["fields", true],
    ]);
    const textsOf = (stage: ImportStage | undefined) => {
      const [section] = stage?.document.resume.sections ?? [];
      if (section?.kind !== "outline") throw new Error("no outline");
      return [...outlineNodes(section.parts)].flatMap((step) =>
        step.kind === "part" && (step.part.kind === "rich" || step.part.kind === "text")
          ? [step.part.required === true ? "required" : "field"]
          : [],
      );
    };
    expect(textsOf(stages[0]).length).toBe(textsOf(stages[1]).length + 1);
    expect(textsOf(stages[1]).filter((each) => each === "required")).toHaveLength(1);
    expect(withOutcomeMarks(stages[1]?.document as Document, outcome.document)).toBe(
      outcome.document,
    );
  }, 60_000);
});

/**
 * An invented resume whose preamble makes one letter of check 2's special text stop TeX wherever
 * it is set, as a font that lacks it would: every field stops on that text, by no fault of its own.
 */
const LETTERLESS = String.raw`\documentclass{article}
\pagestyle{empty}
\DeclareUnicodeCharacter{011F}{\errmessage{This invented font has no such letter}}
\begin{document}
\section*{Invented heading}
Set invented type by hand for a small press.

Kept the invented press running through the winter.

Wrote invented notes on paper and ink.

Bound invented books in cloth and thread.

Taught invented lettering to new hands.

Mended invented frames and cases.

Sorted invented type into its cases.

Printed invented posters for the fair.
\end{document}
`;

/**
 * An invented resume whose entries stop TeX when empty, and a list that takes anything: the empty
 * text's bisection, on a budget of two compiles, cannot reach every entry.
 */
const ENTRIES = String.raw`\documentclass{article}
\pagestyle{empty}
\newcommand{\entry}[1]{\setbox0\hbox{#1}\ifdim\wd0=0pt \errmessage{An entry is needed}\fi\par\noindent #1\par}
\begin{document}
\entry{Lantern Works}
\entry{Mill and Sons}
\entry{The Invented Press}
\entry{Paper and Ink}
\begin{itemize}
\item Set invented type by hand
\item Kept the press running
\end{itemize}
\end{document}
`;

describe.skipIf(!engineAvailable())("the checks' budgets on the engine (decision 00XX)", () => {
  let deps: ImportDeps;
  beforeAll(async () => {
    const manifest = JSON.parse(
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

  test("keep every field for a text that stops the compile in any, without a compile a field", async () => {
    // The compiles of each phase of the checks, counted on the session.
    let phase = "";
    const compiles = new Map<string, number>();
    const session = new Proxy(deps.session, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (key === "compile")
          return (...args: Parameters<typeof target.compile>) => {
            compiles.set(phase, (compiles.get(phase) ?? 0) + 1);
            return target.compile(...args);
          };
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const outcome = await importResume([{ name: "cv.tex", bytes: strToU8(LETTERLESS) }], {
      ...deps,
      session,
      observe: {
        checks: (event) => {
          if ("phase" in event) phase = event.phase;
        },
      },
    });
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    const { outline, checks } = outcome.report;
    // Every paragraph and the heading stop on the special text: each is kept as text.
    expect(outline.kept).toEqual({ text: 9 });
    expect(checks.fields.locked.text).toBe(9);
    // The stop is shown the text's own before the bisection has tried each of the nine alone, which
    // takes seventeen compiles or more; nothing is left untested.
    expect(compiles.get("check 2 bisection") ?? 0).toBeLessThan(14);
    expect(outline.kept.untested).toBeUndefined();
  }, 60_000);

  test("require the fields the empty text's bisection does not reach, which took text", async () => {
    const outcome = await importResume([{ name: "cv.tex", bytes: strToU8(ENTRIES) }], {
      ...deps,
      checkBudget: 2,
    });
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    const { outline, checks } = outcome.report;
    // Every field took the long and special texts; the entries stop when empty, and those the
    // budget left are required with them, not kept as text.
    expect(outline.kept).toEqual({});
    expect(checks.fields.locked.untested).toBeUndefined();
    expect(outline.required).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
