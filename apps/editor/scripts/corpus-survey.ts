/**
 * Surveying the corpus (milestone 3 item 2, decision 0018): what each fetched document asks of the
 * engine and its tree, read from its source without compiling it, which is item 3's.
 *
 * For each document: its class, and every package its files load, each held by the document's
 * own files, by the tree, or by neither; the engine it needs, pdfTeX, XeTeX or LuaTeX, or either
 * when it guards on the engine; how it loads its fonts, through fontspec by a family's name or by a
 * file's, through font packages, or not at all, and whether the tree has each family and file; how
 * many macros and environments it defines, in its main file and sources and in its classes and
 * styles; what it needs that the engine lacks: LuaTeX, a bibliography tool, shell escape, images,
 * and the classes, packages and fonts neither it nor the tree holds; and its size. Then counts of
 * documents, per family and in all, as one Markdown table (`surveyTable`).
 *
 * Code a TeX run never reads is left out first: comments, a `\iffalse` block and a `comment`
 * environment, and the branch a class's options rule out of a conditional only they set
 * (`optionValues`). Code under a conditional on the engine, `\ifxetex`, `\iftutex`, `\ifPDFTeX`
 * and their kin, or under an `\ifnum` or `\ifcase` whose numbers ask them, as pandoc's templates
 * ask `\ifnum 0\ifxetex 1\fi\ifluatex 1\fi=0`, is read as each engine takes it (`readSource`), so
 * that a document whose XeTeX branch loads fontspec and whose pdfTeX branch loads Roboto's Type 1
 * fonts, as AltaCV's class and sample do, needs either engine; what it names is what either branch
 * names, and what it needs is what its pdfTeX branches need. A conditional passed as an argument,
 * as `\ifundef{\iftutex}` passes one, is not one. A package loaded in `\IfFileExists`'s branch for
 * a file that is there is loaded only if present, and no need (`references`). That reading is the
 * import pipeline's intake's too, and lives with it, in `src/import/source.ts`.
 *
 * The tree is the engine's manifest (`readTree`): a class or package is there when a `.cls` or
 * `.sty` of its name is, a font file when an OpenType or TrueType file of its name is, and a family
 * when one of the tree's font files names it, as the manifest's table of their tables records
 * (`src/import/fonts.ts`, decision 0023).
 *
 * They are pure functions over text and the tree's file list, so that they can be tested on
 * invented documents; what they return names classes, packages, fonts and commands, and counts,
 * never a document's text, and a name only when it is plainly one (`shownName`). Each takes time
 * linear in the length of what it reads, however a hostile document is laid out.
 */

import {
  FONT_PACKAGES,
  familyInTree,
  fileInTree,
  fileKey,
  fontsOf,
  type Tree,
} from "../src/import/fonts.ts";
import {
  classOptions,
  documentClass,
  engineFrom,
  optionValues,
  type Reference,
  readSource,
  references,
  SOURCE_ENGINES,
  type SourceEngine,
  viewNeeds,
} from "../src/import/source.ts";
import { resolveReference } from "./corpus-collect.ts";
import {
  type CorpusFile,
  extensionOf,
  FAMILIES,
  type Family,
  type FetchReport,
  type FetchState,
  isLive,
  type LiveDocument,
  type Manifest,
  matchingEntries,
  printable,
} from "./corpus-manifest.ts";
import { decode, sha256 } from "./corpus-tex.ts";

/** Where a class or package is found: the document's own files, the tree, or neither. */
export type Held = "document" | "tree" | "missing";

/**
 * How a document loads its fonts: through fontspec by a family's name, or by a file's (a file's
 * name, or `Path=` or `Extension=`), through font packages, or `default` when it does none of these.
 * A document may do several.
 */
export const FONT_LOADING = ["fontspec-name", "fontspec-file", "package", "default"] as const;
export type FontLoading = (typeof FONT_LOADING)[number];

/** A class or package a document loads, and where it is found. */
export interface Loaded {
  name: string;
  held: Held;
}

/** A font a document names, a family or a file, and whether the tree has it. */
export interface NamedFont {
  name: string;
  inTree: boolean;
}

/** A font file a document names, and whether the document's folder holds one of its name too. */
export interface NamedFile extends NamedFont {
  shipped: boolean;
}

/** What the survey finds in one document. */
export interface DocumentSurvey {
  id: string;
  family: Family;
  /** Its `\documentclass`, or null when a macro builds the name. */
  class: Loaded | null;
  /** The classes its own classes load with `\LoadClass`. */
  baseClasses: Loaded[];
  /** Every package its files load with `\usepackage` or `\RequirePackage`, in name order. */
  packages: Loaded[];
  /**
   * The packages its engine's branches load only in `\IfFileExists`'s branch for a file that is
   * there, in name order: TeX loads each only when the tree or the document has it, so one the tree
   * lacks is loaded only if present, and no need.
   */
  optional: Loaded[];
  engine: SourceEngine;
  fonts: {
    loading: FontLoading[];
    /** The font packages among its packages. */
    packages: string[];
    /** The families fontspec loads by name, and the files it loads by file. */
    families: NamedFont[];
    files: NamedFile[];
  };
  /**
   * How many `\newcommand`, `\renewcommand`, `\providecommand`, `\NewDocumentCommand`,
   * `\DeclareDocumentCommand`, `\def` and `\newenvironment` its main file and the sources it
   * inputs hold, and how many its classes and styles hold.
   */
  macros: { main: number; styles: number };
  /** What it needs that the engine lacks, on the engine it needs. */
  needs: {
    luatex: boolean;
    /**
     * biber or bibtex, for `\addbibresource`, `\bibliography`, `\printbibliography` or
     * `\bibliographystyle`.
     */
    bibliography: boolean;
    /**
     * `calls` when its code runs a program, through `\write18`, minted and their kin; `hint` when
     * only a comment asks for `-shell-escape`; null when neither.
     */
    shellEscape: "calls" | "hint" | null;
    /**
     * Images: `\includegraphics` in its main file or sources, or images beside it, which the
     * manifest counts; `includesGraphics` and `imageFiles` say which.
     */
    images: boolean;
    includesGraphics: boolean;
    imageFiles: number;
    /** The classes, packages and fonts that neither it nor the tree holds. */
    classes: string[];
    packages: string[];
    fonts: string[];
  };
  /** The main file's bytes and the files fetched; its pages wait for item 3's compile. */
  size: { main: number; files: number; pages: null };
}

/** A document the survey did not read, and why: its fetch state, or its files changed on disk. */
export interface Skipped {
  id: string;
  family: Family;
  state: Exclude<FetchState, "fetched"> | "unreadable";
}

export interface CorpusSurvey {
  documents: DocumentSurvey[];
  skipped: Skipped[];
}

// What a source needs.

const BIBLIOGRAPHY =
  /\\(?:addbibresource|bibliography|printbibliography|bibliographystyle)(?![A-Za-z@])/;

/** Commands and packages that run programs, which shell escape allows. */
const SHELL_COMMANDS = /\\(?:write18|ShellEscape|tikzexternalize)(?![A-Za-z@])/;
const SHELL_PACKAGES = new Set([
  ...["minted", "svg", "gnuplottex", "pythontex", "markdown", "auto-pst-pdf", "pstool"],
  "shellesc",
]);
/** A comment asking for shell escape, as `% !TEX options = -shell-escape` does. */
const SHELL_HINT = /-shell-escape|-enable-write18/;

const INCLUDES_GRAPHICS = /\\includegraphics(?![A-Za-z@])/;

const DEFINITIONS =
  /\\(?:newcommand|renewcommand|providecommand|NewDocumentCommand|DeclareDocumentCommand|def|newenvironment)(?![A-Za-z@])/g;

// A document.

/** The files a class or package of the document is found in: its own `.cls` and `.sty`. */
const STYLE_EXTENSIONS = new Set([".cls", ".sty", ".def", ".clo", ".fd"]);

const unique = (names: readonly string[]) => [...new Set(names)].sort();

/** What the survey shows for a name it will not print (`shownName`). */
export const UNPRINTABLE = "(unprintable name)";

/**
 * A name as the survey prints it and writes it: letters, digits, spaces and `._/+-`, at most 64
 * characters, which every class, package, font and command name the corpus gives fits. Any other
 * is shown as UNPRINTABLE and counted all the same, so that no line break, pipe or run of a
 * document's text a hostile source puts in a name reaches the table or the JSON.
 */
export function shownName(name: string): string {
  return /^[A-Za-z0-9 ._/+-]{1,64}$/.test(name) ? name : UNPRINTABLE;
}

/** Items in name order, once each, their names as shown (`shownName`). */
function shown<T extends { name: string }>(items: readonly T[]): T[] {
  const kept = new Map<string, T>();
  for (const item of items) {
    const each = { ...item, name: shownName(item.name) };
    kept.set(JSON.stringify(each), each);
  }
  return [...kept.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Names in order, once each, as shown (`shownName`). */
const shownNames = (names: readonly string[]) => unique(names.map(shownName));

/** A document's file as the survey reads it. */
export interface SourceFile {
  path: string;
  text: string;
}

/**
 * Survey one document from its files, the main file first, as the manifest lists them, and the
 * tree.
 */
export function surveyDocument(
  doc: LiveDocument,
  files: readonly SourceFile[],
  tree: Tree,
): DocumentSurvey {
  const paths = new Set(doc.files.map((file) => file.path));
  const texts = files.filter((file) => extensionOf(file.path) !== ".bib");
  const mainText = texts.find((file) => file.path === doc.main)?.text ?? "";
  const known = optionValues(
    texts.map((file) => ({ text: file.text, isClass: extensionOf(file.path) === ".cls" })),
    classOptions(mainText),
  );
  const read = texts.map((file) => ({ ...file, reading: readSource(file.text, known) }));
  const guarded = read.some((file) => file.reading.guarded);

  // What a view of the document loads: its packages, and the classes its classes load.
  const loads = (view: (file: (typeof read)[number]) => string) =>
    read.flatMap((file) =>
      references(view(file)).map((reference) => ({ reference, caller: file.path })),
    );
  const heldAs = (reference: Reference, caller: string): Held => {
    if (resolveReference(reference, caller, doc.main, paths) !== undefined) return "document";
    const extension = reference.kind === "class" ? ".cls" : ".sty";
    const file = reference.name.endsWith(extension)
      ? reference.name
      : `${reference.name}${extension}`;
    return !file.includes("/") && tree.styles.has(file) ? "tree" : "missing";
  };
  // Each package, where it is, and whether it is loaded only if present: every load of it is in
  // `\IfFileExists`'s branch for a file that is there, so TeX loads it only when it is not missing.
  const packagesOf = (view: (file: (typeof read)[number]) => string) => {
    const found = new Map<string, { held: Held; optional: boolean }>();
    for (const { reference, caller } of loads(view)) {
      if (reference.kind !== "package") continue;
      const seen = found.get(reference.name);
      if (seen) seen.optional &&= reference.optional === true;
      else
        found.set(reference.name, {
          held: heldAs(reference, caller),
          optional: reference.optional === true,
        });
    }
    return found;
  };
  /** The packages TeX loads of those: all but the ones loaded only if present that are missing. */
  const loadedOf = (view: (file: (typeof read)[number]) => string) =>
    [...packagesOf(view)]
      .filter(([, each]) => !each.optional || each.held !== "missing")
      .map(([name]) => name);
  const baseClassesOf = (view: (file: (typeof read)[number]) => string) => {
    const found = new Map<string, Held>();
    for (const { reference, caller } of loads(view))
      if (
        reference.kind === "class" &&
        extensionOf(caller) === ".cls" &&
        !found.has(reference.name)
      )
        found.set(reference.name, heldAs(reference, caller));
    return found;
  };

  // The engine: what the pdfTeX branches need, and failing pdfTeX, what the XeTeX ones need.
  const needsOf = (view: (file: (typeof read)[number]) => string) =>
    viewNeeds(read.map(view), loadedOf(view));
  const engine = engineFrom(
    needsOf((file) => file.reading.pdftex),
    needsOf((file) => file.reading.xetex),
    guarded,
  );
  // What it needs is read in the view of its engine: pdfTeX's for either, XeTeX's for XeTeX.
  const view = (file: (typeof read)[number]) =>
    engine === "xetex"
      ? file.reading.xetex
      : engine === "luatex"
        ? file.reading.live
        : file.reading.pdftex;
  const live = (file: (typeof read)[number]) => file.reading.live;

  const main = read.find((file) => file.path === doc.main);
  const className = main ? documentClass(main.reading.live) : undefined;
  const cls: Loaded | null =
    className === undefined
      ? null
      : { name: className, held: heldAs({ kind: "class", name: className }, doc.main) };

  const packages = packagesOf(live);
  const fontPackages = [...packages.keys()].filter(
    (name) => FONT_PACKAGES.has(name) || tree.fontPackages.has(name),
  );
  const shipped = new Set(doc.assets.map(fileKey));
  const fontsIn = (select: (file: (typeof read)[number]) => string) => {
    const found = read.map((file) => fontsOf(select(file)));
    return {
      families: unique(found.flatMap((each) => each.families)),
      files: unique(found.flatMap((each) => each.files)),
    };
  };
  const fonts = fontsIn(live);
  const loading: FontLoading[] = [];
  if (fonts.families.length > 0) loading.push("fontspec-name");
  if (fonts.files.length > 0) loading.push("fontspec-file");
  if (fontPackages.length > 0) loading.push("package");
  if (loading.length === 0) loading.push("default");

  const sources = read.filter((file) => !STYLE_EXTENSIONS.has(extensionOf(file.path)));
  const styles = read.filter((file) => STYLE_EXTENSIONS.has(extensionOf(file.path)));
  const definitions = (files: typeof read) =>
    files.reduce((sum, file) => sum + (file.reading.live.match(DEFINITIONS)?.length ?? 0), 0);

  const needed = fontsIn(view);
  const neededPackages = [...packagesOf(view)];
  const includesGraphics = sources.some((file) => INCLUDES_GRAPHICS.test(view(file)));
  const shellCalls =
    read.some((file) => SHELL_COMMANDS.test(view(file))) ||
    loadedOf(view).some((name) => SHELL_PACKAGES.has(name));
  const missing = (found: ReadonlyMap<string, Held>) =>
    [...found].filter(([, held]) => held === "missing").map(([name]) => name);

  return {
    id: doc.id,
    family: doc.family,
    class: cls && { name: shownName(cls.name), held: cls.held },
    baseClasses: shown([...baseClassesOf(live)].map(([name, held]) => ({ name, held }))),
    packages: shown([...packages].map(([name, { held }]) => ({ name, held }))),
    optional: shown(
      neededPackages
        .filter(([, { optional }]) => optional)
        .map(([name, { held }]) => ({ name, held })),
    ),
    engine,
    fonts: {
      loading,
      packages: shownNames(fontPackages),
      families: shown(fonts.families.map((name) => ({ name, inTree: familyInTree(tree, name) }))),
      files: shown(
        fonts.files.map((name) => ({
          name,
          inTree: fileInTree(tree, name),
          shipped: shipped.has(fileKey(name)),
        })),
      ),
    },
    macros: { main: definitions(sources), styles: definitions(styles) },
    needs: {
      luatex: engine === "luatex",
      bibliography: read.some((file) => BIBLIOGRAPHY.test(view(file))),
      shellEscape: shellCalls
        ? "calls"
        : sources.some((file) => SHELL_HINT.test(file.text))
          ? "hint"
          : null,
      images: includesGraphics || doc.images > 0,
      includesGraphics,
      imageFiles: doc.images,
      classes: shownNames([
        ...(cls?.held === "missing" ? [cls.name] : []),
        ...missing(baseClassesOf(view)),
      ]),
      packages: shownNames(
        neededPackages
          .filter(([, { held, optional }]) => held === "missing" && !optional)
          .map(([name]) => name),
      ),
      fonts: shownNames([
        ...needed.families.filter((name) => !familyInTree(tree, name)),
        ...needed.files.filter((name) => !fileInTree(tree, name)),
      ]),
    },
    size: { main: doc.files[0]?.bytes ?? 0, files: doc.files.length, pages: null },
  };
}

// The corpus.

export interface SurveyOptions {
  manifest: Manifest;
  /** The last fetch's report; a document it does not mark fetched is skipped. */
  report: FetchReport | undefined;
  tree: Tree;
  /** A document's file as the fetch wrote it, or undefined when it cannot be read. */
  read: (doc: LiveDocument, file: CorpusFile) => Uint8Array | undefined;
}

/**
 * Survey every document the last fetch marks fetched, in the manifest's order; the others, and one
 * whose file is gone or differs from its hash, are counted apart and skipped. A withdrawn document
 * is no longer the corpus's and is neither.
 */
export function surveyCorpus(options: SurveyOptions): CorpusSurvey {
  const { manifest, tree } = options;
  const entries = matchingEntries(manifest, options.report);
  const documents: DocumentSurvey[] = [];
  const skipped: Skipped[] = [];
  for (const doc of manifest.documents.filter(isLive)) {
    const state = entries.get(doc.id)?.state ?? "pending";
    if (state !== "fetched") {
      skipped.push({ id: doc.id, family: doc.family, state });
      continue;
    }
    const sources: SourceFile[] = [];
    for (const file of doc.files) {
      const bytes = options.read(doc, file);
      if (!bytes || bytes.length !== file.bytes || sha256(bytes) !== file.sha256) break;
      sources.push({ path: file.path, text: decode(bytes) });
    }
    if (sources.length < doc.files.length)
      skipped.push({ id: doc.id, family: doc.family, state: "unreadable" });
    else documents.push(surveyDocument(doc, sources, tree));
  }
  return { documents, skipped };
}

// The table.

/** The table's columns: each family, then all of them. */
const COLUMNS = [...FAMILIES, "all"] as const;

/**
 * The last column's heading, which a package's row fills: of all the documents, how many load it
 * only if present (`DocumentSurvey.optional`), where the others count those that need it.
 */
const OPTIONAL_COLUMN = "loaded only if present";

/** A name as a table's cell shows it, in code; the table ranks and counts names as shown. */
const cell = (name: string) => `\`${name}\``;

/** Whether a document lacks nothing of the engine's: no class, package or font, and not LuaTeX. */
export const lacksNothing = (row: DocumentSurvey) =>
  row.needs.classes.length === 0 &&
  row.needs.packages.length === 0 &&
  row.needs.fonts.length === 0 &&
  !row.needs.luatex;

/** The packages a document loads only if present that the tree lacks, as shown. */
const optionalMissing = (row: DocumentSurvey) =>
  row.optional.filter(({ held }) => held === "missing").map(({ name }) => shownName(name));

/** The packages, fonts and classes a document names, as shown (`shownName`). */
const neededPackages = (row: DocumentSurvey) => row.needs.packages.map(shownName);
const neededFonts = (row: DocumentSurvey) => row.needs.fonts.map(shownName);
const className = (row: DocumentSurvey) => (row.class ? [shownName(row.class.name)] : []);

/** How many of the documents, of each family and in all, a test is true of. */
function counts<T extends { family: Family }>(rows: readonly T[], test: (row: T) => boolean) {
  return COLUMNS.map(
    (column) =>
      rows.filter((row) => (column === "all" || row.family === column) && test(row)).length,
  );
}

/** The names the documents give, most documents first, then by name, the first `top`. */
function ranked(
  rows: readonly DocumentSurvey[],
  namesOf: (row: DocumentSurvey) => string[],
  top: number,
) {
  const tally = new Map<string, number>();
  for (const row of rows)
    for (const name of new Set(namesOf(row))) tally.set(name, (tally.get(name) ?? 0) + 1);
  return [...tally]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, top)
    .map(([name]) => name);
}

/** How many top packages and fonts the tree lacks, and top classes, the table lists. */
export const TOP_MISSING = 25;
export const TOP_CLASSES = 10;

const ENGINE_LABELS: Readonly<Record<SourceEngine, string>> = {
  pdftex: "Engine: pdfTeX",
  xetex: "Engine: XeTeX",
  luatex: "Engine: LuaTeX",
  both: "Engine: either, guarded on the engine",
};

const LOADING_LABELS: Readonly<Record<FontLoading, string>> = {
  "fontspec-name": "Fonts: fontspec, by name",
  "fontspec-file": "Fonts: fontspec, by file",
  package: "Fonts: font packages",
  default: "Fonts: none loaded",
};

/**
 * The survey as one Markdown table of documents, per family and in all: how many were surveyed and
 * skipped, the engines, how fonts are loaded (a document may load them several ways), what they
 * need that the engine lacks and how many lack nothing, then the packages the tree lacks that most
 * documents load, with how many need each and how many load it only if present, the fonts the tree
 * lacks that most need, and the classes most use. It names classes, packages, fonts and counts,
 * never a document's text, and each line is one line, whatever a name holds (`printable`).
 */
export function surveyTable(survey: CorpusSurvey): string {
  const rows = survey.documents;
  const line = (label: string, values: readonly (number | string)[], last: number | string = "") =>
    `| ${label} | ${[...values, last].join(" | ")} |`;
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const count = (label: string, test: (row: DocumentSurvey) => boolean) =>
    line(label, counts(rows, test));
  const lines = [
    line("", COLUMNS, OPTIONAL_COLUMN),
    `|---|${[...COLUMNS, OPTIONAL_COLUMN].map(() => "--:").join("|")}|`,
    count("Documents surveyed", () => true),
    line(
      "Skipped: not fetched, or changed on disk",
      counts(survey.skipped, () => true),
    ),
    ...SOURCE_ENGINES.map((engine) => count(ENGINE_LABELS[engine], (row) => row.engine === engine)),
    ...FONT_LOADING.map((kind) =>
      count(LOADING_LABELS[kind], (row) => row.fonts.loading.includes(kind)),
    ),
    count("Needs a class the tree lacks", (row) => row.needs.classes.length > 0),
    count("Needs a package the tree lacks", (row) => row.needs.packages.length > 0),
    count("Needs a font the tree lacks", (row) => row.needs.fonts.length > 0),
    count("Needs LuaTeX", (row) => row.needs.luatex),
    count("Lacks nothing: no class, package or font the tree lacks, nor LuaTeX", lacksNothing),
    count("Needs biber or bibtex", (row) => row.needs.bibliography),
    count("Needs shell escape", (row) => row.needs.shellEscape !== null),
    count("Needs shell escape only by a comment's hint", (row) => row.needs.shellEscape === "hint"),
    count(
      "Has images: calls `\\includegraphics` or has image files beside it",
      (row) => row.needs.images,
    ),
    count(
      "Calls `\\includegraphics` in its main file or sources",
      (row) => row.needs.includesGraphics,
    ),
    section(`Packages the tree lacks, top ${TOP_MISSING}`),
    ...ranked(rows, (row) => [...neededPackages(row), ...optionalMissing(row)], TOP_MISSING).map(
      (name) =>
        line(
          cell(name),
          counts(rows, (row) => neededPackages(row).includes(name)),
          rows.filter((row) => optionalMissing(row).includes(name)).length,
        ),
    ),
    section(`Fonts the tree lacks, top ${TOP_MISSING}`),
    ...ranked(rows, neededFonts, TOP_MISSING).map((name) =>
      count(cell(name), (row) => neededFonts(row).includes(name)),
    ),
    section(`Classes, top ${TOP_CLASSES}`),
    ...ranked(rows, className, TOP_CLASSES).map((name) =>
      count(cell(name), (row) => className(row).includes(name)),
    ),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}
