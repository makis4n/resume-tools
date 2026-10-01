import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Resume } from "@resume-tools/resume-model";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import { applyUnder, CommandError, type StructureOp } from "../editor/document";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { generateBody } from "../templates/generate";
import type { ControlValues, TemplatePackage } from "../templates/package";
import {
  ANSWERS,
  type AnswerRow,
  answerOf,
  BODY,
  ENVIRONMENTS,
  type Invented,
  inputsOf,
  JAKE_LIKE,
  LAYOUT,
  PREAMBLE,
  REFERENCE,
} from "../test/invented-import";
import type { Finding } from "../validate/harness";
import { type Assembled, assemble, SIZE_OPTIONS, takenOut } from "./assemble";
import { readTree } from "./fonts";
import { type Intake, intake } from "./intake";
import { inLatinModern, isComputerModernT1 } from "./latin-modern";
import { bodyOf, bodyOfText, buildTree, readBody } from "./parse";
import { probe, probeUses } from "./probe";
import { type GlyphStream, type Reference, type ReferenceItem, reference } from "./reference";
import { isRefusal, type Refusal } from "./refusal";
import { type Layout, signatures } from "./signatures";
import {
  type Compiled,
  type Compiler,
  DROPPED,
  MUTATIONS,
  UNCHECKED,
  type ValidationInputs,
  validate,
  validateWith,
} from "./validate";
import type { XetexRewrite } from "./xetex";
import { rewriteForXetex } from "./xetex";

// Every document here is invented for these tests (`../test/invented-import.ts`), and compiled by
// a fake that sets a body's text as glyphs in a row, as far as the checks need a page.

/** What the fake does besides setting a body's text. */
interface Behaviour {
  /** Fields whose markers move their glyphs, as a regeneration that kerns otherwise would. */
  moves?: ReadonlySet<string>;
  /** Whether a field's text stops the compile, as a macro that measures its argument might. */
  stops?: (field: string, text: string) => boolean;
  /** Controls whose LaTeX the page does not show. */
  blind?: ReadonlySet<"margins" | "pageSize" | "fontSize">;
  /**
   * Controls whose LaTeX sets the text block elsewhere than asked, ten points right of it, as a
   * layout geometry's options cannot say would (decision 0040).
   */
  misplaces?: ReadonlySet<"margins" | "pageSize">;
  /** LaTeX that stops any compile it is in, as a control's value can. */
  stopsOn?: RegExp;
  /** Preamble text that moves every glyph, as a redefinition that changes the page does. */
  shiftsOn?: RegExp;
  /** Whether a preamble moves every glyph, as redefinitions that change the page together do. */
  shifts?: (preamble: string) => boolean;
  /**
   * Whether the template cannot set a document, as a class whose entries need dates, or whose
   * sections need text, stops on a unit the editor adds without them.
   */
  refuses?: (resume: Resume) => boolean;
  /**
   * Preamble text that stops every compile, as a redefinition of a macro a package or the
   * preamble defines does right after the class, where the macro is not defined yet.
   */
  stopsOnPreamble?: RegExp;
  /** A colour special the fake sets first on the page, this far down it, in scaled points. */
  colour?: number;
  /** A reference page of the original's other than the one the fake sets. */
  like?: GlyphStream;
}

const SP = 65_536;
const LETTER = { width: 614.295, height: 794.97 };
const A4 = { width: 597.508, height: 845.047 };

/** The index after the group that opens at `at`, `{` there, with escaped braces skipped. */
function groupEnd(latex: string, at: number): number {
  let depth = 0;
  for (let i = at; i < latex.length; i++) {
    const char = latex[i];
    if (char === "\\") i++;
    else if (char === "%") while (i < latex.length && latex[i] !== "\n") i++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i + 1;
  }
  return latex.length;
}

/**
 * A body's page as the fake sets it: every character but spaces, braces and comments a glyph in a
 * row, `--` an en dash, a control word nothing but its arguments' text, a control symbol its
 * character; a field's markers specials around its text; `\rtlocked`'s id left out.
 */
function glyphsOf(latex: string, shift: number, moves: ReadonlySet<string>): ReferenceItem[] {
  const items: ReferenceItem[] = [];
  let column = 0;
  const glyph = (text: string, by: number) =>
    items.push({
      kind: "glyph",
      font: "invented",
      size: 0,
      code: text.codePointAt(0) ?? 0,
      text,
      h: column++ * 6 * SP + shift + by,
      v: 0,
    });
  const walk = (from: number, to: number, by: number) => {
    for (let i = from; i < to; i++) {
      const char = latex[i] as string;
      if (char === "%") {
        while (i < to && latex[i] !== "\n") i++;
        continue;
      }
      if (char === "\\") {
        const word = /^[A-Za-z@]+/.exec(latex.slice(i + 1, to))?.[0];
        if (word === undefined) {
          const symbol = latex[i + 1] ?? "";
          if ("%&#$_{}".includes(symbol)) glyph(symbol, by);
          i++;
          continue;
        }
        i += word.length;
        if (word === "rtfield" || word === "rtlocked") {
          const idEnd = groupEnd(latex, i + 1);
          const id = latex.slice(i + 2, idEnd - 1);
          const contentEnd = groupEnd(latex, idEnd);
          if (word === "rtfield") items.push({ kind: "special", h: 0, v: 0, text: `rt:b:${id}` });
          walk(idEnd + 1, contentEnd - 1, moves.has(id) ? by + SP : by);
          if (word === "rtfield") items.push({ kind: "special", h: 0, v: 0, text: `rt:e:${id}` });
          i = contentEnd - 1;
        }
        continue;
      }
      if (/[\s{}~]/.test(char)) continue;
      if (latex.startsWith("---", i)) {
        glyph("—", by);
        i += 2;
      } else if (latex.startsWith("--", i)) {
        glyph("–", by);
        i += 1;
      } else glyph(char, by);
    }
  };
  walk(0, latex.length, 0);
  return items;
}

/** The text of a field's content as the fake reads it, for `Behaviour.stops`. */
const textOf = (latex: string) =>
  glyphsOf(latex, 0, new Set())
    .map((item) => (item.kind === "glyph" ? item.text : ""))
    .join("");

/** The body of LaTeX after a package's preamble, set by the fake. */
function fakePage(
  latex: string,
  pkg: TemplatePackage | undefined,
  values: ControlValues,
  behaviour: Behaviour,
  fontSize: number,
): { broke: boolean; stream?: GlyphStream; layout?: Layout } {
  if (behaviour.stopsOn?.test(latex)) return { broke: true };
  if (pkg !== undefined && behaviour.stopsOnPreamble?.test(pkg.preamble)) return { broke: true };
  for (const found of latex.matchAll(/\\rtfield\{([^}]*)\}/g)) {
    const at = (found.index ?? 0) + found[0].length;
    const content = latex.slice(at + 1, groupEnd(latex, at) - 1);
    if (behaviour.stops?.(found[1] ?? "", textOf(content))) return { broke: true };
  }
  const begin = latex.indexOf("\\begin{document}");
  const end = latex.indexOf("\\end{document}");
  const before = latex.slice(0, Math.max(begin, 0));
  const blind = behaviour.blind ?? new Set();
  // The margins' snippet sets its value where TeX finds it is not the document's own (`\ifdim`),
  // as the invented page's own is half an inch; and the page size's names the paper it sets.
  const asked = /\\ifdim([\d.]+)in=([\d.]+)in /.exec(before);
  const margined = asked !== null && asked[1] !== asked[2] && !blind.has("margins");
  const margin = margined ? Number(asked?.[1]) : 0.5;
  let shift = Math.round((margin - 0.5) * 72.27 * SP);
  const shifted =
    behaviour.shiftsOn?.test(pkg?.preamble ?? "") || behaviour.shifts?.(pkg?.preamble ?? "");
  if (pkg !== undefined && shifted) shift += 10 * SP;
  const size = blind.has("fontSize")
    ? fontSize
    : (values.fontSize ?? pkg?.controls.fontSize?.default ?? fontSize);
  const body = latex.slice(begin + "\\begin{document}".length, end < 0 ? latex.length : end);
  const items = glyphsOf(body, shift, behaviour.moves ?? new Set()).map((item) =>
    item.kind === "glyph" ? { ...item, size: size * SP } : item,
  );
  if (behaviour.colour !== undefined)
    items.unshift({ kind: "special", h: 0, v: behaviour.colour, text: "color push gray 0.5" });
  const a4 = !blind.has("pageSize") && /a4paper/.test(before);
  const paper = a4 ? A4 : LETTER;
  const misplaced =
    (margined && behaviour.misplaces?.has("margins")) ||
    (a4 && behaviour.misplaces?.has("pageSize"));
  const side = margin * 72.27;
  const left = side + (misplaced ? 10 : 0);
  return {
    broke: false,
    stream: {
      pages: [{ items }],
      size: paper,
      fonts: { tex: ["invented"], native: [], shipped: [] },
      specials: [],
    },
    layout: {
      left,
      top: side,
      width: paper.width - left - side,
      height: paper.height - 2 * side,
      paperWidth: paper.width,
      paperHeight: paper.height,
      size,
    },
  };
}

/** The fake compiler: every compile counted, set by `fakePage`. */
class Fake implements Compiler {
  count = 0;

  constructor(
    private readonly original: string,
    private readonly fontSize: number,
    private readonly behaviour: Behaviour = {},
  ) {}

  async like(): Promise<{ stream: GlyphStream } | Refusal> {
    this.count++;
    const page = fakePage(this.original, undefined, {}, {}, this.fontSize);
    return { stream: this.behaviour.like ?? (page.stream as GlyphStream) };
  }

  async latex(pkg: TemplatePackage, values: ControlValues, latex: string): Promise<Compiled> {
    this.count++;
    const body = { latex, texts: new Map<string, string>(), dropped: [], surplus: [] };
    return { body, ...fakePage(latex, pkg, values, this.behaviour, this.fontSize) };
  }

  /** A document compiled by `fakePage`, which says its layout whether asked or not. */
  async document(
    pkg: TemplatePackage,
    resume: Resume,
    values: ControlValues = {},
  ): Promise<Compiled> {
    const body = generateBody(pkg, resume, values);
    if (this.behaviour.refuses?.(resume)) {
      // A compile the engine makes, which stops, with no output to read.
      this.count++;
      return { body, broke: true };
    }
    return { ...(await this.latex(pkg, values, body.latex)), body };
  }
}

/** An invented import validated through the fake, with the harness given, and a budget if one is. */
async function validated(
  invented: Invented,
  behaviour: Behaviour = {},
  harness?: (assembled: Assembled) => Promise<Finding[]>,
  budget?: number,
): Promise<{ result: Assembled | Refusal; fake: Fake }> {
  const inputs = inputsOf(invented);
  const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer);
  const original = `${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
  const fake = new Fake(original, 11, behaviour);
  const liked = await new Fake(original, 11, behaviour).like();
  if (isRefusal(liked)) throw new Error(liked.message);
  const reference: Reference = { ...REFERENCE, ...liked.stream };
  const result = await validateWith({ ...inputs, reference, budget }, fake, harness);
  return { result, fake };
}

/** A validation that did not refuse. */
function ok(result: Assembled | Refusal): Assembled {
  if (isRefusal(result)) throw new Error(`refused: ${result.message}`);
  return result;
}

/** The plain assembly of an invented import, before any check. */
async function plain(invented: Invented): Promise<Assembled> {
  const inputs = inputsOf(invented);
  return ok(
    await assemble(
      inputs.intake,
      REFERENCE,
      inputs.tree,
      inputs.signatures,
      inputs.probe,
      inputs.answer,
    ),
  );
}

/** The id of the first field of a slot. */
const fieldOf = (assembled: Assembled, slot: string) =>
  assembled.checks.all.find((field) => field.slot === slot)?.field ?? "";

describe("the fake compiler", () => {
  test("sets the original and the document the assembly makes of it alike", async () => {
    const inputs = inputsOf(JAKE_LIKE);
    const assembled = await plain(JAKE_LIKE);
    const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer);
    const original = `${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
    const fake = new Fake(original, 11);
    const liked = await fake.like();
    const document = await fake.document(assembled.package, assembled.document.resume);
    if (isRefusal(liked)) throw new Error(liked.message);
    const glyphs = (stream: GlyphStream | undefined) =>
      stream?.pages[0]?.items.flatMap((item) => (item.kind === "glyph" ? [item.text] : [])) ?? [];
    expect(glyphs(document.stream).join("")).toBe(glyphs(liked.stream).join(""));
    expect(glyphs(liked.stream).join("")).toContain("Jan2020–Present");
  });
});

describe("the checks", () => {
  test("pass a document the generator sets as the original, and prove its controls", async () => {
    const { result, fake } = await validated(JAKE_LIKE);
    const { checks } = ok(result);
    expect(checks.outcome).toBe("assembled");
    expect(checks.difference).toBeUndefined();
    expect(checks.all.some((field) => field.reason === "differs")).toBe(false);
    expect(checks.required).toEqual([]);
    expect(checks.controls.dropped).toEqual([]);
    expect(checks.controls.proven).toEqual(["pageSize", "margins", "fontSize"]);
    expect(checks.repeatable).toEqual([
      { kind: "entry", added: true, removed: true },
      { kind: "bullet", added: true, removed: true },
      { kind: "item", added: true, removed: true },
      // A section of each kind, as the side panel adds one.
      { kind: "section.entries", added: true, removed: true },
      { kind: "section.list", added: true, removed: true },
      { kind: "section.labelled", added: true, removed: true },
      { kind: "section.paragraph", added: true, removed: true },
    ]);
    expect(checks.compiles).toBe(fake.count);
  });

  test("lock the fields whose regeneration moves the page, and those alone", async () => {
    const title = fieldOf(await plain(JAKE_LIKE), "command|cventry|1");
    const { result } = await validated(JAKE_LIKE, { moves: new Set([title]) });
    const assembled = ok(result);
    expect(assembled.checks.outcome).toBe("assembled");
    const locked = assembled.checks.all.filter((field) => field.reason === "differs");
    expect(locked.map((field) => field.field)).toEqual([title]);
    const work = assembled.document.resume.sections[0];
    if (work?.kind !== "entries") throw new Error("the entries");
    expect(work.entries[0]?.title).toBe("");
    expect(work.entries[0]?.extras?.title).toBe("Invented role");
    expect(work.entries[1]?.title).toBe("Second role");
  });

  test("require a slot that stops the compile empty, and lock one that stops on text", async () => {
    // The generator writes an empty value bare, with no markers: an entry's call with an empty
    // title stops, as a macro that tests its argument might; a bullet stops on a long text.
    const { result } = await validated(JAKE_LIKE, {
      stopsOn: /\\cventry\{\}/,
      stops: (field, text) =>
        field.startsWith("bul-") && text.startsWith(MUTATIONS.long.replace(/ /g, "").slice(0, 20)),
    });
    const { checks, document, package: pkg } = ok(result);
    expect(checks.required).toEqual(["command|cventry|1"]);
    expect(checks.decisions.slots).toEqual({ "command|cvitem|1": "text" });
    const work = document.resume.sections[0];
    if (work?.kind !== "entries") throw new Error("the entries");
    expect(work.entries[0]?.bullets).toEqual([]);
    expect(work.entries[0]?.extras?.bullets).toContain("\\cvitem{Invented first bullet}");
    expect(pkg.snippets.bullet).toBe("\\item {{text}}");
  });

  test("drop a control that sets the same page at every value, and one that stops", async () => {
    const { result } = await validated(JAKE_LIKE, {
      blind: new Set(["margins"]),
      stopsOn: /a4paper/,
    });
    const { checks, package: pkg } = ok(result);
    expect(checks.controls.dropped).toEqual([
      { control: "pageSize", why: "stops the compile at pageSize a4" },
      { control: "margins", why: "sets the same page at every value" },
    ]);
    expect(pkg.controls.pageSize).toBeUndefined();
    expect(pkg.controls.margins).toBeUndefined();
    expect(pkg.controls.fontSize).toBeDefined();
  });

  test("put the redefinitions at the preamble's end where a compile after the class stops", async () => {
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
    const { result } = await validated(
      { ...JAKE_LIKE, answers },
      { stopsOnPreamble: /\{inventedcv\}\n\\renewcommand/ },
    );
    const late = ok(result);
    expect(late.checks.outcome).toBe("assembled");
    expect(late.checks.redefinitions).toEqual({
      applied: ["cvitem"],
      dropped: [],
      placement: "preamble",
    });
    expect(late.package.preamble).toContain("{geometry}\n\\renewcommand{\\cvitem}[1]{#1}\n");
  });

  test("drop a redefinition that moves the original's page", async () => {
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
    const invented = { ...JAKE_LIKE, answers };
    const kept = ok((await validated(invented)).result);
    expect(kept.checks.redefinitions).toEqual({
      applied: ["cvitem"],
      dropped: [],
      placement: "class",
    });
    const { result } = await validated(invented, { shiftsOn: /\\renewcommand\{\\cvitem\}/ });
    const dropped = ok(result);
    expect(dropped.checks.outcome).toBe("assembled");
    expect(dropped.checks.redefinitions).toEqual({
      applied: [],
      dropped: ["cvitem"],
      placement: "class",
    });
    expect(dropped.package.preamble).not.toContain("\\renewcommand{\\cvitem}");
  });

  test("are partial when the rewrite itself moves the page, naming the first difference", async () => {
    const inputs = inputsOf(JAKE_LIKE);
    const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer);
    const original = `${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
    const liked = await new Fake(original, 11).like();
    if (isRefusal(liked)) throw new Error(liked.message);
    const [page] = liked.stream.pages;
    const moved: GlyphStream = {
      ...liked.stream,
      pages: [
        { items: [...(page?.items ?? []), { kind: "rule", h: 0, v: 0, width: SP, height: SP }] },
      ],
    };
    const inventedReference: Reference = { ...REFERENCE, ...moved };
    const fake = new Fake(original, 11, { like: moved });
    const result = ok(await validateWith({ ...inputs, reference: inventedReference }, fake));
    expect(result.checks.outcome).toBe("partial");
    expect(result.checks.difference?.kind).toBe("count");
    // The document still sets what the original body sets, and nothing is locked for it.
    expect(result.checks.all.some((field) => field.reason === "differs")).toBe(false);
  });

  test("say which fonts an import read in Latin Modern was set in, for the report", async () => {
    // What `inLatinModern` swapped, which the pipeline passes on (decision 0026).
    const inputs = inputsOf(JAKE_LIKE);
    const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer);
    const original = `${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
    const liked = await new Fake(original, 11).like();
    if (isRefusal(liked)) throw new Error(liked.message);
    const reference: Reference = { ...REFERENCE, ...liked.stream };
    const swapped = ok(
      await validateWith(
        { ...inputs, reference, latinModern: ["ecrm1000", "tcrm1000"] },
        new Fake(original, 11),
      ),
    );
    expect(swapped.checks.latinModern).toEqual(["ecrm1000", "tcrm1000"]);
    const kept = ok(await validateWith({ ...inputs, reference }, new Fake(original, 11)));
    expect(kept.checks.latinModern).toBeUndefined();
  });

  test("compare a XeTeX import's fonts by file with the original's as item 8's check does", async () => {
    // A colour special the package's format sets 20 sp from where the original set it, as a
    // font by file and by name can, which sets nothing on the page (decision 0023).
    const inputs = inputsOf(JAKE_LIKE);
    const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer);
    const original = `${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
    const liked = await new Fake(original, 11, { colour: 0 }).latex(
      await plain(JAKE_LIKE).then((each) => each.package),
      {},
      original,
    );
    if (liked.stream === undefined) throw new Error("no stream");
    const reference: Reference = { ...REFERENCE, ...liked.stream };
    const rewrite: XetexRewrite = {
      preamble: PREAMBLE,
      body: inputs.tree.source,
      files: {},
      fonts: [],
      warnings: [],
      mathFonts: [],
      deferred: [],
      features: {},
    };
    const behaviour = { like: liked.stream, colour: 20 };
    const rewritten = ok(
      await validateWith({ ...inputs, reference, rewrite }, new Fake(original, 11, behaviour)),
    );
    expect(rewritten.checks.outcome).toBe("assembled");
    // Without the rewrite, the fonts are the original's, and the special's place counts.
    const exact = ok(
      await validateWith({ ...inputs, reference }, new Fake(original, 11, behaviour)),
    );
    expect(exact.checks.outcome).toBe("partial");
    expect(exact.checks.difference?.kind).toBe("position");
  });

  test("lock a field the harness finds unmarked, once, and keep its other findings", async () => {
    const bullet = fieldOf(await plain(JAKE_LIKE), "command|cvitem|1");
    let rounds = 0;
    const { result } = await validated(JAKE_LIKE, {}, async () => {
      rounds++;
      return [
        { check: "fields", message: "an invented field is not marked", field: bullet },
        { check: "fonts", message: "an invented font finding" },
      ];
    });
    const assembled = ok(result);
    expect(rounds).toBe(2);
    const work = assembled.document.resume.sections[0];
    if (work?.kind !== "entries") throw new Error("the entries");
    // A bullet keeps no extras: its list is kept whole in its entry's.
    expect(work.entries[0]?.bullets).toEqual([]);
    expect(work.entries[0]?.extras?.bullets).toContain("\\cvitem{Invented first bullet}");
    expect(assembled.extras).toContainEqual(
      expect.objectContaining({ kind: "list", key: "bullets", reason: "fields" }),
    );
    expect(assembled.checks.findings).toEqual([
      { check: "fields", message: "an invented field is not marked", field: bullet },
      { check: "fonts", message: "an invented font finding" },
    ]);
  });

  test("assemble the same package and document from the same import", async () => {
    const first = ok((await validated(JAKE_LIKE)).result);
    const again = ok((await validated(JAKE_LIKE)).result);
    expect(again.package).toEqual(first.package);
    expect(again.document).toEqual(first.document);
    expect(answerOf(ANSWERS).macros).toHaveLength(ANSWERS.length);
  });

  test("add the units the editor adds, through its own commands, and mark a kind that stops", async () => {
    // The editor's new entry has no dates, where a copy of the first would have its dates; and a
    // new paragraph section has no text. A template that stops on either cannot take one.
    const { result, fake } = await validated(JAKE_LIKE, {
      refuses: (resume) =>
        resume.sections.some(
          (section) =>
            (section.kind === "entries" &&
              section.entries.some((entry) => entry.dates === undefined && !entry.extras?.dates)) ||
            (section.kind === "paragraph" && section.text.length === 0),
        ),
    });
    const { checks } = ok(result);
    expect(checks.repeatable).toEqual([
      { kind: "entry", added: false, removed: true },
      { kind: "bullet", added: true, removed: true },
      { kind: "item", added: true, removed: true },
      { kind: "section.entries", added: true, removed: true },
      { kind: "section.list", added: true, removed: true },
      { kind: "section.labelled", added: true, removed: true },
      { kind: "section.paragraph", added: false, removed: true },
    ]);
    // The kinds the editor cannot add, which the package marks, in its hash too, and the editor
    // then refuses.
    expect(checks.decisions.fixed).toEqual(["entry", "section.paragraph"]);
    const { package: pkg, document } = ok(result);
    expect(pkg.fixed).toEqual(["entry", "section.paragraph"]);
    expect(pkg.id).not.toBe(ok((await validated(JAKE_LIKE)).result).package.id);
    const work = document.resume.sections.find((section) => section.kind === "entries");
    if (work === undefined) throw new Error("no entries");
    expect(() =>
      applyUnder(pkg, document, { type: "structure", op: { op: "addEntry", section: work.id } }),
    ).toThrow(
      new CommandError(
        "the template cannot take another entry: adding or removing one stops its compile",
      ),
    );
    expect(checks.compiles).toBe(fake.count);
  });

  test("mark a kind the removal of whose first or last unit stops, and leave the other kinds", async () => {
    // A template that stops without a list section, as a list whose opener the section keeps and
    // whose closer stands after it would: its one list section cannot go, while a new one can
    // come; the editor neither adds nor removes one (decision 0038).
    const { result, fake } = await validated(JAKE_LIKE, {
      refuses: (resume) => !resume.sections.some((section) => section.kind === "list"),
    });
    const { checks, package: pkg, document } = ok(result);
    expect(checks.repeatable).toEqual([
      { kind: "entry", added: true, removed: true },
      { kind: "bullet", added: true, removed: true },
      { kind: "item", added: true, removed: true },
      { kind: "section.entries", added: true, removed: true },
      { kind: "section.list", added: true, removed: false },
      { kind: "section.labelled", added: true, removed: true },
      { kind: "section.paragraph", added: true, removed: true },
    ]);
    expect(checks.decisions.fixed).toEqual(["section.list"]);
    expect(pkg.fixed).toEqual(["section.list"]);
    const list = document.resume.sections.find((section) => section.kind === "list");
    const work = document.resume.sections.find((section) => section.kind === "entries");
    if (list === undefined || work === undefined) throw new Error("no list or no entries");
    const remove = (id: string) =>
      applyUnder(pkg, document, { type: "structure", op: { op: "removeSection", id } });
    expect(() => remove(list.id)).toThrow(
      new CommandError(
        "the template cannot lose a list section: adding or removing one stops its compile",
      ),
    );
    expect(remove(work.id).resume.sections).toHaveLength(document.resume.sections.length - 1);
    expect(checks.compiles).toBe(fake.count);
  });

  test("pin a locked part against a step that stops, and leave it its other steps", async () => {
    // A template that stops without a part kept as it was, or with the part above the section
    // before it, as a part that holds the closer of a list that section opens: check 3 pins the
    // part against its removal and its move up, the editor then refuses both, and it moves down
    // (decision 0041).
    const paged: Invented = {
      ...JAKE_LIKE,
      source: JAKE_LIKE.source.replace("\\section{Summary}", "\\newpage\n\\section{Summary}"),
    };
    const { sections } = (await plain(paged)).document.resume;
    const at = sections.findIndex((section) => section.kind === "locked");
    const part = sections[at]?.id;
    const above = sections[at - 1]?.id;
    if (part === undefined || above === undefined || at === sections.length - 1)
      throw new Error("no part between two sections");
    const { result, fake } = await validated(paged, {
      refuses: (resume) => {
        const ids = resume.sections.map((section) => section.id);
        return !ids.includes(part) || ids.indexOf(part) < ids.indexOf(above);
      },
    });
    const { checks, package: pkg, document } = ok(result);
    expect(checks.decisions.pinned).toEqual({ [part]: ["remove", "up"] });
    expect(pkg.pinned).toEqual({ [part]: ["remove", "up"] });
    expect(pkg.id).not.toBe(ok((await validated(paged)).result).package.id);
    const step = (op: StructureOp) => () => applyUnder(pkg, document, { type: "structure", op });
    expect(step({ op: "removeSection", id: part })).toThrow(CommandError);
    expect(step({ op: "moveSection", id: part, to: at - 1 })).toThrow(CommandError);
    expect(step({ op: "moveSection", id: part, to: at + 1 })).not.toThrow();
    // Each step tried once, and none of a part the template takes every step of.
    expect(checks.compiles).toBe(fake.count);
    expect(ok((await validated(paged)).result).package.pinned).toBeUndefined();
  });

  test("mutate a raw field as a typeset one: locked where text stops it, required where empty does", async () => {
    // A contact and a link whose addresses the class builds from their text, which the probe
    // found set twice: both are raw, and edited in the panel alone.
    const raw: Invented = {
      ...ENVIRONMENTS,
      verdicts: { "cvmail#1": ["twice"], "cvgit#1": ["twice"] },
    };
    const modes = (await plain(raw)).checks.all.filter((field) => field.mode === "raw");
    expect(modes.map((field) => field.slot)).toEqual(["command|cvmail|1", "command|cvgit|1"]);
    // The link's label stops on the special characters, and the email when it is empty.
    const { result } = await validated(raw, { stopsOn: /\\cvgit\{[^\n]*\\\$|\\cvmail\{\}/ });
    const { checks, extras, document } = ok(result);
    expect(checks.outcome).toBe("assembled");
    expect(checks.decisions.slots).toEqual({ "command|cvgit|1": "text" });
    expect(checks.required).toEqual(["command|cvmail|1"]);
    expect(checks.all.find((field) => field.field === "header.email")?.mode).toBe("raw");
    // The link locked, its run of links is kept whole as the upload wrote it, for the check's
    // reason, and none of them is a field or in the model (decision 0026).
    expect(checks.all.some((field) => field.slot === "command|cvgit|1")).toBe(false);
    expect(document.resume.header.links).toEqual([]);
    expect(extras).toContainEqual(expect.objectContaining({ kind: "header", reason: "text" }));
  });

  test("leave a slot the bisection's budget did not reach untested, and say so", async () => {
    // Every field stops on the special characters, and the budget is one compile: the bisection
    // tries them all together and no more, and no compile showed any one of them fail.
    const { result } = await validated(
      JAKE_LIKE,
      { stops: (_, text) => text.includes("ß") },
      undefined,
      1,
    );
    const { checks } = ok(result);
    expect(checks.decisions.slots).toEqual({});
    expect(checks.required).toEqual([]);
    expect(checks.all.filter((field) => field.reason === "text")).toEqual([]);
    const untested = checks.findings.filter((finding) => finding.check === "untested");
    expect(untested).toHaveLength(1);
    expect(untested[0]?.message).toContain("special text ran out of its 1 compile");
    expect(untested[0]?.message).toContain("command|cventry|1");
  });

  test("keep the controls the first round dropped when the harness has the checks run again", async () => {
    const bullet = fieldOf(await plain(JAKE_LIKE), "command|cvitem|1");
    let rounds = 0;
    const { result } = await validated(JAKE_LIKE, { blind: new Set(["margins"]) }, async () => {
      rounds++;
      return rounds === 1
        ? [{ check: "fields", message: "an invented field is not marked", field: bullet }]
        : [];
    });
    const { checks, package: pkg } = ok(result);
    expect(rounds).toBe(2);
    expect(checks.controls.dropped).toEqual([
      { control: "margins", why: "sets the same page at every value" },
    ]);
    expect(checks.controls.proven).toEqual(["pageSize", "fontSize"]);
    expect(pkg.controls.margins).toBeUndefined();
  });

  test("drop the margins or the page size where a value sets another page than it asks", async () => {
    // Each changes the page, and sets its text block ten points right of where it asks: that a
    // glyph moved proves nothing, and the layout the compile says does (decision 0040).
    const { result } = await validated(JAKE_LIKE, { misplaces: new Set(["margins", "pageSize"]) });
    const { checks, package: pkg } = ok(result);
    expect(checks.controls.dropped).toEqual([
      { control: "pageSize", why: `${DROPPED.layout}pageSize a4` },
      { control: "margins", why: `${DROPPED.layout}margins 0.4` },
    ]);
    expect(checks.controls.proven).toEqual(["fontSize"]);
    expect(pkg.controls.margins).toBeUndefined();
    expect(pkg.controls.pageSize).toBeUndefined();
    // Where they set what they ask, both are proven, their every value's layout read.
    const fine = ok((await validated(JAKE_LIKE)).result);
    expect(fine.checks.controls.proven).toEqual(["pageSize", "margins", "fontSize"]);
  });

  test("drop a control whose default moves the original's page, and say why", async () => {
    // The class's options name no size, and the size the engine found is not the one the page
    // sets: the slot at its default moves every glyph, so the first check drops the control, and
    // the preamble keeps the class's options as the upload wrote them (decision 0040).
    const source = `${PREAMBLE.replace("[11pt,letterpaper]", "[letterpaper]")}${BODY}`;
    const { result } = await validated({ ...JAKE_LIKE, source, layout: { ...LAYOUT, size: 10 } });
    const { checks, package: pkg } = ok(result);
    expect(checks.outcome).toBe("assembled");
    expect(checks.controls.dropped).toEqual([{ control: "fontSize", why: DROPPED.moves }]);
    expect(checks.controls.proven).toEqual(["pageSize", "margins"]);
    expect(pkg.controls.fontSize).toBeUndefined();
    expect(pkg.preamble).toContain("\\documentclass[letterpaper]{inventedcv}");
  });

  test("drop a control the harness finds does not work, a font it cannot draw among them, and run the checks again", async () => {
    // The fourth check proves the margins, and the harness, compiling in the editor's job, finds
    // them doing nothing there: they go, the reason in the checks' words and none of the finding's,
    // which may quote TeX's log (decision 0040). A date format finding drops nothing, the date
    // format being the generator's.
    let rounds = 0;
    const { result } = await validated(JAKE_LIKE, {}, async () => {
      rounds++;
      return rounds === 1
        ? [
            { check: "controls", message: "an invented margins finding", control: "margins" },
            { check: "controls", message: "an invented date finding", control: "dateFormat" },
          ]
        : [];
    });
    const { checks, package: pkg } = ok(result);
    expect(rounds).toBe(2);
    expect(checks.controls.dropped).toEqual([{ control: "margins", why: DROPPED.harness }]);
    expect(checks.controls.proven).toEqual(["pageSize", "fontSize"]);
    expect(pkg.controls.margins).toBeUndefined();
    expect(pkg.controls.dateFormat).toBeDefined();
    expect(checks.findings).toEqual([]);
  });

  test("prove no control a stopped document never tried, and say the checks stopped", async () => {
    // The original body sets the reference's page, and every document the generator makes stops.
    const { result, fake } = await validated(JAKE_LIKE, { refuses: () => true });
    const { checks, package: pkg } = ok(result);
    expect(checks.outcome).toBe("partial");
    expect(checks.difference?.kind).toBe("stopped");
    expect(checks.controls.proven).toEqual([]);
    expect(checks.controls.dropped).toEqual([
      { control: "pageSize", why: UNCHECKED },
      { control: "margins", why: UNCHECKED },
      { control: "fontSize", why: UNCHECKED },
    ]);
    expect(pkg.controls.pageSize).toBeUndefined();
    expect(pkg.controls.fontSize).toBeUndefined();
    expect(checks.repeatable).toEqual([]);
    expect(checks.findings).toEqual([
      { check: "stopped", message: expect.stringContaining("the checks stopped at the first") },
    ]);
    expect(checks.compiles).toBe(fake.count);
  });

  /** The invented answers, with a redefinition of `\cventry` and one of `\cvitem`, reviewed. */
  const REDEFINED: AnswerRow[] = ANSWERS.map(([of, name, answer]): AnswerRow => {
    const latex =
      name === "cvitem"
        ? "\\renewcommand{\\cvitem}[1]{#1}"
        : name === "cventry"
          ? "\\renewcommand{\\cventry}[4]{#1#2#3#4}"
          : undefined;
    return latex === undefined
      ? [of, name, answer]
      : [of, name, { ...answer, reviewed: true, redefinitions: [{ name, latex }] }];
  });

  test("drop one of two redefinitions that move the page together, though each alone keeps it", async () => {
    const { result } = await validated(
      { ...JAKE_LIKE, answers: REDEFINED },
      {
        shifts: (preamble) =>
          preamble.includes("\\renewcommand{\\cvitem}") &&
          preamble.includes("\\renewcommand{\\cventry}"),
      },
    );
    const { checks, package: pkg } = ok(result);
    expect(checks.outcome).toBe("assembled");
    expect(checks.redefinitions).toEqual({
      applied: ["cventry"],
      dropped: ["cvitem"],
      placement: "class",
    });
    expect(pkg.preamble).toContain("\\renewcommand{\\cventry}");
    expect(pkg.preamble).not.toContain("\\renewcommand{\\cvitem}");
  });

  test("prove no redefinition when the package without them does not keep the page either", async () => {
    // The original's page differs from what the package's format sets for another reason, a rule
    // the rewrite loses, and `\cvitem`'s redefinition moves it as well.
    const inputs = inputsOf({ ...JAKE_LIKE, answers: REDEFINED });
    const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer);
    const original = `${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
    const liked = await new Fake(original, 11).like();
    if (isRefusal(liked)) throw new Error(liked.message);
    const [page] = liked.stream.pages;
    const moved: GlyphStream = {
      ...liked.stream,
      pages: [
        { items: [...(page?.items ?? []), { kind: "rule", h: 0, v: 0, width: SP, height: SP }] },
      ],
    };
    const fake = new Fake(original, 11, { like: moved, shiftsOn: /\\renewcommand\{\\cvitem\}/ });
    const result = ok(
      await validateWith({ ...inputs, reference: { ...REFERENCE, ...moved } }, fake),
    );
    expect(result.checks.outcome).toBe("partial");
    expect(result.checks.redefinitions).toEqual({
      applied: [],
      dropped: ["cventry", "cvitem"],
      placement: "class",
    });
    expect(result.package.preamble).not.toContain("\\renewcommand");
    expect(result.checks.findings).toContainEqual({
      check: "unproven",
      message: expect.stringContaining("none of the 2 redefinitions is proven"),
    });
  });

  test("refuse an import whose document its own schema refuses, as a list past kept LaTeX's cap", async () => {
    // A list of invented publications kept whole, as its items are locked, past 65,536 characters.
    const items = Array.from(
      { length: 520 },
      (_, i) =>
        `  \\item Invented publication number ${i}, with invented words about invented research, in the Invented Journal of Invented Studies, volume ${i}.`,
    ).join("\n");
    const source = `${PREAMBLE}${BODY.replace(
      "  \\item Invented skill\n  \\item Another skill\n",
      `${items}\n`,
    )}`;
    expect(source.length).toBeGreaterThan(65_536);
    const { result } = await validated({ ...JAKE_LIKE, source, verdicts: { item: ["breaks"] } });
    if (!isRefusal(result)) throw new Error("the import was not refused");
    expect(result.reason).toBe("keep");
  });
});

describe.skipIf(!engineAvailable())("validation, on the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files, manifest.fonts);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 120_000);

  /**
   * An invented class whose macros do what the checks look for: an entry that stops the compile
   * without a title, and a bullet that stops it past twelve centimetres. Its lists' labels are en
   * dashes, since LaTeX's bullet is TS1's, a font the page cannot draw.
   */
  const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}[2026/09/27 an invented class for the validation's tests]
\LoadClass{article}
\renewcommand{\labelitemi}{--}
\newcommand{\cvname}[1]{\def\cv@name{#1}}
\newcommand{\cvheader}{{\Large\cv@name}\par}
\newcommand{\cventry}[4]{\ifx&#1&\errmessage{Invented: an entry needs a title}\fi
  \noindent\textbf{#1}\hfill #2\par\noindent\textit{#3}\hfill #4\par}
\newcommand{\cvlistStart}{\par\begingroup}
\newcommand{\cvlistEnd}{\endgroup\par}
\newcommand{\cvitemsStart}{\begin{itemize}}
\newcommand{\cvitemsEnd}{\end{itemize}}
\newcommand{\cvitem}[1]{\setbox0\hbox{#1}\ifdim\wd0>12cm \errmessage{Invented: a bullet this long}\fi\item #1}
`;

  /** An invented upload through the whole pipeline, with the invented answers, validated. */
  /**
   * An invented upload through the whole pipeline, as the runner takes it, read in Latin Modern
   * where the page cannot draw its Computer Modern in T1 or TS1 (`inLatinModern`), unless `swap`
   * is false; with the invented answers, validated.
   */
  async function validatedOnEngine(
    source: string,
    answers: readonly AnswerRow[] = ANSWERS,
    more: Partial<ValidationInputs> = {},
    cls = CLASS,
    swap = true,
  ) {
    const zipped = { "cv.tex": strToU8(source), "inventedcv.cls": strToU8(cls) };
    const uploaded = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(uploaded)) throw new Error(`refused at intake: ${uploaded.message}`);
    const first = await reference(session, fonts, uploaded as Intake);
    if (isRefusal(first)) throw new Error(`refused: ${first.message}`);
    const swapped = swap
      ? await inLatinModern(session, fonts, uploaded as Intake, first)
      : undefined;
    if (swapped !== undefined && isRefusal(swapped)) throw new Error(swapped.message);
    const taken = swapped?.intake ?? (uploaded as Intake);
    const made = swapped?.reference ?? first;
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const preamble = readBody(bodyOfText(body.preamble));
    const uses = probeUses(read, isRefusal(preamble) ? undefined : preamble);
    // Asked of the sizes the class may declare too, as the runner asks, which the font size
    // control offers alone (decision 0026).
    const found = await signatures(session, taken, made, body, {
      ...uses,
      commands: [...uses.commands, ...SIZE_OPTIONS],
    });
    if (isRefusal(found)) throw new Error("no signatures");
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const probed = await probe(session, fonts, taken, made, built, found);
    const result = await validate({
      session,
      fonts,
      intake: taken,
      reference: made,
      tree: built,
      signatures: found,
      probe: probed,
      answer: answerOf(answers),
      ...(swapped === undefined ? {} : { latinModern: swapped.swapped }),
      ...more,
    });
    return { result, probed, made, first };
  }

  // The Jake-like document, but its spacing between two sections, which this class's page would
  // not set as a section of its own.
  const SOURCE = `${PREAMBLE}${BODY.replace("\\vspace{2pt}\n\n", "").replace(
    "  \\cventry{Third role}{Summer 2017}{Third Co}{Harbour City}\n",
    "",
  )}`;

  test("assembles an invented pdfTeX import that passes, locking what the checks find", async () => {
    const { result, probed } = await validatedOnEngine(SOURCE);
    expect(probed.path).toBe("format");
    const assembled = ok(result);
    const { checks } = assembled;
    expect(checks.outcome).toBe("assembled");
    expect(checks.difference).toBeUndefined();
    // A bullet stops the compile on the long text: its slot is locked in every instance, and the
    // bullets kept as the upload wrote them.
    expect(checks.decisions.slots).toMatchObject({ "command|cvitem|1": "text" });
    // An entry with no title stops it: the title is required, and stays editable.
    expect(checks.required).toContain("command|cventry|1");
    expect(checks.all.find((field) => field.slot === "command|cventry|1")?.mode).toBe("typeset");
    // The class loads `article` without its options, so the size option sets nothing.
    expect(checks.controls.dropped).toEqual([
      { control: "fontSize", why: "sets the same page at every value" },
    ]);
    expect(checks.controls.proven).toEqual(["pageSize", "margins"]);
    expect(assembled.package.controls.fontSize).toBeUndefined();
    expect(checks.repeatable).toContainEqual({ kind: "entry", added: true, removed: true });
    expect(checks.findings).toEqual([]);
    expect(checks.fields.editable).toBeGreaterThan(8);
    expect(checks.compiles).toBeGreaterThan(10);
  }, 120_000);

  test("proves the page size, the margins and the font size of an import that names neither geometry nor a size", async () => {
    // The margins set by hand, as Jake's Resume sets them, and no size among the class's options,
    // which this class passes to article: the page size and the margins load geometry in the body's
    // preamble region, the page size with the document's own margins, and the size goes first among
    // the class's options, at the 10 points article sets unasked (decision 0040).
    const passing = CLASS.replace(
      "\\LoadClass{article}",
      "\\DeclareOption*{\\PassOptionsToClass{\\CurrentOption}{article}}\n\\ProcessOptions\\relax\n\\LoadClass{article}",
    );
    const source = SOURCE.replace("[11pt,letterpaper]", "[letterpaper]").replace(
      "\\usepackage[margin=0.5in]{geometry}\n",
      [
        "\\usepackage[empty]{fullpage}",
        "\\addtolength{\\oddsidemargin}{-0.5in}",
        "\\addtolength{\\textwidth}{1in}",
        "\\addtolength{\\topmargin}{-.5in}",
        "\\addtolength{\\textheight}{1.0in}",
        "",
      ].join("\n"),
    );
    const { result } = await validatedOnEngine(source, ANSWERS, {}, passing);
    const { checks, package: pkg } = ok(result);
    expect(checks.outcome).toBe("assembled");
    expect(checks.controls.proven).toEqual(["pageSize", "margins", "fontSize"]);
    expect(checks.controls.dropped).toEqual([]);
    expect(pkg.controls.margins?.default).toBe(0.5);
    expect(pkg.controls.fontSize).toMatchObject({ default: 10, sizes: [10, 11, 12] });
    expect(pkg.preamble).toContain("\\documentclass[{{fontSize}}pt,letterpaper]{inventedcv}");
    expect(checks.findings).toEqual([]);
  }, 120_000);

  test("proves the margins and the page size by the page they set, and drops a margin set elsewhere", async () => {
    // The page placed by TeX's offsets, which geometry would count once more: the margins and the
    // page size set the page they ask for at every value, as the layout each compile says shows.
    const offsets = SOURCE.replace(
      "\\usepackage[margin=0.5in]{geometry}\n",
      [
        "\\setlength{\\hoffset}{-0.5in}\\setlength{\\oddsidemargin}{0in}",
        "\\setlength{\\textwidth}{7.5in}\\setlength{\\voffset}{-0.5in}\\setlength{\\topmargin}{0in}",
        "\\setlength{\\headheight}{0pt}\\setlength{\\headsep}{0pt}\\setlength{\\textheight}{10in}",
        "",
      ].join("\n"),
    );
    const placed = ok((await validatedOnEngine(offsets)).result);
    expect(placed.checks.controls.proven).toEqual(["pageSize", "margins"]);
    expect(placed.package.controls.margins?.default).toBe(0.5);
    // A document that moves its text block at \begin{document}, after any control has set it:
    // every margin changes the page, and none is the margin it asks for, so the margins go, with
    // why in the checks' words; the page size keeps the margins the document ends up with.
    const moved = SOURCE.replace(
      "\\usepackage[margin=0.5in]{geometry}\n",
      "\\usepackage[margin=0.5in]{geometry}\n\\AtBeginDocument{\\addtolength{\\oddsidemargin}{0.3in}\\addtolength{\\textwidth}{-0.3in}}\n",
    );
    const { checks } = ok((await validatedOnEngine(moved)).result);
    expect(checks.controls.dropped).toContainEqual({
      control: "margins",
      why: `${DROPPED.layout}margins 0.4`,
    });
    expect(checks.controls.proven).toContain("pageSize");
    expect(checks.controls.proven).not.toContain("margins");
  }, 240_000);

  test("reads an invented import set in Computer Modern's T1 fonts in Latin Modern, which the page draws", async () => {
    // The Jake-like document in T1 with Computer Modern: the EC fonts it sets have metrics in the
    // tree and no outlines, so the page cannot draw them, and the import was refused for them.
    // Read with T1 and Latin Modern after its class, as the ports are (decision 0009), it assembles
    // with its fields editable, and the page draws every glyph: the harness's fonts, fields and
    // alignment checks, which read the page, find nothing (decision 0026).
    const source = SOURCE.replace(
      "\\documentclass[11pt,letterpaper]{inventedcv}\n",
      "\\documentclass[11pt,letterpaper]{inventedcv}\n\\usepackage[T1]{fontenc}\n",
    );
    const before = await validatedOnEngine(source, ANSWERS, {}, CLASS, false);
    const ec = before.first.fonts.tex.filter(isComputerModernT1);
    expect(ec.length).toBeGreaterThan(0);
    expect(isRefusal(before.result) && before.result.reason).toBe("font");
    const { result, made } = await validatedOnEngine(source);
    expect(made.fonts.tex.filter(isComputerModernT1)).toEqual([]);
    const { checks, package: pkg } = ok(result);
    expect(checks.latinModern).toEqual(ec);
    expect(checks.outcome).toBe("assembled");
    expect(pkg.preamble).toContain(
      "{inventedcv}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n",
    );
    expect(
      checks.findings.filter((each) => ["fonts", "fields", "alignment"].includes(each.check)),
    ).toEqual([]);
    expect(checks.fields.editable).toBeGreaterThan(8);
    expect(checks.fields.locked.misaligned ?? 0).toBe(0);
  }, 240_000);

  test("adds what the editor adds, marks a kind it cannot, and holds the harness to two pages", async () => {
    // The class takes two entries at most, which a third, as the editor adds one, stops; and the
    // upload sets two pages, a page break before its summary kept as the upload wrote it.
    const limited = CLASS.replace(
      "\\newcommand{\\cventry}[4]{",
      "\\newcounter{cventries}\n\\newcommand{\\cventry}[4]{\\stepcounter{cventries}\\ifnum\\value{cventries}>2 \\errmessage{Invented: two entries at most}\\fi",
    );
    const source = SOURCE.replace("\\section{Summary}", "\\newpage\n\\section{Summary}");
    const { result, made } = await validatedOnEngine(source, ANSWERS, {}, limited);
    expect(made.pages).toHaveLength(2);
    const { checks, document } = ok(result);
    expect(checks.outcome).toBe("assembled");
    expect(checks.repeatable).toContainEqual({ kind: "entry", added: false, removed: true });
    expect(checks.repeatable).toContainEqual({ kind: "bullet", added: true, removed: true });
    expect(checks.decisions.fixed).toContain("entry");
    expect(ok(result).package.fixed).toContain("entry");
    // The document is the upload's two pages, which the harness holds it to, not one.
    expect(document.resume.sections.some((section) => section.kind === "locked")).toBe(true);
    expect(
      checks.findings.filter((each) => each.check === "pages" || each.check === "converges"),
    ).toEqual([]);
  }, 120_000);

  test("marks a kind whose removal stops the compile, and leaves the document's other kinds", async () => {
    // An invented fork whose skills list is opened, after the section's head, by a macro no answer
    // names, and closed after it: the section keeps the opener before its items, the closer stands
    // in the locked section after it, and removing the section takes the one and leaves the other,
    // which stops the compile. So the package marks list sections, and the editor neither adds nor
    // removes one; the document's other kinds it adds and removes as before (decision 0038).
    const cls = `${CLASS}\\newcommand{\\cvskillsStart}{\\begingroup}\n\\newcommand{\\cvskillsEnd}{\\endgroup}\n`;
    const source = SOURCE.replace(
      "\\section{Invented skills}\n",
      "\\section{Invented skills}\n\\cvskillsStart\n",
    ).replace("\\end{itemize}\n", "\\end{itemize}\n\\cvskillsEnd\n");
    const { result } = await validatedOnEngine(source, ANSWERS, {}, cls);
    const { checks, package: pkg, document } = ok(result);
    const { sections } = document.resume;
    const at = sections.findIndex((section) => section.kind === "list");
    const list = sections[at];
    if (list === undefined || list.kind !== "list") throw new Error("no list section");
    expect(list.extras?.before).toContain("\\cvskillsStart");
    expect(sections[at + 1]?.kind).toBe("locked");
    expect(checks.repeatable).toContainEqual({ kind: "section.list", added: true, removed: false });
    for (const unit of checks.repeatable.filter((each) => each.kind !== "section.list"))
      expect(unit, unit.kind).toMatchObject({ removed: true });
    expect(checks.decisions.fixed).toEqual(["section.list"]);
    expect(pkg.fixed).toEqual(["section.list"]);
    // The editor refuses to remove the list section, and removes a section of another kind.
    const remove = (id: string) =>
      applyUnder(pkg, document, { type: "structure", op: { op: "removeSection", id } });
    expect(() => remove(list.id)).toThrow(CommandError);
    const summary = sections.find((section) => section.kind === "paragraph");
    if (summary === undefined) throw new Error("no paragraph section");
    expect(remove(summary.id).resume.sections).toHaveLength(sections.length - 1);
  }, 240_000);

  test("assembles an invented XeTeX import from its fonts declared by file", async () => {
    // With no size option and no geometry, the one control is the page's size. The probe compiles
    // a XeTeX document whole; the package's format holds its fonts by file, as item 8's rewrite
    // declares them, so that the checks and the harness compile from it (decision 0023).
    const source = SOURCE.replace("[11pt,letterpaper]", "[letterpaper]").replace(
      "\\usepackage[margin=0.5in]{geometry}\n",
      "\\usepackage{fontspec}\n",
    );
    const zipped = { "cv.tex": strToU8(source), "inventedcv.cls": strToU8(CLASS) };
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const rewrite = rewriteForXetex(taken as Intake, tree);
    if (isRefusal(rewrite)) throw new Error(`the rewrite refused: ${rewrite.message}`);
    const { result, probed } = await validatedOnEngine(source, ANSWERS, { rewrite });
    expect(probed.engine).toBe("xetex");
    expect(probed.path).toBe("whole");
    const { checks, package: pkg } = ok(result);
    expect(pkg.engine).toBe("xetex");
    // fontspec gone, and the rewrite's style files in its place, which the format loads.
    expect(pkg.preamble).not.toContain("{fontspec}");
    expect(Object.keys(pkg.files)).toEqual(
      expect.arrayContaining(["rt-fontspec.sty", "rt-preamble.sty"]),
    );
    expect(checks.outcome).toBe("assembled");
    expect(checks.decisions.slots).toMatchObject({ "command|cvitem|1": "text" });
    expect(checks.required).toContain("command|cventry|1");
    // Its format dumps, so the harness finds nothing.
    expect(checks.findings).toEqual([]);
  }, 120_000);
});
