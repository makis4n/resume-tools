import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Resume } from "@resume-tools/resume-model";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
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
  type Invented,
  inputsOf,
  JAKE_LIKE,
  PREAMBLE,
  REFERENCE,
} from "../test/invented-import";
import type { Finding } from "../validate/harness";
import { type Assembled, assemble, takenOut } from "./assemble";
import { readTree } from "./fonts";
import { type Intake, intake } from "./intake";
import { bodyOf, bodyOfText, buildTree, readBody } from "./parse";
import { probe, probeUses } from "./probe";
import { type GlyphStream, type Reference, type ReferenceItem, reference } from "./reference";
import { isRefusal, type Refusal } from "./refusal";
import { signatures } from "./signatures";
import {
  type Compiled,
  type Compiler,
  MUTATIONS,
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
  /** LaTeX that stops any compile it is in, as a control's value can. */
  stopsOn?: RegExp;
  /** Preamble text that moves every glyph, as a redefinition that changes the page does. */
  shiftsOn?: RegExp;
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
): { broke: boolean; stream?: GlyphStream } {
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
  const margin = /\\geometry\{margin=([\d.]+)in\}/.exec(before)?.[1];
  let shift =
    margin === undefined || blind.has("margins")
      ? 0
      : Math.round((Number(margin) - 0.5) * 72.27 * SP);
  if (pkg !== undefined && behaviour.shiftsOn?.test(pkg.preamble)) shift += 10 * SP;
  const size = blind.has("fontSize")
    ? fontSize
    : (values.fontSize ?? pkg?.controls.fontSize?.default ?? fontSize);
  const body = latex.slice(begin + "\\begin{document}".length, end < 0 ? latex.length : end);
  const items = glyphsOf(body, shift, behaviour.moves ?? new Set()).map((item) =>
    item.kind === "glyph" ? { ...item, size: size * SP } : item,
  );
  if (behaviour.colour !== undefined)
    items.unshift({ kind: "special", h: 0, v: behaviour.colour, text: "color push gray 0.5" });
  const a4 = !blind.has("pageSize") && /\\geometry\{a4paper\}/.test(before);
  return {
    broke: false,
    stream: {
      pages: [{ items }],
      size: a4 ? A4 : LETTER,
      fonts: { tex: ["invented"], native: [], shipped: [] },
      specials: [],
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

  async document(
    pkg: TemplatePackage,
    resume: Resume,
    values: ControlValues = {},
  ): Promise<Compiled> {
    const body = generateBody(pkg, resume, values);
    return { ...(await this.latex(pkg, values, body.latex)), body };
  }
}

/** An invented import validated through the fake, with the harness given. */
async function validated(
  invented: Invented,
  behaviour: Behaviour = {},
  harness?: (assembled: Assembled) => Promise<Finding[]>,
): Promise<{ result: Assembled | Refusal; fake: Fake }> {
  const inputs = inputsOf(invented);
  const setters = takenOut(inputs.intake, inputs.signatures, inputs.answer);
  const original = `${setters.join("\n")}\n\\begin{document}${inputs.tree.source}\\end{document}\n`;
  const fake = new Fake(original, 11, behaviour);
  const liked = await new Fake(original, 11, behaviour).like();
  if (isRefusal(liked)) throw new Error(liked.message);
  const reference: Reference = { ...REFERENCE, ...liked.stream };
  const result = await validateWith({ ...inputs, reference }, fake, harness);
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
      stopsOn: /\\geometry\{a4paper\}/,
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
  }, 60_000);

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
  async function validatedOnEngine(
    source: string,
    answers: readonly AnswerRow[] = ANSWERS,
    more: Partial<ValidationInputs> = {},
  ) {
    const zipped = { "cv.tex": strToU8(source), "inventedcv.cls": strToU8(CLASS) };
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
      ...more,
    });
    return { result, probed };
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
  }, 60_000);

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
  }, 60_000);
});
