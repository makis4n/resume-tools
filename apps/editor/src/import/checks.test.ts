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
  emptiedCopy,
  judged,
  keepsPage,
  marked,
  mutated,
  type Trial,
  trialsOf,
  tried,
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

  test("say as each check ends what it settled, and open the page, then the fields, on it (decision 00XX)", async () => {
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
