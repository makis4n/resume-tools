import type { Section } from "@resume-tools/resume-model";
import { describe, expect, test } from "vitest";
import { Document } from "../editor/document";
import { parsePackage } from "../templates/package";
import { parseSnippet } from "../templates/snippet";
import {
  ANSWERS,
  type AnswerRow,
  answerOf,
  BODY,
  COMMANDS,
  ENVIRONMENTS,
  type Invented,
  inputsOf,
  JAKE_LIKE,
  MEANINGS,
  PREAMBLE,
  REFERENCE,
  signaturesOf,
} from "../test/invented-import";
import { bound, fastestAsync } from "../test/timing";
import {
  type Assembled,
  assemble,
  type Decisions,
  hyperrefLines,
  kindOfAddress,
  LINKS,
  takenOut,
} from "./assemble";
import type { Intake } from "./intake";
import type { Verdict } from "./probe";
import type { Reference } from "./reference";
import { isRefusal, type Refusal } from "./refusal";

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
    commands: { ...COMMANDS, ...(options.commands ?? {}) },
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
    expect(first.package.source).toEqual({ url: "cv.tex", license: "", attribution: "" });
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
    expect(controls.fontSize).toEqual({ default: 11, apply: "", format: true });
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
