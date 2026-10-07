import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type OutlinePart,
  type OutlineRich,
  type OutlineText,
  outlineNodes,
  type RichText,
} from "@resume-tools/resume-model";
import { strToU8 } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { escapeText } from "../templates/escape";
import { generateBody } from "../templates/generate";
import { TemplatePackage } from "../templates/package";
import { signaturesOf } from "../test/invented-import";
import { bound, cpuMs, fastest } from "../test/timing";
import { candidatesOf } from "./candidates";
import { glyphsOnly, OutlineCompiler } from "./checks";
import { readTree } from "./fonts";
import { treeImages } from "./intake";
import {
  buildOutline,
  groupsOf,
  hyperrefLines,
  type Outline,
  outlinePackage,
  outlineResume,
  ownersOf,
  unwrittenRule,
} from "./outline";
import { bodyOfText, parseBody, type Tree } from "./parse";
import type { ProbeCandidate, Verdict } from "./probe";
import { difference } from "./reference";
import { isRefusal } from "./refusal";
import { reportOfImport } from "./report";
import { type ImportDeps, importResume } from "./run";
import type { EngineSignatures } from "./signatures";

// Every body, command and word here is invented for these tests: no real resume's.

/** An invented template in Jake's Resume's shape: lists opened and closed by macros of its own. */
const FLAT = signaturesOf(
  {
    inventedentry: "m m",
    inventedbullet: "m",
    inventedlist: "",
    inventedlistend: "",
    inventedbullets: "",
    inventedbulletsend: "",
  },
  {},
  {
    inventedlist: "macro:->\\begin {itemize}",
    inventedlistend: "macro:->\\end {itemize}",
    inventedbullets: "macro:->\\begin {itemize}",
    inventedbulletsend: "macro:->\\end {itemize}\\vspace {-5pt}",
    inventedentry: "macro:#1#2->\\item \\textbf {#1} #2",
    inventedbullet: "macro:#1->\\item \\small {#1}",
  },
);

const BODY = String.raw`
% An invented comment, kept with the rest: 100\% of it.
\section{Invented Studies}
  \inventedlist
    \inventedentry{Quill Academy}{Wrenford}
    \inventedentry{Heron College}{Lark Bay}
  \inventedlistend
\section{Invented Work}
  \inventedlist
    \inventedentry{Invented Role}{Invented Place}
      \inventedbullets
        \inventedbullet{Tended invented bees}
        \inventedbullet{Wrote invented words}
      \inventedbulletsend
  \inventedlistend
\section{Invented Skills}
\begin{itemize}
  \item Invented skill one
  \item Invented skill two
\end{itemize}
`;

function treeOf(text: string, signatures: EngineSignatures): Tree {
  const tree = parseBody(bodyOfText(text), signatures);
  if (isRefusal(tree)) throw new Error(tree.message);
  return tree;
}

/**
 * Every candidate of a body as the probe would leave it: each that holds text alone editable, or
 * as `verdict` says by its id, and the rest as they are not probed.
 */
function probed(tree: Tree, verdict: (id: string) => Verdict = () => "editable"): ProbeCandidate[] {
  return candidatesOf(tree).candidates.map((each) => ({
    ...each,
    verdict: each.unprobed ?? verdict(each.id),
    settled: each.unprobed === undefined ? "together" : "unprobed",
  }));
}

/** The outline of a body, every candidate the probe proved, or as `verdict` says. */
function outlineOf(
  text: string,
  signatures: EngineSignatures = FLAT,
  verdict?: (id: string) => Verdict,
): Outline {
  const tree = treeOf(text, signatures);
  return buildOutline({
    tree,
    candidates: probed(tree, verdict),
    macros: signatures.macros,
    begin: "\\begin{document}",
    end: "\\end{document}",
  });
}

/** An outline's package, invented, which the generator writes the tests' outlines through. */
let PACKAGE: TemplatePackage;
beforeAll(async () => {
  PACKAGE = await outlinePackage({
    engine: "pdftex",
    preamble: "\\documentclass{article}\n",
    files: {},
    reference: { log: "(hyperref.sty)" },
  });
});

/**
 * An outline's parts as the generator writes them (`generateBody`), its kept text as it is, every
 * unit after its gap but a group's first, and each field in its marker, the marker then taken off:
 * a field of plain words reads as its text.
 */
function written(parts: OutlinePart[]): string {
  const resume = outlineResume(parts);
  if (resume === undefined) throw new Error("the model refuses the outline");
  const { latex } = generateBody(PACKAGE, resume, {});
  return latex.replace(/\\rtfield\{[a-z0-9-]+\.text\}\{([^{}]*)\}/g, "$1").replace(/\n$/, "");
}

/** Parts with the rich field `id`, wherever it stands, given `text`. */
function withText(parts: readonly OutlinePart[], id: string, text: RichText): OutlinePart[] {
  return parts.map((part) =>
    part.kind === "rich" && part.id === id
      ? { ...part, text }
      : part.kind === "group"
        ? {
            ...part,
            units: part.units.map((unit) => ({ ...unit, parts: withText(unit.parts, id, text) })),
          }
        : part,
  );
}

/** A field's text, plain. */
const textOf = (part: OutlineText | OutlineRich) =>
  typeof part.text === "string" ? part.text : part.text.map((run) => run.text).join("");

/** The fields of an outline, by id, with their text. */
function fieldsOf(parts: readonly OutlinePart[]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const step of outlineNodes(parts))
    if (step.kind === "part" && (step.part.kind === "text" || step.part.kind === "rich"))
      found[step.part.id] = textOf(step.part);
  return found;
}

/** The rich texts of an outline's fields, in order. */
const richTexts = (parts: readonly OutlinePart[]) =>
  [...outlineNodes(parts)].flatMap((step) =>
    step.kind === "part" && step.part.kind === "rich" ? [step.part.text] : [],
  );

/** The kept text and fields of an outline, a field as `[id=text]`. */
const shown = (parts: readonly OutlinePart[]) =>
  [...outlineNodes(parts)]
    .flatMap((step) =>
      step.kind !== "part"
        ? []
        : step.part.kind === "kept"
          ? [step.part.latex]
          : step.part.kind === "text" || step.part.kind === "rich"
            ? [`[${step.part.id}=${textOf(step.part)}]`]
            : [],
    )
    .join("");

describe("the outline (decision 0049)", () => {
  test("keeps every byte but its fields', and each field's text where it stands", () => {
    const { parts, counts } = outlineOf(BODY);
    // Each field written back as the text it holds gives the body back, byte for byte, between
    // `\begin{document}` and `\end{document}`: nothing kept moved, nothing was added.
    expect(written(parts)).toBe(`\\begin{document}${BODY}\\end{document}`);
    expect(fieldsOf(parts)).toEqual({
      s1: "Invented Studies",
      "c2-1": "Quill Academy",
      "c2-2": "Wrenford",
      "c3-1": "Heron College",
      "c3-2": "Lark Bay",
      s2: "Invented Work",
      "c6-1": "Invented Role",
      "c6-2": "Invented Place",
      "c8-1": "Tended invented bees",
      "c9-1": "Wrote invented words",
      s3: "Invented Skills",
      i1: "Invented skill one",
      i2: "Invented skill two",
    });
    expect(counts).toEqual({ fields: 13, groups: 4, units: 9 });
  });

  test("holds a text's bold, italic and links as rich text, which the generator writes as its own", () => {
    const { parts } = outlineOf(
      String.raw`\inventedbullet{Wrote {\bfseries invented} \textit{words} \href{https://quill.example/a}{here}}`,
    );
    const [, field] = parts;
    expect(field).toEqual({
      kind: "rich",
      id: "c1-1",
      text: [
        { text: "Wrote " },
        { text: "invented", bold: true },
        { text: " " },
        { text: "words", italic: true },
        { text: " " },
        { text: "here", href: "https://quill.example/a" },
      ],
    });
  });

  test("ends no line after an address's `%`, which is no comment, before a field", () => {
    // A link whose address holds a `%`, right before a field on its line: the generator writes no
    // line's end after the kept text, which TeX would read as a space.
    const body = String.raw`\href{https://quill.example/in/jos%C3%A9}{\underline{Invented link}} more
% a comment, whose line's end is its own
\section{Invented}
`;
    const { parts } = outlineOf(body);
    expect(Object.values(fieldsOf(parts))).toEqual(["Invented link", "more", "Invented"]);
    expect(written(parts)).toBe(`\\begin{document}${body}\\end{document}`);
  });

  test("makes groups of the sections, the entries, the bullets and the list's items", () => {
    const { parts } = outlineOf(BODY);
    const groups = [...outlineNodes(parts)].flatMap((step) =>
      step.kind === "part" && step.part.kind === "group"
        ? [`${step.part.id}@${step.depth}: ${step.part.units.length}`]
        : [],
    );
    // The sections; the first's two entries; the second's one entry is no group, but its bullets
    // are; and the skills' items.
    expect(groups).toEqual(["g1@0: 3", "g2@1: 2", "g3@1: 2", "g4@1: 2"]);
    // Each unit carries what parts it from the one before; the first, what parts the second.
    const [, sections] = parts;
    if (sections?.kind !== "group") throw new Error("no group of sections");
    expect(sections.units.map((unit) => JSON.stringify(unit.gap))).toEqual([
      '"\\n"',
      '"\\n"',
      '"\\n"',
    ]);
    expect(groupsOf(treeOf(BODY, FLAT), FLAT.macros)).toHaveLength(4);
  });

  test("keeps as kept text what the probe did not prove, and makes a field a line of a leaf that breaks its line", () => {
    const body = String.raw`\inventedentry{Quill Academy}{Heron \hfill Wrenford \\ Lark Bay}
\inventedentry{Heron College}{Lark Bay}
`;
    const { parts } = outlineOf(body, FLAT, (id) => (id === "c2-1" ? "moved" : "editable"));
    expect(written(parts)).toBe(`\\begin{document}${body}\\end{document}`);
    // The second call's first argument moved the page; the first's second breaks its line, which a
    // field, one paragraph, would set on one: each line is a field, the break kept text.
    expect(fieldsOf(parts)).toEqual({
      "c1-1": "Quill Academy",
      t1: "Heron",
      "t2-p1": "Wrenford",
      "t2-p2": "Lark Bay",
      "c2-2": "Lark Bay",
    });
    expect(shown(parts)).toContain("{[t1=Heron] \\hfill [t2-p1=Wrenford] \\\\ [t2-p2=Lark Bay]}");
  });

  describe("a leaf that breaks its line", () => {
    test("is a field a line, each line's marks its own, the breaks between them kept", () => {
      // A line a skill, each with a bold label, after a word set on the same line.
      const body = String.raw`\begin{itemize}
  \small{\item{Invented: \hfill
    \textbf{Invented Tongues}{: Quillish, Wrenese} \\
    \textbf{Invented Tools}{: Heron Press, Lark Loom} \\
    \textbf{Invented Arts}{: Inkwork}
  }}
\end{itemize}
`;
      const { parts } = outlineOf(body);
      expect(richTexts(parts)).toEqual([
        [{ text: "Invented:" }],
        [{ text: "Invented Tongues", bold: true }, { text: ": Quillish, Wrenese" }],
        [{ text: "Invented Tools", bold: true }, { text: ": Heron Press, Lark Loom" }],
        [{ text: "Invented Arts", bold: true }, { text: ": Inkwork" }],
      ]);
      // Each field's markers hold its own line, and no break.
      expect(shown(parts)).toContain(
        "[t2-p1=Invented Tongues: Quillish, Wrenese] \\\\\n    [t2-p2=Invented Tools: Heron Press, Lark Loom] \\\\\n    [t2-p3=Invented Arts: Inkwork]",
      );
    });

    test("keeps a first line that may begin its line, which empty would leave its break nothing to end", () => {
      // Jake's skills block's shape: the item's group holds its lines and nothing before them, so
      // TeX may be between paragraphs where the first line begins.
      const body = String.raw`\begin{itemize}
  \small{\item{
    \textbf{Invented Tongues}{: Quillish, Wrenese} \\
    \textbf{Invented Tools}{: Heron Press, Lark Loom}
  }}
\end{itemize}
Lark \\ Heron

Quill \hfill Wren \\ Owl
`;
      const { parts } = outlineOf(body);
      expect(shown(parts)).toContain(
        "\\textbf{Invented Tongues}{: Quillish, Wrenese} \\\\\n    [i1=Invented Tools: Heron Press, Lark Loom]\n",
      );
      expect(Object.values(fieldsOf(parts))).toEqual([
        "Invented Tools: Heron Press, Lark Loom",
        "Heron",
        "Quill",
        "Wren",
        "Owl",
      ]);
    });

    test("counts a first line kept as text as kept, its glyphs at most, never as a field", () => {
      const body = String.raw`\begin{itemize}
  \item{\textbf{Officers}{: Quillish, Wrenese} \\ Heron Press}
\end{itemize}
`;
      const tree = treeOf(body, FLAT);
      const candidates = probed(tree);
      const outline = buildOutline({
        tree,
        candidates,
        macros: FLAT.macros,
        begin: "\\begin{document}",
        end: "\\end{document}",
      });
      expect(fieldsOf(outline.parts)).toEqual({ i1: "Heron Press" });
      const run = {
        page: 0,
        from: 10,
        to: 60,
        first: { h: 0, v: 0 },
        last: { h: 0, v: 0 },
        by: "candidate" as const,
        candidate: "i1",
      };
      // With no page to line it up with, "Officers: Quillish, Wrenese" sets at most 28 glyphs: its
      // 25 characters but its spaces, and a hyphen a word.
      expect(ownersOf([run], candidates, outline.fields)).toEqual([
        { page: 0, from: 10, to: 38, kept: "shape" },
        { page: 0, from: 38, to: 60, field: "i1.text" },
      ]);
      // On the page it sets 24, a ligature for "ffi" and a hyphen TeX added among them: lined up
      // with them, it is counted to its last glyph, no more, no fewer.
      const glyphs = [
        ...Array.from({ length: 10 }, () => "·"),
        ...["O", "ffi", "c", "e", "r", "s", ":", "Q", "u", "i", "l", "l", "i", "s", "h", ","],
        ...["W", "r", "e", "n", "-", "e", "s", "e"],
        ...["H", "e", "r", "o", "n", "P", "r", "e", "s", "s"],
      ];
      const page = { pages: [{ items: glyphs.map((text) => ({ kind: "glyph", text })) }] };
      expect(
        ownersOf(
          [{ ...run, to: glyphs.length }],
          candidates,
          outline.fields,
          new Map(),
          page as never,
        ),
      ).toEqual([
        { page: 0, from: 10, to: 34, kept: "shape" },
        { page: 0, from: 34, to: 44, field: "i1.text" },
      ]);
    });

    test("keeps a first line after a raw break, which ends the paragraph where text is centred", () => {
      // In `center` a `\\[2pt]` ends the paragraph: the next line begins one, and emptied would
      // leave its own break nothing to end. The last line, emptied, ends nothing.
      const body = String.raw`\begin{center} Quill \\[2pt] Lark \\ Wren \end{center}
`;
      const { parts } = outlineOf(body);
      expect(written(parts)).toBe(`\\begin{document}${body}\\end{document}`);
      expect(Object.values(fieldsOf(parts))).toEqual(["Quill", "Wren"]);
      expect(shown(parts)).toContain("Lark \\\\ [");
    });

    test("leaves no line of nothing, between two breaks or at either end, a field", () => {
      const body = String.raw`\inventedbullet{Lark \hfill Quill \\ \\ Wren \\}
`;
      const { parts } = outlineOf(body);
      expect(written(parts)).toBe(`\\begin{document}${body}\\end{document}`);
      expect(shown(parts)).toBe(
        "\\begin{document}\\inventedbullet{[t1=Lark] \\hfill [t2-p1=Quill] \\\\ \\\\ [t2-p2=Wren] \\\\}\n\\end{document}",
      );
    });

    test("is kept whole where a break is inside a group or a mark, which a marker cannot part", () => {
      for (const inner of [
        String.raw`Lark \hfill \textbf{Quill \\ Wren}`,
        String.raw`Lark \hfill Heron {Quill \\ Wren}`,
        String.raw`Lark \hfill \href{https://quill.example/}{Quill \\ Wren}`,
        String.raw`Lark \hfill Heron \emph{Quill \\ Wren} Owl`,
      ]) {
        const body = `\\inventedbullet{${inner}}\n`;
        const { parts } = outlineOf(body);
        expect(written(parts), inner).toBe(`\\begin{document}${body}\\end{document}`);
        expect(Object.values(fieldsOf(parts)), inner).toEqual(["Lark"]);
      }
    });

    test("carries a declaration's marks over its breaks, each line in them", () => {
      // A group's `\bfseries` marks the text after it, across the break; `\hfill` is no text, so
      // the leaf after it is read in bold.
      const body = String.raw`\inventedbullet{{\bfseries Lark\hfill Quill \\ Wren}}
`;
      const { parts } = outlineOf(body);
      expect(shown(parts)).toBe(
        "\\begin{document}\\inventedbullet{{[t1=Lark]\\hfill [t2-p1=Quill] \\\\ [t2-p2=Wren]}}\n\\end{document}",
      );
      expect(richTexts(parts)).toEqual([
        [{ text: "Lark", bold: true }],
        [{ text: "Quill", bold: true }],
        [{ text: "Wren", bold: true }],
      ]);
      // A declaration inside the leaf, before its break, marks the next line too.
      const inside = String.raw`\inventedbullet{{Lark\hfill Heron \bfseries Quill \\ Wren}}
`;
      const read = outlineOf(inside);
      expect(richTexts(read.parts)).toEqual([
        [{ text: "Lark" }],
        [{ text: "Heron " }, { text: "Quill", bold: true }],
        [{ text: "Wren", bold: true }],
      ]);
    });

    test("is one field where its only `\\\\` is in a comment, and kept where it ends a paragraph", () => {
      const body = "\\inventedbullet{Quill % once \\\\ here\n  Wren}\n";
      const { parts } = outlineOf(body);
      expect(written(parts)).toBe("\\begin{document}\\inventedbullet{Quill Wren}\n\\end{document}");
      expect(fieldsOf(parts)).toEqual({ "c1-1": "Quill Wren" });
    });

    test("parts lines a starred break, one with a length, `\\newline` and `\\linebreak` as before", () => {
      for (const brk of [
        String.raw`\\*`,
        String.raw`\\[2pt]`,
        String.raw`\newline`,
        String.raw`\linebreak`,
      ]) {
        const body = `\\inventedbullet{Quill ${brk} Wren}\n`;
        const { parts } = outlineOf(body);
        expect(written(parts), brk).toBe(`\\begin{document}${body}\\end{document}`);
        expect(Object.values(fieldsOf(parts)), brk).toEqual(["Quill", "Wren"]);
      }
    });
  });

  test("names the rule that declined each editable candidate it makes no field of (decision 0073)", () => {
    const body = String.raw`\inventedentry{Quill Academy}{Wrenford \\ Lark Bay}
\inventedentry{}{\textbf{Heron \\ College}}
\inventedentry{Lark Bay}{Wren Hall}
\inventedentry{Quill Hall}{Heron Bay}
`;
    const tree = treeOf(body, FLAT);
    const found = probed(tree, (id) => (id === "c4-1" ? "moved" : "editable"));
    const at = (id: string) => found.find((each) => each.id === id) as ProbeCandidate;
    const lark = at("c3-1");
    const candidates = [
      ...found,
      // Invented spans the parser never makes: one whose end crosses its text's, one over a text
      // another field holds already, and one of the preamble's with no preamble to write it in.
      { ...at("c3-2"), id: "x1", start: at("c3-2").start + 2, end: at("c3-2").end + 1 },
      { ...lark, id: "x2" },
      { ...lark, id: "x3", where: "preamble" as const },
    ];
    const outline = buildOutline({
      tree,
      candidates,
      kept: new Set(["c4-2"]),
      macros: FLAT.macros,
      begin: "\\begin{document}",
      end: "\\end{document}",
    });
    // A break the outline splits is a field a line (decision 0076), not declined; one inside a mark,
    // which it cannot split, is.
    expect(outline.fields.has("c1-2")).toBe(true);
    expect(Object.fromEntries(outline.declined)).toEqual({
      "c2-1": "empty",
      "c2-2": "line-break",
      x1: "marked-in-part",
      x2: "overlaps",
      x3: "no-preamble",
    });
    // Every editable candidate the checks did not keep is a field or declined, and nothing else is:
    // not the one the probe found moved the page, nor the one the checks kept.
    const editable = candidates.filter((each) => each.verdict === "editable" && each.id !== "c4-2");
    expect(
      editable.every((each) => outline.fields.has(each.id) !== outline.declined.has(each.id)),
    ).toBe(true);
    expect(outline.declined.has("c4-1")).toBe(false);
    expect(outline.declined.has("c4-2")).toBe(false);
    // Naming the rules changes nothing the outline writes.
    expect(written(outline.parts)).toBe(`\\begin{document}${body}\\end{document}`);
  });

  test("names a text whose source ends a paragraph, which a field would set as one", () => {
    // An invented tree whose one text runs over a blank line, as no parse of ours makes it.
    const body = "Invented words\n\nMore invented words\n";
    const tree = treeOf(body, FLAT);
    const end = body.length - 1;
    const merged: Tree = {
      ...tree,
      content: [
        { kind: "text", runs: [{ text: "Invented words More invented words" }], start: 0, end },
      ],
    };
    const [first] = probed(tree);
    if (first === undefined) throw new Error("no candidate");
    const outline = buildOutline({
      tree: merged,
      candidates: [{ ...first, start: 0, end }],
      macros: FLAT.macros,
      begin: "\\begin{document}",
      end: "\\end{document}",
    });
    expect(Object.fromEntries(outline.declined)).toEqual({ [first.id]: "several-paragraphs" });
  });

  test("says where among the groups lies a span it never came to", () => {
    // An invented group of two units, its units' own content at 10-25 and 30-50, kept text between.
    const groups = [
      {
        start: 10,
        end: 50,
        units: [
          { start: 10, end: 25, next: 30 },
          { start: 30, end: 50, next: 50 },
        ],
      },
    ];
    expect(unwrittenRule({ start: 20, end: 28 }, groups)).toBe("cut-by-unit");
    expect(unwrittenRule({ start: 5, end: 12 }, groups)).toBe("cut-by-unit");
    expect(unwrittenRule({ start: 26, end: 29 }, groups)).toBe("between-units");
    expect(unwrittenRule({ start: 12, end: 20 }, groups)).toBe("passed");
    expect(unwrittenRule({ start: 60, end: 70 }, groups)).toBe("passed");
    // Inside a unit of an outer group, between the units of a group inside it.
    const nested = [
      ...groups,
      {
        start: 31,
        end: 48,
        units: [
          { start: 31, end: 35, next: 40 },
          { start: 40, end: 48, next: 48 },
        ],
      },
    ];
    expect(unwrittenRule({ start: 36, end: 39 }, nested)).toBe("between-units");
  });

  test("keeps as text the candidates the checks name, and says each field's candidate and each group's spans", () => {
    const body = String.raw`\inventedentry{Quill Academy}{Wrenford}
\inventedentry{Heron College}{Lark Bay}
`;
    const tree = treeOf(body, FLAT);
    const input = {
      tree,
      candidates: probed(tree),
      macros: FLAT.macros,
      begin: "\\begin{document}",
      end: "\\end{document}",
    };
    const all = buildOutline(input);
    expect([...all.owners]).toEqual([
      ["c1-1", "c1-1"],
      ["c1-2", "c1-2"],
      ["c2-1", "c2-1"],
      ["c2-2", "c2-2"],
    ]);
    // The checks keep the second call's place as the upload wrote it: the same bytes, one field
    // fewer, and the group of the two calls as it was, its units' spans in the body's source.
    const checked = buildOutline({ ...input, kept: new Set(["c2-2"]) });
    expect(written(checked.parts)).toBe(written(all.parts));
    expect(written(checked.parts)).toBe(`\\begin{document}${body}\\end{document}`);
    expect([...checked.owners.keys()]).toEqual(["c1-1", "c1-2", "c2-1"]);
    expect([...checked.fields.keys()]).toEqual(["c1-1", "c1-2", "c2-1"]);
    const [[id, units] = []] = [...checked.groups];
    expect(id).toBe("g1");
    expect((units ?? []).map((unit) => body.slice(unit.start, unit.end).trim())).toEqual([
      "\\inventedentry{Quill Academy}{Wrenford}",
      "\\inventedentry{Heron College}{Lark Bay}",
    ]);
  });

  test("gives a field the spaces TeX skipped after a control word its leaf ends in", () => {
    const signatures = signaturesOf({ inventedrole: "m m" });
    const body = "Invented words \\ldots\n  \\inventedrole{Invented \\LaTeX}{Wrenford}\n";
    const tree = treeOf(body, signatures);
    const { parts } = buildOutline({
      tree,
      candidates: probed(tree),
      macros: signatures.macros,
      begin: "\\begin{document}",
      end: "\\end{document}",
    });
    // The paragraph's field ends in `\ldots`, which had TeX skip the line's end and the spaces after
    // it: they go with the field, so that none is set after its marker.
    const [, paragraph, after] = parts;
    expect(paragraph).toMatchObject({ kind: "rich", text: [{ text: "Invented words …" }] });
    expect(after).toEqual({ kind: "kept", latex: "\\inventedrole{" });
  });

  test("puts a field where an argument given as one token was, in braces of its own", () => {
    const signatures = signaturesOf({ inventedgrade: "m" });
    const { parts } = outlineOf("Grade: \\inventedgrade A.\n", signatures);
    const field = parts.find((part) => part.kind === "rich" && part.id === "c1-1");
    expect(field).toEqual({ kind: "rich", id: "c1-1", text: [{ text: "A" }], bare: true });
  });

  test("keeps no field after kept text that ends in a backslash that would escape it", () => {
    // A control space before a word: the word is no field, since its marker would follow `\`.
    const { parts } = outlineOf("Invented\\ words here\n");
    expect(outlineResume(parts)).toBeDefined();
    for (const [at, part] of parts.entries()) {
      const before = parts[at - 1];
      if (part.kind !== "kept" && before?.kind === "kept")
        expect(/(^|[^\\])(\\\\)*\\$/.test(before.latex)).toBe(false);
    }
  });

  test("keeps a group whose units do not balance as its parts, with no group", () => {
    const signatures = signaturesOf({ inventedentry: "m" });
    // Each entry opens a group the next closes: a unit copied or removed alone would not balance.
    const body = String.raw`\inventedentry{Quill}{\bfseries
\inventedentry{Heron}}
`;
    const { parts, counts } = outlineOf(body, signatures);
    expect(counts.groups).toBe(0);
    expect(written(parts)).toBe(`\\begin{document}${body}\\end{document}`);
    expect(outlineResume(parts)).toBeDefined();
  });

  test("writes a group the model refuses from its units as they were written, however deep", () => {
    // Groups nested 30 deep, the innermost holding what the model refuses, which refuses every group
    // around it: each is written once, its units' parts with no group, in linear time.
    const signatures = signaturesOf({ inventedpart: "m" }, {}, { inventedpart: "macro:#1->#1" });
    const nested = (depth: number) => {
      let text = "Invented %rt:p: a comment\n";
      for (let at = 0; at < depth; at++) text = `\\inventedpart{${text}}\\inventedpart{Wren}`;
      return `${text}\n`;
    };
    const deep = outlineOf(nested(30), signatures);
    expect(deep.counts.groups).toBe(0);
    // Every byte of it still there, kept text and fields where they stand.
    const joined = deep.parts
      .map((part) =>
        part.kind === "kept" ? part.latex : part.kind === "group" ? "" : textOf(part),
      )
      .join("");
    expect(joined).toBe(`\\begin{document}${nested(30)}\\end{document}`);
    // Three times as deep is at most some twenty times the work, where each group written again
    // inside each refused one around it doubled it at every level: 2^20 times.
    const [shallow = 0, deeper = 0] = fastest(
      [() => outlineOf(nested(10), signatures), () => outlineOf(nested(30), signatures)],
      3,
    );
    expect(deeper).toBeLessThan(bound(20, shallow));
    expect(cpuMs(() => outlineOf(nested(30), signatures))).toBeLessThan(2_000);
  }, 60_000);

  test("closes after \\end{document}, where TeX never reads them, the groups the upload leaves open", () => {
    // A `{%` whose `}` is in its comment opens a group TeX leaves open to `\end{document}`
    // (`other-0052`'s shape, the follow-up to decision 0060): the model would refuse the outline.
    const body =
      "\n{% Invented studies }\n\\section{Invented Studies}\n{% Invented work }\nQuill\n";
    // The probe proves the title; a paragraph that holds the bare `{` sets no glyph of it, and is
    // not proven.
    const { parts } = outlineOf(body, FLAT, (id) => (id.startsWith("s") ? "editable" : "vanished"));
    expect(fieldsOf(parts)).toEqual({ s1: "Invented Studies" });
    expect(outlineResume(parts)).toBeDefined();
    expect(written(parts)).toBe(`\\begin{document}${body}\\end{document}}}`);
    // One that closes a brace it never opened stays refused.
    const under = outlineOf("\nQuill}\n{% Invented }\n", FLAT, () => "vanished");
    expect(outlineResume(under.parts)).toBeUndefined();
  });

  test("is refused by the model where the upload's own LaTeX holds the editor's markers", () => {
    for (const forged of [
      "\\rtfield{c1-1.text}{Forged}",
      "\\special{rt:b:c1-1.text}",
      "\\rtlocked{part}{x}",
      "\\rt@par",
    ]) {
      // Kept text, all of it, as the probe would leave a marker the page does not show.
      const { parts } = outlineOf(`\\section{Invented}\n${forged}\n`, FLAT, () => "vanished");
      expect(outlineResume(parts), forged).toBeUndefined();
    }
  });
});

describe("the outline's package and what the generator writes of it", () => {
  test("escapes whatever a field is given, inside its marker, and writes kept text as it is", async () => {
    const { parts } = outlineOf(BODY);
    const resume = outlineResume(parts);
    if (resume === undefined) throw new Error("refused");
    const pkg = await outlinePackage({
      engine: "pdftex",
      preamble: "\\documentclass{article}\n\\makeatletter\n\\newcommand{\\inventedx}{{{x}}}\n",
      files: {
        "invented.cls": new TextEncoder().encode("\\ProvidesClass{invented}"),
        "pics/photo.png": new Uint8Array([1, 2, 3]),
        "notes.txt": new TextEncoder().encode("left out"),
      },
      reference: { log: "(hyperref.sty)" },
    });
    expect(TemplatePackage.parse(pkg)).toEqual(pkg);
    expect(pkg.id).toMatch(/^import-[0-9a-f]{12}$/);
    // The preamble with hyperref's driver passed first, a tag-like `{{` broken, and `@`'s category
    // kept for the body, which restores it before the outline.
    expect(pkg.preamble).toBe(
      [
        hyperrefLines("pdftex", true).before,
        "\\documentclass{article}",
        "\\makeatletter",
        "\\newcommand{\\inventedx}{{{}{x}}}",
        "\\expandafter\\chardef\\csname import@at\\endcsname=\\catcode`\\@",
        "",
      ].join("\n"),
    );
    expect(pkg.snippets.document).toBe(
      "\\catcode`\\@=\\csname import@at\\endcsname\\relax\n{{sections}}",
    );
    // The upload's classes at the job's top, and the engine's compatibility files; not its pictures,
    // nor what the preamble does not load.
    expect(Object.keys(pkg.files).sort()).toEqual([
      "color.cfg",
      "graphics.cfg",
      "hyperref.cfg",
      "invented.cls",
      "pdfx.sty",
    ]);
    // The same preamble and files give the same package.
    expect(
      (
        await outlinePackage({
          engine: "pdftex",
          preamble: "\\documentclass{article}\n\\makeatletter\n\\newcommand{\\inventedx}{{{x}}}\n",
          files: { "invented.cls": new TextEncoder().encode("\\ProvidesClass{invented}") },
          reference: { log: "(hyperref.sty)" },
        })
      ).id,
    ).toBe(pkg.id);

    // A field given text that would end the document, read a file and comment out the rest: every
    // character of it typesets as itself, inside the field's marker.
    const hostile = "}\\end{document}\\input{/etc/passwd}% #1 $x$ ^_~&";
    const typed = {
      ...resume,
      sections: resume.sections.map((section) =>
        section.kind === "outline"
          ? { ...section, parts: withText(section.parts, "s1", [{ text: hostile }]) }
          : section,
      ),
    };
    const { latex } = generateBody(pkg, typed, {});
    const begin = latex.indexOf("\\rtfield{s1.text}{");
    expect(begin).toBeGreaterThan(0);
    // Its text escaped as `escapeText` escapes it, a break allowed where a run has no space to
    // break at, and its marker closed right after it.
    const inside = latex
      .slice(begin + "\\rtfield{s1.text}{".length)
      .replaceAll("\\allowbreak ", "");
    expect(inside.startsWith(`${escapeText(hostile)}}`)).toBe(true);
    expect(escapeText(hostile)).toBe(
      "\\}\\textbackslash{}end\\{document\\}\\textbackslash{}input\\{/etc/passwd\\}\\% \\#1 \\$x\\$ \\textasciicircum{}\\_\\textasciitilde{}\\&",
    );
    expect(latex).not.toContain("\\end{document}\\input");
    // And the kept text around it is the upload's, byte for byte.
    expect(latex).toContain("% An invented comment, kept with the rest: 100\\% of it.\n");
    expect(latex.match(/\\end\{document\}/g)).toHaveLength(1);
  });
});

/** Invented look-alikes of the corpus's line breaks, each a whole upload. */
const BROKEN_LINES = {
  // Jake's skills block: a list's one item, a group holding a line a skill.
  skills: String.raw`\documentclass[letterpaper,11pt]{article}
\usepackage[margin=0.8in]{geometry}
\pagestyle{empty}
\begin{document}
\section{Invented Skills}
 \begin{itemize}
    \small{\item{
     \textbf{Invented Tongues}{: Quillish, Wrenese, Heronic} \\
     \textbf{Invented Tools}{: Lark Loom, Heron Press, Inkwell Nine} \\
     \textbf{Invented Arts}{: Bookbinding, Marbling}
    }}
 \end{itemize}
A paragraph of invented words, \textit{some leaning} \\ and a second line of them, \\
\textbf{bold across} a third \\[4pt] and a fourth after a gap.

Quill Wrenfield \hfill Harbour City \\ Lantern Works \\ Heron Press
\end{document}
`,
  // moderncv's entry, its description's lines broken, and a rich run across a break kept whole.
  entry: String.raw`\documentclass[11pt]{moderncv}
\moderncvstyle{classic}
\moderncvcolor{blue}
\name{Quill}{Wrenfield}
\begin{document}
\makecvtitle
\section{Invented Work}
\cventry{2021--2024}{Invented Role}{Lantern Works}{Harbour City}{}{Set careful type \\ Kept the press running \\ Wrote invented notes}
\cventry{2019--2021}{Invented Clerk}{Heron Press}{Lark Bay}{}{Inked the plates \newline Sorted the cases}
\cventry{2017--2019}{Invented Runner}{Wren Post}{Quill Town}{}{Ran \textbf{invented \\ errands} daily}
\end{document}
`,
  // First lines kept as text that TeX hyphenates many times in a narrow box, or sets with many
  // ligatures, before a line that is a field.
  hyphens: String.raw`\documentclass{article}
\pagestyle{empty}
\begin{document}
\noindent\parbox{2.4cm}{Characterization internationalization institutionalization incomprehensibilities ab \\ Quill Wren}

Affable officers sniffled in fluffy offices, baffled by offline affidavits; efficient
chiffon traffickers ruffled waffles and shuffled stiff coffee filters off the fifth
floor, scoffing at difficult sufficiency, while affluent buffoons fluffed truffles and
offered snuffled riffs to effluent muffins \\ Heron Lark Owl Finch
\end{document}
`,
};

describe.skipIf(!engineAvailable())("a leaf that breaks its line, on the engine", () => {
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

  /** An upload imported, its fields' texts, and its outline compiled again against its page. */
  async function imported(tex: string) {
    const outcome = await importResume([{ name: "cv.tex", bytes: strToU8(tex) }], deps);
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    const [section] = outcome.document.resume.sections;
    if (section?.kind !== "outline") throw new Error("no outline");
    const compiler = new OutlineCompiler({
      session: deps.session,
      fonts: deps.fonts,
      pkg: outcome.package,
      job: "lines",
      files: outcome.job.files,
    });
    const started = compiler.start();
    if (!started.ok) throw new Error("the outline's format did not dump");
    const compiled = await compiler.compile(outcome.document.resume);
    compiler.close();
    if (compiled.stream === undefined) throw new Error("the outline did not compile");
    return {
      report: outcome.report,
      // The words as the person's report counts them.
      words: reportOfImport(outcome).words,
      fields: fieldsOf(section.parts),
      // The page the outline sets, its markers aside, against the upload's own.
      differs: difference(glyphsOnly(outcome.report.reference), glyphsOnly(compiled.stream)),
    };
  }

  test("makes a field of each line, the page the upload's", async () => {
    const { report, fields, differs, words } = await imported(BROKEN_LINES.skills);
    expect(report.checks.outcome).toBe("assembled");
    expect(differs).toBeUndefined();
    expect(report.outline.kept).toEqual({});
    const texts = Object.values(fields);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Invented Tools: Lark Loom, Heron Press, Inkwell Nine",
        "Invented Arts: Bookbinding, Marbling",
        "and a second line of them,",
        "bold across a third",
        "and a fourth after a gap.",
        "Quill Wrenfield",
        "Harbour City",
        "Lantern Works",
        "Heron Press",
      ]),
    );
    // A first line that may begin its line is kept as written.
    expect(texts.some((text) => /Invented Tongues|A paragraph/.test(text))).toBe(false);
    // No line stops the compile when empty: a field emptied leaves its break a line to end.
    expect(report.outline.stops.empty).toBe(0);
    // The two first lines kept, 5 and 7 words, are counted as kept text, lined up with their
    // glyphs, and the retype reaches them; every other word is in place.
    expect(words).toMatchObject({ editable: words.body - 12, retype: 12, locked: 0 });
  }, 60_000);

  test("counts a first line kept as text to its last glyph, hyphens and ligatures aside", async () => {
    const { report, fields, differs, words } = await imported(BROKEN_LINES.hyphens);
    expect(differs).toBeUndefined();
    expect(Object.values(fields)).toEqual(["Quill Wren", "Heron Lark Owl Finch"]);
    // The kept lines' words are kept text the retype reaches, the fields' six in place.
    expect(report.outline.stops.empty).toBe(0);
    expect(words).toMatchObject({ editable: 6, retype: words.body - 6, locked: 0 });
  }, 60_000);

  test("keeps a rich run across a break whole, and the page the upload's, on moderncv", async () => {
    const { report, fields, differs } = await imported(BROKEN_LINES.entry);
    expect(differs).toBeUndefined();
    const texts = Object.values(fields);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Kept the press running",
        "Wrote invented notes",
        "Inked the plates",
        "Sorted the cases",
      ]),
    );
    expect(report.outline.kept).toEqual({});
    expect(texts).not.toContain("Set careful type");
    // The third entry's bold run holds a break: its whole description is kept as written.
    expect(texts.some((text) => /errands|daily/.test(text))).toBe(false);
  }, 60_000);
});
