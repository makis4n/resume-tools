import {
  type OutlinePart,
  type OutlineRich,
  type OutlineText,
  outlineNodes,
  type RichText,
} from "@resume-tools/resume-model";
import { beforeAll, describe, expect, test } from "vitest";
import { escapeText } from "../templates/escape";
import { generateBody } from "../templates/generate";
import { TemplatePackage } from "../templates/package";
import { signaturesOf } from "../test/invented-import";
import { bound, cpuMs, fastest } from "../test/timing";
import { candidatesOf } from "./candidates";
import {
  buildOutline,
  groupsOf,
  hyperrefLines,
  type Outline,
  outlinePackage,
  outlineResume,
} from "./outline";
import { bodyOfText, parseBody, type Tree } from "./parse";
import type { ProbeCandidate, Verdict } from "./probe";
import { isRefusal } from "./refusal";
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

  test("keeps as kept text what the probe did not prove, and a leaf that breaks its line", () => {
    const body = String.raw`\inventedentry{Quill Academy}{Wrenford \\ Lark Bay}
\inventedentry{Heron College}{Lark Bay}
`;
    const { parts } = outlineOf(body, FLAT, (id) => (id === "c2-1" ? "moved" : "editable"));
    expect(written(parts)).toBe(`\\begin{document}${body}\\end{document}`);
    // The second call's first argument moved the page; the first's second breaks its line, which a
    // field, one paragraph, would set on one.
    expect(Object.keys(fieldsOf(parts))).toEqual(["c1-1", "c2-2"]);
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
