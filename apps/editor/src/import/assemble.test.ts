import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry, Resume, Section } from "@resume-tools/resume-model";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import { apply, Document } from "../editor/document";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { generateBody, generateFormat } from "../templates/generate";
import { forRole, parsePackage, type TemplatePackage } from "../templates/package";
import { parseSnippet } from "../templates/snippet";
import {
  ANSWERS,
  type AnswerRow,
  ARTICLE_SIZES,
  answerOf,
  BODY,
  CLASS,
  COMMANDS,
  ENVIRONMENTS,
  type Invented,
  inputsOf,
  JAKE_LIKE,
  MEANINGS,
  PREAMBLE,
  probeOf,
  REFERENCE,
  signaturesOf,
  treeOf,
} from "../test/invented-import";
import { bound, fastestAsync } from "../test/timing";
import {
  type Assembled,
  answersOf,
  assemble,
  type Decisions,
  hyperrefLines,
  kindOfAddress,
  LINKS,
  MAIN_FILE,
  SIZE_OPTIONS,
  takenOut,
} from "./assemble";
import { readTree } from "./fonts";
import { type Intake, intake } from "./intake";
import { bodyOf, bodyOfText, buildTree, readBody } from "./parse";
import { probe, probeUses, type Verdict } from "./probe";
import { type Reference, reference } from "./reference";
import { isRefusal, type Refusal } from "./refusal";
import { signatures } from "./signatures";

// Every document, class, answer and verdict here is invented for these tests
// (`../test/invented-import.ts`); nothing is taken from a real resume.

/** An invented document assembled, with the decisions given, against the reference given. */
async function assembleInvented(
  invented: Invented & { decisions?: Decisions; reference?: Reference },
): Promise<{ result: Assembled | Refusal; taken: Intake }> {
  const inputs = inputsOf(invented);
  const result = await assemble(
    inputs.intake,
    invented.reference ?? REFERENCE,
    inputs.tree,
    inputs.signatures,
    inputs.probe,
    inputs.answer,
    undefined,
    invented.decisions === undefined ? {} : { decisions: invented.decisions },
  );
  return { result, taken: inputs.intake };
}

/** The Jake-like document assembled, with the verdicts, answers and decisions given. */
function assembled(
  options: {
    body?: string;
    preamble?: string;
    verdicts?: Readonly<Record<string, Verdict[]>>;
    answers?: readonly AnswerRow[];
    decisions?: Decisions;
    commands?: Readonly<Record<string, string>>;
  } = {},
) {
  return assembleInvented({
    ...JAKE_LIKE,
    source: `${options.preamble ?? PREAMBLE}${options.body ?? BODY}`,
    commands: { ...JAKE_LIKE.commands, ...(options.commands ?? {}) },
    answers: options.answers ?? ANSWERS,
    ...(options.verdicts === undefined ? {} : { verdicts: options.verdicts }),
    ...(options.decisions === undefined ? {} : { decisions: options.decisions }),
  });
}

/**
 * An assembly that did not refuse, whose package and document the model's schemas take: its
 * extras slots where their nodes keep extras, and its locked sections and extras kept LaTeX
 * (decision 0025), as the store will parse them.
 */
function ok(result: Assembled | Refusal): Assembled {
  if (isRefusal(result)) throw new Error(`refused: ${result.message}`);
  parsePackage(result.package);
  Document.parse(result.document);
  return result;
}

const sectionOf = (result: Assembled, at: number): Section => {
  const section = result.document.resume.sections[at];
  if (section === undefined) throw new Error(`no section ${at}`);
  return section;
};

describe("the package", () => {
  test("is a decision 0006 package under import-, the same for the same template", async () => {
    const first = ok((await assembled()).result);
    const again = ok((await assembled()).result);
    expect(first.package.id).toMatch(/^import-[0-9a-f]{12}$/);
    expect(again.package.id).toBe(first.package.id);
    expect(() => parsePackage(first.package)).not.toThrow();
    // Another person's text in the same template makes the same package.
    const other = ok(
      (await assembled({ body: BODY.replace("Invented role", "Other invented role") })).result,
    );
    expect(other.package.id).toBe(first.package.id);
    expect(first.package.name).toBe("inventedcv");
    expect(first.package.source).toEqual({ url: "main.tex", license: "", attribution: "" });
    expect(Object.keys(first.package.files)).toContain("inventedcv.cls");
  });

  test("rewrites the preamble only as far as the loop needs", async () => {
    const { preamble } = ok((await assembled()).result).package;
    const lines = hyperrefLines("pdftex", false);
    expect(preamble.startsWith(`${lines.before}\n`)).toBe(true);
    expect(preamble).toContain(lines.after);
    // The class's size is the font size control's slot, and the header's call is out.
    expect(preamble).toContain("\\documentclass[{{fontSize}}pt,letterpaper]{inventedcv}");
    expect(preamble).not.toContain("\\cvname{");
    // No font changes and nothing else: the geometry and the comment stay as they are.
    expect(preamble).toContain("\\usepackage[margin=0.5in]{geometry}");
    expect(preamble).not.toContain("lmodern");
    expect(preamble).not.toContain("fontenc");
  });

  test("leaves hyperref to a document whose compile loads it, as a class may at the preamble's end", async () => {
    const reference: Reference = {
      ...REFERENCE,
      log: "(/texmf-dist/tex/latex/hyperref/hyperref.sty\nPackage: hyperref\n)",
    };
    const { preamble } = ok((await assembleInvented({ ...JAKE_LIKE, reference })).result).package;
    const lines = hyperrefLines("pdftex", true);
    expect(lines.after).toBe("");
    expect(preamble.startsWith(`${lines.before}\n`)).toBe(true);
    expect(preamble).not.toContain("hidelinks");
  });

  test("offers the generic controls the preamble proves, with its values as their defaults", async () => {
    const { controls } = ok((await assembled()).result).package;
    expect(controls.pageSize?.default).toBe("letter");
    expect(controls.pageSize?.apply.letter).toBe("");
    expect(controls.pageSize?.apply.a4).toContain("\\geometry{a4paper}");
    expect(controls.margins).toEqual({ default: 0.5, apply: "\\geometry{margin={{value}}in}" });
    expect(controls.fontSize).toEqual({
      default: 11,
      apply: "",
      format: true,
      sizes: [10, 11, 12],
    });
    expect(controls.dateFormat?.default).toBe("MMM yyyy");
  });

  test("offers the controls the answer's preamble settings name, from what the preamble sets", async () => {
    const preamble = PREAMBLE.replace(
      "\\cvname{",
      "\\definecolor{quillblue}{HTML}{1f4e79}\n\\linespread{1.2}\n\\cvname{",
    );
    const result = ok(
      (
        await assembleInvented({
          ...JAKE_LIKE,
          source: `${preamble}${BODY}`,
          parameters: [
            { parameter: "accent", command: "definecolor", key: "quillblue" },
            { parameter: "density", command: "linespread" },
            { parameter: "font", command: "usepackage" },
          ],
        })
      ).result,
    );
    const { controls } = result.package;
    expect(controls.accent).toEqual({
      default: "#1F4E79",
      apply: "\\definecolor{quillblue}{HTML}{{{value}}}",
    });
    expect(controls.density).toEqual({
      default: "normal",
      apply: {
        compact: "\\linespread{1.08}\\selectfont",
        normal: "",
        relaxed: "\\linespread{1.32}\\selectfont",
      },
    });
    expect(controls.font?.default).toBe("own");
    expect(controls.font?.choices.map((choice) => choice.id)).toEqual([
      "own",
      "charter",
      "palatino",
      "helvetica",
    ]);
    expect(() => parsePackage(result.package)).not.toThrow();
    // A control the checks drop is offered no more.
    const dropped = ok(
      (
        await assembleInvented({
          ...JAKE_LIKE,
          source: `${preamble}${BODY}`,
          parameters: [{ parameter: "accent", command: "definecolor", key: "quillblue" }],
          decisions: { controls: ["accent"] },
        })
      ).result,
    );
    expect(dropped.package.controls.accent).toBeUndefined();
  });

  test("offers the date format only where a date set from the model has a month", async () => {
    const years = ok(
      (await assembled({ body: BODY.replace("Jan 2020 -- Present", "2020 -- Present") })).result,
    );
    expect(years.package.controls.dateFormat).toBeUndefined();
    const work = sectionOf(years, 0);
    expect(work.kind === "entries" && work.entries[0]?.dates).toEqual({
      start: "2020",
      end: "present",
    });
  });

  test("derives a snippet for every place from the answer, each field beside its extra", async () => {
    const { snippets } = ok((await assembled()).result).package;
    // The template's code as the source spaced it, a line's end kept as TeX reads one.
    expect(snippets.entry).toBe(
      "\\cventry{{{title}}{{&x.title}}}{{{dates}}{{&x.dates}}}{{{subtitle}}{{&x.subtitle}}}{{{place}}{{&x.place}}}{{#bullets}}\n\\cvitemsStart\n{{bullets}}\n\\cvitemsEnd{{/bullets}}{{&x.bullets}}",
    );
    expect(snippets.bullet).toBe("\\cvitem{{{text}}}");
    expect(snippets.item).toBe("\\item {{text}}");
    const section = snippets.section;
    expect(typeof section.entries === "string" ? section.entries : section.entries.default).toBe(
      "{{&x.lead}}\\section{{{title}}{{&x.title}}}{{&x.before}}{{#entries}}\\cvlistStart\n{{entries}}\n\\cvlistEnd{{/entries}}{{&x.entries}}{{&x.after}}",
    );
    expect(
      typeof section.paragraph === "string" ? section.paragraph : section.paragraph.default,
    ).toContain("{{#text}}{{text}}{{/text}}{{&x.text}}");
    // The header before the document, the name in one argument split at its last space, and the
    // header's own call kept as the template's code.
    expect(snippets.header).toBe("\\cvname{{{first}}{{#last}} {{last}}{{/last}}{{&x.c1-first}}}\n");
    expect(
      snippets.document.startsWith("{{header}}\n\\begin{document}\n\\cvheader\n\n{{sections}}"),
    ).toBe(true);
    for (const snippet of [snippets.entry, snippets.header, snippets.document])
      expect(() => parseSnippet(snippet as string)).not.toThrow();
  });

  test("keeps comments out of every snippet", async () => {
    const result = ok(
      (
        await assembled({
          body: BODY.replace("\\cvlistStart", "\\cvlistStart % Quill's invented note"),
        })
      ).result,
    );
    expect(JSON.stringify(result.package.snippets)).not.toContain("note");
  });
});

describe("the document", () => {
  test("holds the header, sections, entries, bullets, items and a paragraph, each with a minted id", async () => {
    const result = ok((await assembled()).result);
    const { header, sections } = result.document.resume;
    expect(header.name).toEqual({ first: "Quill", last: "Invented" });
    // The last name the split gives is a field of the name's argument too.
    const names = result.checks.all.filter((field) => field.slot === "command|cvname|1");
    expect(names.map(({ field, words, at }) => ({ field, words, at }))).toEqual([
      { field: "header.first", words: 1, at: names[0]?.at },
      { field: "header.last", words: 1, at: names[0]?.at },
    ]);
    expect(sections.map((section) => section.kind)).toEqual([
      "entries",
      "list",
      "locked",
      "paragraph",
    ]);
    const work = sectionOf(result, 0);
    if (work.kind !== "entries") throw new Error("entries");
    expect(work.title).toBe("Invented experience");
    expect(work.role).toBe("experience");
    expect(work.id).toMatch(/^sec-[a-z0-9]{6}$/);
    const [first, second, third] = work.entries;
    expect(first).toMatchObject({
      title: "Invented role",
      subtitle: "Quill Co",
      place: "Harbour City",
      dates: { start: "2020-01", end: "present" },
    });
    expect(first?.bullets.map((bullet) => bullet.text)).toEqual([
      [{ text: "Invented first bullet" }],
      [{ text: "Invented " }, { text: "second", bold: true }, { text: " bullet" }],
    ]);
    // Years alone read the same in every format; a date the generator cannot write is kept as
    // the upload wrote it.
    expect(second?.dates).toEqual({ start: "2018", end: "2019" });
    expect(second?.place).toBeUndefined();
    expect(third?.dates).toBeUndefined();
    expect(third?.extras?.dates).toBe("Summer 2017");
    expect(result.extras).toContainEqual(
      expect.objectContaining({ kind: "field", key: "dates", reason: "date", words: 2 }),
    );
    const skills = sectionOf(result, 1);
    expect(skills.kind === "list" && skills.role).toBe("skills");
    expect(skills.kind === "list" && skills.items.map((item) => item.text)).toEqual([
      [{ text: "Invented skill" }],
      [{ text: "Another skill" }],
    ]);
    // The spacing between two sections stands where it was, a locked section.
    const locked = sectionOf(result, 2);
    expect(locked.kind === "locked" && locked.latex).toBe("\n\n\\vspace{2pt}%");
    const summary = sectionOf(result, 3);
    expect(summary.kind === "paragraph" && summary.text).toEqual([
      { text: "Invented words of an invented summary." },
    ]);
    expect(summary.kind === "paragraph" && summary.role).toBe("summary");
    // Ids are unique across the document, and the same for the same document.
    const again = ok((await assembled()).result);
    expect(again.document).toEqual(result.document);
  });

  test("locks an instance the probe saw move, its bytes in its entry's extras", async () => {
    const result = ok(
      (await assembled({ verdicts: { "cventry#4": ["moved", "editable"] } })).result,
    );
    const work = sectionOf(result, 0);
    if (work.kind !== "entries") throw new Error("entries");
    expect(work.entries[0]?.place).toBeUndefined();
    expect(work.entries[0]?.extras?.place).toBe("Harbour City");
    expect(work.entries[1]?.place).toBeUndefined();
    expect(result.extras).toContainEqual(
      expect.objectContaining({ kind: "field", key: "place", reason: "moved" }),
    );
    // The snippet still takes the field for a new entry.
    expect(result.package.snippets.entry).toContain("{{{place}}{{&x.place}}}");
  });

  test("keeps editable an argument a class sets in capitals, which the aligner folds", async () => {
    const result = ok((await assembled({ verdicts: { "cventry#1": ["case"] } })).result);
    expect(result.package.snippets.entry).toContain("\\cventry{{{title}}{{&x.title}}}");
    const work = sectionOf(result, 0);
    expect(work.kind === "entries" && work.entries.map((entry) => entry.title)).toEqual([
      "Invented role",
      "Second role",
      "Third role",
    ]);
    expect(result.extras.some((part) => part.reason === "case")).toBe(false);
  });

  test("keeps a list whole when a bullet of it fails, for that bullet's reason, with no fields", async () => {
    const result = ok(
      (await assembled({ verdicts: { "cvitem#1": ["moved", "editable"] } })).result,
    );
    const work = sectionOf(result, 0);
    if (work.kind !== "entries") throw new Error("entries");
    expect(work.entries[0]?.bullets).toEqual([]);
    expect(work.entries[0]?.extras?.bullets).toContain("\\cvitem{Invented first bullet}");
    expect(result.extras).toContainEqual(
      expect.objectContaining({ kind: "list", key: "bullets", reason: "moved", words: 6 }),
    );
    expect(result.checks.all.some((field) => field.slot === "command|cvitem|1")).toBe(false);
  });

  test("locks a slot in every instance where a call's argument fails whatever it holds", async () => {
    const result = ok(
      (await assembled({ verdicts: { "cventry#3": ["twice", "editable"] } })).result,
    );
    expect(result.package.snippets.entry).toContain("{{{&x.subtitle}}}");
    expect(result.package.snippets.entry).not.toContain("{{subtitle}}");
    const work = sectionOf(result, 0);
    if (work.kind !== "entries") throw new Error("entries");
    expect(work.entries.map((entry) => entry.extras?.subtitle)).toEqual([
      "Quill Co",
      "Other Co",
      "Third Co",
    ]);
  });

  test("keeps a call no answer places as a locked section, and a part `\\rtlocked` cannot take in the section before", async () => {
    const body = BODY.replace(
      "\\vspace{2pt}",
      "\\cvunknown{Invented aside}\n\n\\newcommand{\\cvx}{x}\\verb|Invented|",
    );
    const result = ok((await assembled({ body, commands: { cvunknown: "m" } })).result);
    const kinds = result.document.resume.sections.map((section) => section.kind);
    expect(kinds).toEqual(["entries", "list", "paragraph"]);
    const skills = sectionOf(result, 1);
    expect(skills.extras?.after).toContain("\\verb|Invented|");
    expect(skills.extras?.after).toContain("\\cvunknown{Invented aside}");
    // Before any section, there is nowhere to keep it.
    const before = await assembled({
      body: BODY.replace("\\cvheader\n", "\\cvheader\n\\verb|x|\n"),
    });
    expect(isRefusal(before.result) && (before.result as Refusal).reason).toBe("keep");
  });

  test("keeps the closer of a list a section's head opens with the section, which goes as one", async () => {
    // A skills section whose items stand between the entries' opener and closer, as many forks of
    // Jake's Resume write theirs: the opener stands between the head and the items, so the section
    // keeps it (`before`), and its closer must go with it too, or removing the section leaves the
    // closer behind and stops the compile (decision 0026's consequence, decision 0038).
    const body = BODY.replace(
      "\\begin{itemize}\n  \\item Invented skill\n  \\item Another skill\n\\end{itemize}",
      "\\cvlistStart\n  \\cvitem{Invented skill}\n  \\cvitem{Another skill}\n\\cvlistEnd",
    );
    const result = ok((await assembled({ body })).result);
    const skills = sectionOf(result, 1);
    expect(skills.kind).toBe("list");
    expect(skills.extras?.before).toContain("\\cvlistStart");
    expect(skills.extras?.after).toBe("\n\\cvlistEnd");
    // What stands after the closer is a locked part of its own, as before.
    const locked = sectionOf(result, 2);
    expect(locked.kind === "locked" && locked.latex).toBe("\n\n\\vspace{2pt}%");
    const count = (latex: string, name: string) => latex.split(name).length - 1;
    const balanced = (resume: Resume) => {
      const { latex } = generateBody(result.package, resume, {});
      return count(latex, "\\cvlistStart") === count(latex, "\\cvlistEnd");
    };
    expect(balanced(result.document.resume)).toBe(true);
    // Removed, the section takes its closer with it; moved, the closer moves with it.
    const removed = apply(result.document, {
      type: "structure",
      op: { op: "removeSection", id: skills.id },
    });
    expect(balanced(removed.resume)).toBe(true);
    const moved = apply(result.document, {
      type: "structure",
      op: { op: "moveSection", id: skills.id, to: 3 },
    });
    expect(balanced(moved.resume)).toBe(true);
    const { latex } = generateBody(result.package, moved.resume, {});
    expect(latex.indexOf("\\cvlistEnd", latex.indexOf("Invented skill"))).toBeGreaterThan(
      latex.indexOf("Invented words of an invented summary"),
    );
  });

  test("runs the last section to the closer of the list it opens, which the document snippet then lacks", async () => {
    // The skills last, their items between the entries' opener and closer: the closer comes after
    // the last section, where the template's own code around the sections was read to begin, so
    // the document snippet kept it, and removing the section left it behind (decision 0038).
    const last = String.raw`\begin{document}
\cvheader

\section{Invented experience}
\cvlistStart
  \cventry{Invented role}{Jan 2020 -- Present}{Quill Co}{Harbour City}
\cvlistEnd

\section{Invented skills}
\cvlistStart
  \cvitem{Invented skill}
  \cvitem{Another skill}
\cvlistEnd
\end{document}
`;
    const skills = ok((await assembled({ body: last })).result);
    const section = skills.document.resume.sections.at(-1);
    expect(section?.kind).toBe("list");
    expect(section?.extras?.after).toBe("\n\\cvlistEnd");
    expect(skills.package.snippets.document).not.toContain("\\cvlistEnd");
    const count = (latex: string, name: string) => latex.split(name).length - 1;
    const balanced = (result: Assembled, resume: Resume) => {
      const { latex } = generateBody(result.package, resume, {});
      return count(latex, "\\cvlistStart") === count(latex, "\\cvlistEnd");
    };
    const without = (result: Assembled, id: string) =>
      apply(result.document, { type: "structure", op: { op: "removeSection", id } }).resume;
    expect(balanced(skills, without(skills, section?.id ?? ""))).toBe(true);

    // Entries last, the opener theirs: their list is whole in the section, closer and all.
    const entriesLast = String.raw`\begin{document}
\cvheader

\section{Invented skills}
\begin{itemize}
  \item Invented skill
\end{itemize}

\section{Invented experience}
\cvlistStart
  \cventry{Invented role}{Jan 2020 -- Present}{Quill Co}{Harbour City}
\cvlistEnd
\end{document}
`;
    const entries = ok((await assembled({ body: entriesLast })).result);
    const work = entries.document.resume.sections.at(-1);
    expect(work?.kind).toBe("entries");
    expect(work?.extras?.before ?? "").not.toContain("\\cvlistStart");
    expect(entries.package.snippets.document).not.toContain("\\cvlistEnd");
    expect(balanced(entries, without(entries, work?.id ?? ""))).toBe(true);

    // A last locked part that opens the list keeps its closer too.
    const lockedLast = BODY.replace(
      "\\end{document}",
      "\n\\cvlistStart\n  \\cvunknown{Invented aside}\n\\cvlistEnd\n\\end{document}",
    );
    const locked = ok((await assembled({ body: lockedLast, commands: { cvunknown: "m" } })).result);
    const part = locked.document.resume.sections.at(-1);
    expect(part?.kind === "locked" && part.latex).toContain("\\cvlistEnd");
    expect(locked.package.snippets.document).not.toContain("\\cvlistEnd");
    expect(balanced(locked, without(locked, part?.id ?? ""))).toBe(true);
  });

  test("assembles again with what the checks decide", async () => {
    const decisions: Decisions = {
      instances: {
        [`b${BODY.indexOf("Quill Co") - "\\begin{document}".length}.subtitle`]: "differs",
      },
      slots: { "command|cvitem|1": "text" },
      controls: ["margins"],
    };
    const result = ok((await assembled({ decisions })).result);
    const work = sectionOf(result, 0);
    if (work.kind !== "entries") throw new Error("entries");
    expect(work.entries[0]?.subtitle).toBeUndefined();
    expect(work.entries[0]?.extras?.subtitle).toBe("Quill Co");
    // Bullets whose text is locked everywhere hold nothing a model's bullet can: their list is
    // kept whole in the entry's extras, and a new bullet takes the generic snippet.
    expect(work.entries[0]?.bullets).toEqual([]);
    expect(work.entries[0]?.extras?.bullets).toContain("\\cvitem{Invented first bullet}");
    expect(result.package.snippets.bullet).toBe("\\item {{text}}");
    expect(result.package.controls.margins).toBeUndefined();
    expect(result.checks.decisions.controls).toEqual(["margins"]);
  });

  test("carries a reviewed answer's redefinitions after the class, and drops those a check refused", async () => {
    const answers: AnswerRow[] = ANSWERS.map(
      ([of, name, answer]): AnswerRow =>
        name === "cvitem"
          ? [
              of,
              name,
              {
                ...answer,
                reviewed: true,
                redefinitions: [{ name: "cvitem", latex: "\\renewcommand{\\cvitem}[1]{#1}" }],
              },
            ]
          : [of, name, answer],
    );
    const withIt = ok((await assembled({ answers })).result);
    expect(withIt.package.preamble).toContain(
      "\\documentclass[{{fontSize}}pt,letterpaper]{inventedcv}\n\\renewcommand{\\cvitem}[1]{#1}",
    );
    expect(withIt.checks.redefinitions.applied).toEqual(["cvitem"]);
    const without = ok((await assembled({ answers, decisions: { dropped: ["cvitem"] } })).result);
    expect(without.package.preamble).not.toContain("\\renewcommand{\\cvitem}");
    expect(without.package.id).not.toBe(withIt.package.id);
    // Where a compile after the class stops, the checks put them at the preamble's end instead,
    // right before `\begin{document}` (decision 0024).
    const late = ok((await assembled({ answers, decisions: { placement: "preamble" } })).result);
    expect(late.package.preamble).toContain(
      "\\usepackage[margin=0.5in]{geometry}\n\\renewcommand{\\cvitem}[1]{#1}\n",
    );
    expect(late.package.preamble).not.toContain("{inventedcv}\n\\renewcommand");
    expect(late.checks.redefinitions).toEqual({
      applied: ["cvitem"],
      dropped: [],
      placement: "preamble",
    });
  });

  test("reads a name given whole as the first name and the last, where its answer's parts say so", async () => {
    // AltaCV's `\name` as the seed answers it: one argument, the first name and the last a space
    // apart (decision 0024).
    const answers: AnswerRow[] = ANSWERS.map(
      ([of, name, answer]): AnswerRow =>
        name === "cvname"
          ? [
              of,
              name,
              {
                ...answer,
                arguments: [
                  {
                    index: 1,
                    meaning: "title",
                    parts: [
                      { meaning: "title", slot: "first" },
                      { meaning: "title", slot: "last" },
                    ],
                  },
                ],
              },
            ]
          : [of, name, answer],
    );
    const result = ok((await assembled({ answers })).result);
    expect(result.document.resume.header.name).toEqual({ first: "Quill", last: "Invented" });
    expect(result.package.snippets.header).toContain("{{first}}{{#last}} {{last}}{{/last}}");
    const names = result.checks.all.filter((field) => field.slot === "command|cvname|1");
    expect(names.map((field) => field.field)).toEqual(["header.first", "header.last"]);
    // The same as the answer that names the first name alone, which the split fills the last of.
    const plain = ok((await assembled()).result);
    expect(result.document).toEqual(plain.document);
    expect(result.package.snippets.header).toBe(plain.package.snippets.header);
  });

  test("takes a closer's kind from its opener's, whatever kind its own answer gives", async () => {
    const answers: AnswerRow[] = ANSWERS.map(
      ([of, name, answer]): AnswerRow =>
        name === "cvitemsEnd" ? [of, name, { ...answer, kind: "layout" }] : [of, name, answer],
    );
    expect(answersOf(answerOf(answers)).get("command|cvitemsEnd")?.kind).toBe("bulletList");
    // A closer whose own answer says nothing of the list is its opener's too, by the opener's word.
    const unlisted = answers.map(
      ([of, name, answer]): AnswerRow =>
        name === "cvitemsEnd"
          ? [of, name, { kind: "layout", arguments: [], repeatable: false }]
          : [of, name, answer],
    );
    expect(answersOf(answerOf(unlisted)).get("command|cvitemsEnd")?.kind).toBe("bulletList");
    const result = ok((await assembled({ answers })).result);
    const plain = ok((await assembled()).result);
    expect(result.document).toEqual(plain.document);
    expect(result.package).toEqual(plain.package);
  });

  test("locks a standard list's labels with its items, under the list's name", async () => {
    const body = BODY.replace(
      "\\begin{itemize}\n  \\item Invented skill\n  \\item Another skill\n\\end{itemize}",
      "\\begin{description}\n  \\item[Languages] Invented skill\n  \\item[Tools] Another skill\n\\end{description}",
    );
    const plain = ok((await assembled({ body })).result);
    const skills = sectionOf(plain, 1);
    expect(skills.kind === "labelled" && skills.items.map((item) => item.label)).toEqual([
      "Languages",
      "Tools",
    ]);
    const label = plain.checks.all.find((field) => field.slot === "standard|label|skills");
    const text = plain.checks.all.find((field) => field.slot === "standard|item|skills");
    expect(label?.list).toMatch(/^b\d+\.items$/);
    expect(label?.list).toBe(text?.list);
    const locked = ok(
      (await assembled({ body, decisions: { instances: { [label?.list ?? ""]: "fields" } } }))
        .result,
    );
    const kept = sectionOf(locked, 1);
    expect(kept.kind === "labelled" && kept.items).toEqual([]);
    expect(kept.extras?.items).toContain("\\item[Tools] Another skill");
  });

  test("reads a list of bullets a section holds alone, between the answer's opener and closer", async () => {
    const body = BODY.replace(
      "\\begin{itemize}\n  \\item Invented skill\n  \\item Another skill\n\\end{itemize}",
      "\\cvitemsStart\n  \\cvitem{Invented skill}\n  \\cvitem{Another skill}\n\\cvitemsEnd",
    );
    const result = ok((await assembled({ body })).result);
    const skills = sectionOf(result, 1);
    expect(skills.kind === "list" && skills.items.map((item) => item.text)).toEqual([
      [{ text: "Invented skill" }],
      [{ text: "Another skill" }],
    ]);
    const { snippets } = result.package;
    expect(typeof snippets.item === "string" ? snippets.item : snippets.item.skills).toBe(
      "\\cvitem{{{text}}}",
    );
    const list =
      typeof snippets.section.list === "string"
        ? snippets.section.list
        : snippets.section.list.default;
    expect(list).toContain("{{#items}}\\cvitemsStart\n{{items}}\n\\cvitemsEnd{{/items}}");
    expect(result.document.resume.sections.map((section) => section.kind)).toEqual([
      "entries",
      "list",
      "locked",
      "paragraph",
    ]);
  });

  test("closes a list at its own closer, past a nested list of the same macros", async () => {
    const body = BODY.replace(
      "      \\cvitem{Invented \\textbf{second} bullet}\n",
      "      \\cvitem{Invented \\textbf{second} bullet}\n      \\cvitemsStart\n        \\cvitem{Invented nested bullet}\n      \\cvitemsEnd\n",
    );
    const result = ok((await assembled({ body })).result);
    const work = sectionOf(result, 0);
    if (work.kind !== "entries") throw new Error("entries");
    // The nested list is no bullet: the entry keeps its whole list, to its own closer.
    expect(work.entries).toHaveLength(3);
    expect(work.entries[0]?.bullets).toEqual([]);
    const kept = String(work.entries[0]?.extras?.bullets ?? "");
    expect(kept.match(/\\cvitemsEnd/g)).toHaveLength(2);
    expect(work.entries[1]?.title).toBe("Second role");
  });

  test("gives the preamble's header calls, which a compile of the original issues", async () => {
    const { taken } = await assembled();
    const signatures = signaturesOf(COMMANDS, {}, MEANINGS);
    expect(takenOut(taken, signatures, answerOf(ANSWERS))).toEqual(["\\cvname{Quill Invented}"]);
  });
});

describe("a template of environments, with its header in the body", () => {
  test("sets the header's calls where they stand, its links a run of their kinds' snippets", async () => {
    const result = ok((await assembleInvented(ENVIRONMENTS)).result);
    const { snippets } = result.package;
    expect(snippets.document).toBe(
      "\\begin{document}\n{{header}}\n\\makecvhead\n\n{{sections}}\n\\end{document}",
    );
    expect(snippets.header).toBe(
      "\\cvname{{{first}}{{&x.c1-first}}}{{{last}}{{&x.c1-last}}}\n\\cvmail{{{email}}{{&x.c2-email}}}\n{{links}}{{&x.links}}",
    );
    // A link of another kind goes through the template's macro that takes any address.
    expect(snippets.link).toEqual({
      other: "\\cvweb{{{&href}}}{{{label}}}",
      github: "\\cvgit{{{label}}}",
      website: "\\cvweb{{{&href}}}{{{label}}}",
    });
    expect(snippets.separators.links).toBe("\n");
    const { header } = result.document.resume;
    expect(header.name).toEqual({ first: "Quill", last: "Invented" });
    expect(header.email).toBe("quill@example.invalid");
    expect(header.links.map(({ kind, label, href }) => ({ kind, label, href }))).toEqual([
      { kind: "github", label: "quill-invented", href: "" },
      { kind: "website", label: "quill.example", href: "https://quill.example" },
    ]);
    expect(header.extras).toBeUndefined();
  });

  test("reads entries in an environment, their bullets in an argument, and labelled items", async () => {
    const result = ok((await assembleInvented(ENVIRONMENTS)).result);
    const { snippets } = result.package;
    const entry = typeof snippets.entry === "string" ? snippets.entry : snippets.entry.default;
    expect(entry).toBe(
      "\\cvrow{{{title}}{{&x.title}}}{{{subtitle}}{{&x.subtitle}}}{{{place}}{{&x.place}}}{{{dates}}{{&x.dates}}}{{{#bullets}}\n\\begin{cvpoints}\n{{bullets}}\n\\end{cvpoints}\n{{/bullets}}{{&x.bullets}}}",
    );
    const bullet = typeof snippets.bullet === "string" ? snippets.bullet : snippets.bullet.default;
    expect(bullet).toBe("\\item {{text}}");
    const labelled =
      typeof snippets.labelledItem === "string"
        ? snippets.labelledItem
        : snippets.labelledItem.skills;
    expect(labelled).toBe("\\cvskill{{{label}}}{{{text}}}");
    const [work, skills] = result.document.resume.sections;
    if (work?.kind !== "entries" || skills?.kind !== "labelled") throw new Error("the sections");
    expect(work.entries.map((each) => each.bullets.length)).toEqual([2, 0]);
    // The second entry's empty bullets' argument is kept as it stands, spaces and all.
    expect(work.entries[1]?.extras).toBeUndefined();
    expect(work.entries[1]?.dates).toEqual({ start: "2019" });
    expect(skills.items).toEqual([
      expect.objectContaining({ label: "Languages", text: [{ text: "Invented, Words" }] }),
      expect.objectContaining({
        label: "Tools",
        text: [{ text: "Other " }, { text: "words", italic: true }],
      }),
    ]);
  });

  test("sets a contact whose address is built from its text raw, so the panel still edits it", async () => {
    const result = ok(
      (await assembleInvented({ ...ENVIRONMENTS, verdicts: { "cvmail#1": ["twice"] } })).result,
    );
    expect(result.package.snippets.header).toContain("\\cvmail{{{&email}}{{&x.c2-email}}}");
    expect(result.document.resume.header.email).toBe("quill@example.invalid");
    const email = result.checks.all.find((field) => field.field === "header.email");
    expect(email).toMatchObject({ mode: "raw" });
    expect(result.checks.fields.raw).toBe(1);
  });

  test("gives a link whose answer names no kind the kind its address gives", async () => {
    const answers = ENVIRONMENTS.answers.map(([of, name, answer]): AnswerRow => {
      if (name !== "cvweb" || answer.kind !== "link") return [of, name, answer];
      const { link: _, ...rest } = answer;
      return [of, name, rest];
    });
    const source = ENVIRONMENTS.source.replace(
      "\\cvweb{https://quill.example}{quill.example}",
      "\\cvweb{https://quill.example}{quill.example}\n\\cvweb{https://www.linkedin.com/in/quill-invented}{quill-invented}",
    );
    const result = ok((await assembleInvented({ ...ENVIRONMENTS, source, answers })).result);
    expect(result.document.resume.header.links.map((link) => link.kind)).toEqual([
      "github",
      "website",
      "linkedin",
    ]);
    expect(kindOfAddress("https://orcid.org/0000-0000")).toBe("orcid");
    expect(kindOfAddress("mailto:quill@example.invalid")).toBe("other");
    expect(kindOfAddress("https://notgithub.com/quill")).toBe("website");
  });

  test("keeps the links whole in the header's extras when a check locks one", async () => {
    const result = ok(
      (await assembleInvented({ ...ENVIRONMENTS, decisions: { instances: { [LINKS]: "fields" } } }))
        .result,
    );
    const { header } = result.document.resume;
    expect(header.links).toEqual([]);
    expect(Object.values(header.extras ?? {})).toContain(
      "\\cvgit{quill-invented}\n\\cvweb{https://quill.example}{quill.example}",
    );
    expect(result.package.snippets.header).not.toContain("{{links}}");
  });

  test("keeps the labelled items whole in their section's extras when a check locks a label", async () => {
    const plain = ok((await assembleInvented(ENVIRONMENTS)).result);
    const label = plain.checks.all.find((field) => field.slot === "command|cvskill|1");
    expect(label?.lockable).toBe(false);
    expect(label?.list).toMatch(/^b\d+\.items$/);
    const locked = ok(
      (
        await assembleInvented({
          ...ENVIRONMENTS,
          decisions: { instances: { [label?.list ?? ""]: "alignment" } },
        })
      ).result,
    );
    const skills = locked.document.resume.sections[1];
    if (skills?.kind !== "labelled") throw new Error("the skills");
    expect(skills.items).toEqual([]);
    expect(skills.extras?.items).toContain("\\cvskill{Languages}{Invented, Words}");
    expect(locked.extras).toContainEqual(
      expect.objectContaining({ kind: "list", key: "items", reason: "alignment" }),
    );
  });
});

describe("the assembly's work", () => {
  test("grows with the body", async () => {
    const entries = (count: number) =>
      Array.from(
        { length: count },
        (_, i) =>
          `  \\cventry{Invented role ${i}}{Jan 2020 -- Present}{Quill Co ${i}}{Harbour City}\n    \\cvitemsStart\n      \\cvitem{Invented bullet ${i}}\n      \\cvitem{Another bullet ${i}}\n    \\cvitemsEnd\n`,
      ).join("");
    const run = (count: number) => {
      const source = `${PREAMBLE}\\begin{document}\n\\cvheader\n\n\\section{Invented experience}\n\\cvlistStart\n${entries(count)}\\cvlistEnd\n\\end{document}\n`;
      const inputs = inputsOf({ ...JAKE_LIKE, source });
      return () =>
        assemble(
          inputs.intake,
          REFERENCE,
          inputs.tree,
          inputs.signatures,
          inputs.probe,
          inputs.answer,
        );
    };
    const small = run(40);
    const large = run(400);
    const [tenth = 0, whole = 0] = await fastestAsync([small, large], 3);
    // Ten times the entries costs about ten times as much.
    expect(whole).toBeLessThan(bound(20, tenth));
  }, 60_000);
});

/** The answers with one macro's answer changed. */
const answering = (
  answers: readonly AnswerRow[],
  name: string,
  change: (answer: AnswerRow[2]) => AnswerRow[2],
): AnswerRow[] =>
  answers.map(
    ([of, each, answer]): AnswerRow => [of, each, each === name ? change(answer) : answer],
  );

/** A section's entries, or a failure where it holds none. */
function entriesOf(result: Assembled, at: number): Entry[] {
  const section = sectionOf(result, at);
  if (section.kind !== "entries") throw new Error(`section ${at} holds no entries`);
  return section.entries;
}

/** The snippet a package gives a role's entries. */
const entrySnippet = (pkg: TemplatePackage, role: Section["role"]) =>
  forRole(pkg.snippets.entry, role);

/** A body of one section of Jake-like entries, invented, with the calls given. */
const entriesBody = (calls: string) =>
  `\\begin{document}\n\\cvheader\n\n\\section{Invented experience}\n\\cvlistStart\n${calls}\\cvlistEnd\n\\end{document}\n`;

describe("a locked instance is kept, not editable (decision 0026)", () => {
  test("names the slot kept, so that a date typed into it anyway sets the kept one alone", async () => {
    const result = ok((await assembled()).result);
    const third = entriesOf(result, 0)[2];
    if (third === undefined) throw new Error("three entries");
    expect(third.kept).toEqual(["dates"]);
    expect(third.extras?.dates).toBe("Summer 2017");
    // Only the locked entry keeps the slot; the others are editable as they were.
    expect(entriesOf(result, 0).map((entry) => entry.kept)).toEqual([
      undefined,
      undefined,
      ["dates"],
    ]);
    const typed: Resume = structuredClone(result.document.resume);
    const work = typed.sections[0];
    if (work?.kind !== "entries" || work.entries[2] === undefined) throw new Error("entries");
    work.entries[2].dates = { start: "2017-06" };
    const { latex, texts } = generateBody(result.package, typed, {});
    expect(latex.match(/Summer 2017/g)).toHaveLength(1);
    expect(latex).not.toContain("Jun 2017");
    expect(texts.has(`${third.id}.dates`)).toBe(false);
  });

  test("keeps a name given whole with both its parts, and a list kept whole", async () => {
    const result = ok(
      (
        await assembled({
          verdicts: { "cvname#1": ["moved"], "cvitem#1": ["moved", "editable"] },
        })
      ).result,
    );
    const { header } = result.document.resume;
    expect(header.kept).toEqual(["first", "last"]);
    expect(header.name).toEqual({ first: "", last: "" });
    const typed: Resume = structuredClone(result.document.resume);
    typed.header.name = { first: "Typedfirst", last: "Typedlast" };
    const { latex } = generateBody(result.package, typed, {});
    expect(latex).toContain("\\cvname{Quill Invented}");
    expect(latex).not.toContain("Typed");
    // The entry whose bullets are kept whole keeps its list, which a bullet added is not set in.
    const [first] = entriesOf(result, 0);
    expect(first?.kept).toEqual(["bullets"]);
  });
});

describe("the body's text never reaches a snippet (decision 0026)", () => {
  /** The Jake-like template with an entry's fifth argument, which the answer gives no slot. */
  const noted = (note: string, blank?: "empty" | "absent") =>
    assembled({
      body: entriesBody(
        `  \\cventry{Invented role}{Jan 2020 -- Present}{Quill Co}{Harbour City}{${note}}\n`,
      ),
      commands: { cventry: "m m m m m" },
      answers: answering(ANSWERS, "cventry", (answer) => ({
        ...answer,
        arguments: [
          ...answer.arguments,
          { index: 5, meaning: "text", ...(blank === undefined ? {} : { blank }) },
        ],
      })),
    });

  test("keeps an argument with no slot in each entry's extras, locked and counted, called once", async () => {
    const result = ok((await noted("Invented private note")).result);
    const snippet = entrySnippet(result.package, "experience");
    expect(snippet).toContain("{{&x.a5}}");
    expect(JSON.stringify(result.package)).not.toContain("private");
    const [entry] = entriesOf(result, 0);
    expect(entry?.extras?.a5).toBe("{Invented private note}");
    expect(result.extras).toContainEqual(
      expect.objectContaining({ node: entry?.id, key: "a5", reason: "unmapped", words: 3 }),
    );
    // An entry the editor adds writes the answer's blank for it, an empty group where it says none.
    expect(result.package.snippets.defaults?.entry?.default).toEqual({ a5: "{}" });
    const added = apply(result.document, {
      type: "structure",
      op: { op: "addEntry", section: sectionOf(result, 0).id },
    });
    const { latex } = generateBody(result.package, added.resume, {});
    expect(latex.match(/Invented private note/g)).toHaveLength(1);
    expect(latex).toMatch(/\{\\rtfield\{ent-[a-z0-9]{6}\.place\}\{Place\}\}\{\}/);
    // Two uploads of one template whose notes differ share a package.
    const other = ok((await noted("Another invented note, longer")).result);
    expect(other.package.id).toBe(result.package.id);
    // The answer's blank is read: left out, nothing.
    const absent = ok((await noted("Invented private note", "absent")).result);
    expect(absent.package.snippets.defaults?.entry?.default).toEqual({ a5: "" });
  });

  test("keeps the template's own an argument no call gives, as the seed's \\cvhonor #5-6", async () => {
    const result = ok(
      (
        await assembled({
          body: entriesBody(
            "  \\cventry{Invented role}{2020}{Quill Co}{Harbour City}\n  \\cventry{Second role}{2019}{Other Co}{Harbour City}\n",
          ),
          commands: { cventry: "m m m m s o" },
          answers: answering(ANSWERS, "cventry", (answer) => ({
            ...answer,
            arguments: [
              ...answer.arguments,
              { index: 5, meaning: "other", blank: "absent" },
              { index: 6, meaning: "other", blank: "absent" },
            ],
          })),
        })
      ).result,
    );
    expect(entrySnippet(result.package, "experience")).not.toContain("x.a5");
    expect(entrySnippet(result.package, "experience")).not.toContain("x.a6");
    expect(entriesOf(result, 0).map((entry) => entry.extras)).toEqual([undefined, undefined]);
    expect(result.extras.some((part) => part.key === "a5" || part.key === "a6")).toBe(false);
  });

  test("keeps a layout call that shows words as a locked section, and one that shows none as code", async () => {
    const banner = (argument: string) =>
      assembled({
        body: BODY.replace("\\cvheader\n", `\\cvheader\n\\cvbanner{${argument}}\n`),
        commands: { cvbanner: "m" },
        answers: [
          ...ANSWERS,
          [
            "command",
            "cvbanner",
            { kind: "layout", arguments: [{ index: 1, meaning: "other" }], repeatable: false },
          ],
        ],
      });
    const words = ok((await banner("Invented private banner words")).result);
    expect(words.package.snippets.document).not.toContain("banner words");
    const [locked] = words.document.resume.sections;
    expect(locked?.kind === "locked" && locked.latex).toContain("Invented private banner words");
    expect(words.extras).toContainEqual(
      expect.objectContaining({ node: locked?.id, kind: "section", reason: "unmapped", words: 4 }),
    );
    const code = ok((await banner("2pt")).result);
    expect(code.package.snippets.document).toContain("\\cvbanner{2pt}");
    expect(code.document.resume.sections[0]?.kind).toBe("entries");
  });
});

describe("every entry's snippet sets the bullets a user adds (decision 0026)", () => {
  const educationFirst = entriesBody(
    ["  \\cventry{Invented University}{2014 -- 2018}{Invented degree}{Harbour City}\n"].join(""),
  )
    .replace(
      "\\end{document}",
      "\n\\section{Invented work}\n\\cvlistStart\n  \\cventry{Invented role}{Jan 2020 -- Present}{Quill Co}{Harbour City}\n    \\cvitemsStart\n      \\cvitem{Invented first bullet}\n    \\cvitemsEnd\n\\cvlistEnd\n\\end{document}",
    )
    .replace("Invented experience", "Education");

  test("takes the list another role's entries of the same macro set theirs in", async () => {
    const result = ok((await assembled({ body: educationFirst })).result);
    const { snippets } = result.package;
    const education = entrySnippet(result.package, "education");
    const work = entrySnippet(result.package, "experience");
    expect(education).toContain(
      "{{#bullets}}\n\\cvitemsStart\n{{bullets}}\n\\cvitemsEnd{{/bullets}}",
    );
    expect(education).toBe(work);
    expect(forRole(snippets.bullet, "education")).toBe("\\cvitem{{{text}}}");
    expect(snippets.entryBullets).toBeUndefined();
    // A bullet added to the education's entry is on the page.
    const [entry] = entriesOf(result, 0);
    const added = apply(result.document, {
      type: "structure",
      op: { op: "addBullet", entry: entry?.id ?? "" },
    });
    const bullet = added.resume.sections[0];
    const id = bullet?.kind === "entries" ? bullet.entries[0]?.bullets[0]?.id : undefined;
    expect(generateBody(result.package, added.resume, {}).latex).toContain(`\\rtfield{${id}.text}`);
  });

  test("takes the list the answer pairs where no entry of the macro sets bullets", async () => {
    const body = entriesBody("  \\cventry{Invented role}{2020}{Quill Co}{Harbour City}\n").replace(
      "\\end{document}",
      "\n\\section{Invented notes}\n\\cvitemsStart\n  \\cvitem{Invented note}\n\\cvitemsEnd\n\\end{document}",
    );
    const result = ok((await assembled({ body })).result);
    expect(entrySnippet(result.package, "experience")).toContain(
      "{{#bullets}}\n\\cvitemsStart\n{{bullets}}\n\\cvitemsEnd{{/bullets}}{{&x.bullets}}",
    );
    expect(result.package.snippets.entryBullets).toBeUndefined();
  });

  test("says a role's entries take no bullets where no list is set or paired anywhere", async () => {
    const answers = ANSWERS.filter(([, name]) => !name.startsWith("cvitem"));
    const result = ok(
      (
        await assembled({
          body: entriesBody("  \\cventry{Invented role}{2020}{Quill Co}{Harbour City}\n"),
          answers,
        })
      ).result,
    );
    const snippet = entrySnippet(result.package, "experience");
    expect(
      parseSnippet(snippet).some((node) => node.kind === "slot" && node.name === "bullets"),
    ).toBe(false);
    expect(snippet).not.toContain("{{bullets}}");
    expect(result.package.snippets.entryBullets).toBe(false);
  });
});

describe("what the assembly counts and says (decision 0026)", () => {
  test("rolls a links' run kept whole out of the fields, for the reason the checks decided", async () => {
    const plain = ok((await assembleInvented(ENVIRONMENTS)).result);
    const locked = ok(
      (
        await assembleInvented({
          ...ENVIRONMENTS,
          decisions: { instances: { [LINKS]: "differs" } },
        })
      ).result,
    );
    expect(plain.checks.all.filter((field) => field.field.startsWith("lnk-"))).toHaveLength(2);
    expect(locked.checks.all.some((field) => field.field.startsWith("lnk-"))).toBe(false);
    expect(locked.checks.fields.editable).toBe(plain.checks.fields.editable - 2);
    expect(locked.checks.words.editable).toBe(plain.checks.words.editable - 4);
    expect(locked.extras.filter((part) => part.node === "header")).toEqual([
      expect.objectContaining({ kind: "header", reason: "differs", words: 7 }),
    ]);
    expect(locked.document.resume.header.kept).toEqual(["links"]);
  });

  test("counts what the header keeps: an argument with no slot, and a second value for one", async () => {
    const preamble = PREAMBLE.replace(
      "\\cvname{Quill Invented}",
      "\\cvname{Quill Invented}\n\\cvquote{Invented words of an invented quote}",
    );
    const result = ok(
      (
        await assembleInvented({
          ...JAKE_LIKE,
          source: `${preamble}${BODY}`,
          commands: { ...JAKE_LIKE.commands, cvquote: "m" },
          meanings: { ...MEANINGS, cvquote: "\\long macro:#1->\\def \\cv@quote {#1}" },
          answers: [
            ...ANSWERS,
            [
              "command",
              "cvquote",
              { kind: "other", arguments: [{ index: 1, meaning: "text" }], repeatable: false },
            ],
          ],
        })
      ).result,
    );
    // Stored by the preamble, so taken out and issued again from the header's snippet.
    expect(result.package.snippets.header).toContain("\\cvquote{{&x.c2-a1}}");
    expect(result.document.resume.header.extras?.["c2-a1"]).toBe(
      "{Invented words of an invented quote}",
    );
    expect(result.extras).toContainEqual(
      expect.objectContaining({ node: "header", key: "c2-a1", reason: "unmapped", words: 6 }),
    );
    // A second email, where the first fills the header's.
    const twice = ok(
      (
        await assembleInvented({
          ...ENVIRONMENTS,
          source: ENVIRONMENTS.source.replace(
            "\\cvmail{quill@example.invalid}",
            "\\cvmail{quill@example.invalid}\n\\cvmail{second@example.invalid}",
          ),
        })
      ).result,
    );
    expect(twice.document.resume.header.email).toBe("quill@example.invalid");
    expect(twice.document.resume.header.extras?.["c3-a1"]).toBe("{second@example.invalid}");
    expect(twice.extras).toContainEqual(
      expect.objectContaining({ node: "header", key: "c3-a1", reason: "unmapped", words: 3 }),
    );
  });

  test("counts an entry's bullets that are not a clean list, kept as the upload had them", async () => {
    const source = ENVIRONMENTS.source.replace(
      /\\cvrow\{Invented role\}[\s\S]*?\\cvrow\{Second role\}\{Other Co\}\{\}\{2019\}\{\}\n/,
      "\\cvrow{Invented role}{Quill Co}{Harbour City}{Jan 2020 -- Present}{Invented plain words, no list}\n",
    );
    const result = ok((await assembleInvented({ ...ENVIRONMENTS, source })).result);
    const [entry] = entriesOf(result, 0);
    expect(entry?.bullets).toEqual([]);
    expect(entry?.extras?.bullets).toBe("Invented plain words, no list");
    expect(entry?.kept).toEqual(["bullets"]);
    expect(result.extras).toContainEqual(
      expect.objectContaining({
        node: entry?.id,
        key: "bullets",
        kind: "list",
        reason: "unmapped",
        words: 5,
      }),
    );
    // A new entry takes the list the answer pairs, inside the argument.
    expect(entrySnippet(result.package, "experience")).toContain(
      "{{{#bullets}}\n\\begin{cvpoints}\n{{bullets}}\n\\end{cvpoints}{{/bullets}}{{&x.bullets}}}",
    );
  });

  test("marks the slots the checks found required in the package, by the snippet that sets them", async () => {
    const plain = ok((await assembleInvented(ENVIRONMENTS)).result);
    expect(plain.package.required).toBeUndefined();
    const required = ok(
      (
        await assembleInvented({
          ...ENVIRONMENTS,
          decisions: { required: ["command|cvname|1", "command|cvsection|1", "command|cvrow|4"] },
        })
      ).result,
    );
    expect(required.package.required).toEqual({
      header: ["first"],
      section: ["title"],
      entry: ["dates"],
    });
    expect(required.package.id).not.toBe(plain.package.id);
  });

  test("names the package's source for the template, never for the upload's main file", async () => {
    const idFor = async (main: string) => {
      const taken = intake({
        name: "invented.zip",
        bytes: zipSync({
          [main]: strToU8(JAKE_LIKE.source),
          "inventedcv.cls": strToU8(CLASS),
        }),
      });
      if (isRefusal(taken)) throw new Error(taken.message);
      const found = signaturesOf(JAKE_LIKE.commands, {}, MEANINGS);
      const tree = treeOf(taken, found);
      const probed = probeOf(taken, tree, found);
      return ok(await assemble(taken, REFERENCE, tree, found, probed, answerOf(ANSWERS))).package;
    };
    const one = await idFor("cv.tex");
    const two = await idFor("quill-invented-cv.tex");
    expect(two.id).toBe(one.id);
    expect(two.source.url).toBe(MAIN_FILE);
  });

  test("offers the font sizes the class declares, and no control where it declares none", async () => {
    const withSizes = (sizes: readonly string[]) =>
      assembled({ commands: Object.fromEntries(sizes.map((name) => [name, ""])) });
    const article = ok((await assembled()).result).package;
    expect(article.controls.fontSize?.sizes).toEqual([10, 11, 12]);
    const ext = ok((await withSizes(["ds@9pt", "ds@14pt"])).result).package;
    expect(ext.controls.fontSize?.sizes).toEqual([9, 10, 11, 12]);
    // A class that declares none, or not the document's size, offers none, and keeps its option.
    const none = await assembleInvented({
      ...JAKE_LIKE,
      commands: COMMANDS,
    });
    const bare = ok(none.result).package;
    expect(bare.controls.fontSize).toBeUndefined();
    expect(bare.preamble).toContain("\\documentclass[11pt,letterpaper]{inventedcv}");
    const other = await assembleInvented({
      ...JAKE_LIKE,
      commands: { ...COMMANDS, "ds@10pt": "", "ds@12pt": "" },
    });
    expect(ok(other.result).package.controls.fontSize).toBeUndefined();
    // A class that declares the document's size alone leaves nothing to choose, and offers none.
    const single = await assembleInvented({
      ...JAKE_LIKE,
      commands: { ...COMMANDS, "ds@11pt": "" },
    });
    expect(ok(single.result).package.controls.fontSize).toBeUndefined();
    expect(SIZE_OPTIONS).toEqual([
      "ds@8pt",
      "ds@8.5pt",
      "ds@9pt",
      "ds@9.5pt",
      "ds@10pt",
      "ds@10.5pt",
      "ds@11pt",
      "ds@11.5pt",
      "ds@12pt",
      "ds@12.5pt",
      "ds@13pt",
      "ds@13.5pt",
      "ds@14pt",
    ]);
    expect(ARTICLE_SIZES).toEqual({ "ds@10pt": "", "ds@11pt": "", "ds@12pt": "" });
  });

  test("marks the kinds of unit that stop the compile, in the package and its id", async () => {
    const plain = ok((await assembleInvented(JAKE_LIKE)).result).package;
    const decisions: Decisions = { fixed: ["section.paragraph", "entry"] };
    const marked = ok((await assembleInvented({ ...JAKE_LIKE, decisions })).result).package;
    expect(plain.fixed).toBeUndefined();
    // In the order the editor names the kinds, so that the same decisions hash the same.
    expect(marked.fixed).toEqual(["entry", "section.paragraph"]);
    expect(marked.id).not.toBe(plain.id);
    expect(() => parsePackage(marked)).not.toThrow();
  });
});

describe("extras are kept LaTeX everywhere (decision 0026)", () => {
  test("keeps an address whose % hyperref reads as its own between two header calls", async () => {
    const source = ENVIRONMENTS.source.replace(
      "\\cvmail{",
      "\\href{https://quill.example/a%20b}{my site}\n\\cvmail{",
    );
    const result = ok((await assembleInvented({ ...ENVIRONMENTS, source })).result);
    expect(Object.values(result.document.resume.header.extras ?? {})).toContain(
      "\\href{https://quill.example/a%20b}{my site}",
    );
  });

  test("refuses a part past the cap as one it cannot keep, as a list of 74 KB kept whole", async () => {
    const items = Array.from(
      { length: 420 },
      (_, i) =>
        `  \\item Invented publication number ${i} with invented words about invented research on invented topics, in the Invented Journal of Invented Studies, volume ${i}, pages 1 to 20.`,
    ).join("\n");
    const body = entriesBody(
      "  \\cventry{Invented role}{Jan 2020 -- Present}{Quill Co}{Harbour City}\n",
    ).replace(
      "\\end{document}",
      `\n\\section{Invented publications}\n\\begin{itemize}\n${items}\n\\end{itemize}\n\\end{document}`,
    );
    const whole = await assembled({ body, verdicts: { item: ["breaks"] } });
    expect(isRefusal(whole.result) && (whole.result as Refusal).reason).toBe("keep");
    // Mapped onto the model, the list is no extra, and the import assembles.
    ok((await assembled({ body })).result);
  });
});

describe.skipIf(!engineAvailable())("the assembly, on the engine (decision 0026)", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let texTree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    texTree = readTree(manifest.files, manifest.fonts);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /**
   * An invented upload through the intake, the reference, the signatures, asked of the sizes a
   * class may declare too (`SIZE_OPTIONS`), the parse and the probe, and assembled from `answers`.
   */
  async function assembledOn(
    files: Record<string, string>,
    answers: readonly AnswerRow[],
  ): Promise<Assembled> {
    const zipped = Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    );
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree: texTree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const preamble = readBody(bodyOfText(body.preamble));
    const uses = probeUses(read, isRefusal(preamble) ? undefined : preamble);
    const found = await signatures(session, taken, made, body, {
      ...uses,
      commands: [...uses.commands, ...SIZE_OPTIONS],
    });
    if (isRefusal(found)) throw new Error("no signatures");
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const probed = await probe(session, fonts, taken, made, built, found);
    if (probed.format !== undefined) session.dropFormat("pdftex", probed.format);
    return ok(await assemble(taken, made, built, found, probed, answerOf(answers)));
  }

  /** Whether a resume compiles through a package, from its format. */
  function compiles(pkg: TemplatePackage, resume: Resume): boolean {
    const format = generateFormat(pkg, {});
    try {
      if (!session.dump(pkg.engine, format.name, format.preamble, pkg.files).ok) return false;
      const body = generateBody(pkg, resume, {}).latex;
      return session.compile(pkg.engine, format.name, body, { job: "assemble", maxPasses: 3 }).ok;
    } finally {
      session.dropFormat(pkg.engine, format.name);
      session.forget("assemble");
    }
  }

  /** The resume with an entry the editor adds, as the side panel adds one, in its first section. */
  const withNewEntry = (result: Assembled) =>
    apply(result.document, {
      type: "structure",
      op: { op: "addEntry", section: sectionOf(result, 0).id },
    }).resume;

  const LIST = [
    "environment",
    "cvlist",
    {
      kind: "layout",
      arguments: [],
      repeatable: false,
      list: { does: "opens", holds: "entry" },
    },
  ] as const satisfies AnswerRow;

  test("gives an argument each entry holds its own a default a new entry compiles with", async () => {
    // A length each call gives its own, which no slot holds: kept in each entry's extras.
    const cls = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}[2026/09/27 an invented class]
\LoadClass{article}
\newcommand{\cvrow}[3]{\vspace{#2}\noindent\textbf{#1}\hfill #3\par}
\newenvironment{cvlist}{\par}{\par}
`;
    const source = String.raw`\documentclass[letterpaper]{inventedcv}
\begin{document}
\section{Invented experience}
\begin{cvlist}
  \cvrow{Invented role}{2pt}{2020}
  \cvrow{Second role}{6pt}{2019}
\end{cvlist}
\end{document}
`;
    const result = await assembledOn({ "cv.tex": source, "inventedcv.cls": cls }, [
      [
        "command",
        "cvrow",
        {
          kind: "entry",
          arguments: [
            { index: 1, meaning: "title", slot: "title" },
            { index: 2, meaning: "length" },
            { index: 3, meaning: "dates", slot: "dates" },
          ],
          repeatable: true,
        },
      ],
      LIST,
    ]);
    expect(entriesOf(result, 0).map((entry) => entry.extras?.a2)).toEqual(["{2pt}", "{6pt}"]);
    expect(result.package.snippets.defaults?.entry?.default).toEqual({ a2: "{2pt}" });
    expect(compiles(result.package, result.document.resume)).toBe(true);
    expect(compiles(result.package, withNewEntry(result))).toBe(true);
  }, 120_000);

  test("gives a slot locked in every instance the answer's blank, the first call's where it says kept", async () => {
    // A class that reads its dates' two ends apart, which the editor's markers break.
    const cls = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}[2026/09/27 an invented class]
\LoadClass{article}
\def\cv@ends#1 -- #2\@nil{#1\,--\,#2}
\newcommand{\cvrow}[2]{\noindent\textbf{#1}\hfill\cv@ends#2\@nil\par}
\newenvironment{cvlist}{\par}{\par}
`;
    const source = String.raw`\documentclass[letterpaper]{inventedcv}
\begin{document}
\section{Invented experience}
\begin{cvlist}
  \cvrow{Invented role}{Jan 2020 -- Present}
  \cvrow{Second role}{Mar 2018 -- Dec 2019}
\end{cvlist}
\end{document}
`;
    const row = (blank?: "kept") =>
      [
        "command",
        "cvrow",
        {
          kind: "entry",
          arguments: [
            { index: 1, meaning: "title", slot: "title" },
            {
              index: 2,
              meaning: "dates",
              slot: "dates",
              ...(blank === undefined ? {} : { blank }),
            },
          ],
          repeatable: true,
        },
      ] as const satisfies AnswerRow;
    const kept = await assembledOn({ "cv.tex": source, "inventedcv.cls": cls }, [
      row("kept"),
      LIST,
    ]);
    expect(entrySnippet(kept.package, "experience")).not.toContain("{{dates}}");
    expect(entriesOf(kept, 0).map((entry) => entry.kept)).toEqual([["dates"], ["dates"]]);
    expect(kept.package.snippets.defaults?.entry?.default).toEqual({
      dates: "Jan 2020 -- Present",
    });
    expect(compiles(kept.package, kept.document.resume)).toBe(true);
    expect(compiles(kept.package, withNewEntry(kept))).toBe(true);
    // Where the answer says nothing of it, a date is the person's text, which no new entry copies:
    // the new entry writes the argument empty, which this class cannot take, as check 3 reports.
    const silent = await assembledOn({ "cv.tex": source, "inventedcv.cls": cls }, [row(), LIST]);
    expect(silent.package.snippets.defaults?.entry?.default).toEqual({ dates: "" });
    expect(JSON.stringify(silent.package)).not.toContain("Jan 2020");
  }, 120_000);

  test("removes a section whose head opens its content's list, and still compiles", async () => {
    // A fork shaped like Jake's Resume whose skills stand between the entries' list opener and its
    // closer: the section keeps the closer with the opener, so that removing it takes both, where
    // the closer left behind in a locked part stopped the compile (decision 0038).
    const cls = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}[2026/09/30 an invented class]
\LoadClass{article}
\renewcommand{\labelitemi}{--}
\newcommand{\cventry}[2]{\item\textbf{#1}\hfill #2}
\newcommand{\cvlistStart}{\begin{itemize}}
\newcommand{\cvlistEnd}{\end{itemize}}
\newcommand{\cvitem}[1]{\item #1}
`;
    const source = String.raw`\documentclass[letterpaper]{inventedcv}
\begin{document}
\section{Invented experience}
\cvlistStart
  \cventry{Invented role}{2020}
  \cventry{Second role}{2019}
\cvlistEnd

\section{Invented skills}
\cvlistStart
  \cvitem{Invented skill}
  \cvitem{Another skill}
\cvlistEnd

\section{Summary}
Invented words of an invented summary.
\end{document}
`;
    const result = await assembledOn({ "cv.tex": source, "inventedcv.cls": cls }, [
      [
        "command",
        "cventry",
        {
          kind: "entry",
          arguments: [
            { index: 1, meaning: "title", slot: "title" },
            { index: 2, meaning: "dates", slot: "dates" },
          ],
          repeatable: true,
        },
      ],
      [
        "command",
        "cvlistStart",
        {
          kind: "layout",
          arguments: [],
          repeatable: false,
          list: { does: "opens", closedBy: "cvlistEnd", holds: "entry" },
        },
      ],
      [
        "command",
        "cvlistEnd",
        {
          kind: "layout",
          arguments: [],
          repeatable: false,
          list: { does: "closes", openedBy: "cvlistStart" },
        },
      ],
      [
        "command",
        "cvitem",
        {
          kind: "bullet",
          arguments: [{ index: 1, meaning: "text", slot: "text" }],
          repeatable: true,
        },
      ],
    ]);
    const skills = result.document.resume.sections.find(
      (section) => section.title === "Invented skills",
    );
    expect(skills?.kind).toBe("list");
    expect(skills?.extras?.after).toContain("\\cvlistEnd");
    expect(compiles(result.package, result.document.resume)).toBe(true);
    const removed = apply(result.document, {
      type: "structure",
      op: { op: "removeSection", id: skills?.id ?? "" },
    });
    expect(removed.resume.sections).toHaveLength(result.document.resume.sections.length - 1);
    expect(compiles(result.package, removed.resume)).toBe(true);
  }, 120_000);

  test("offers the font sizes the engine finds the class declares", async () => {
    const source = String.raw`\documentclass[11pt]{inventedcv}
\begin{document}
Invented words of an invented summary.
\end{document}
`;
    const sizesOf = async (cls: string) =>
      (
        await assembledOn(
          {
            "cv.tex": source,
            "inventedcv.cls": `\\NeedsTeXFormat{LaTeX2e}\\ProvidesClass{inventedcv}${cls}`,
          },
          [],
        )
      ).package.controls.fontSize?.sizes;
    const passing = (base: string) =>
      `\\DeclareOption*{\\PassOptionsToClass{\\CurrentOption}{${base}}}\\ProcessOptions\\relax\\LoadClass{${base}}`;
    expect(await sizesOf(passing("article"))).toEqual([10, 11, 12]);
    expect(await sizesOf(passing("extarticle"))).toEqual([9, 10, 11, 12]);
    expect(await sizesOf("\\LoadClass{minimal}")).toBeUndefined();
  }, 120_000);
});
