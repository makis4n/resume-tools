/**
 * The XeTeX rewrite of an import's fonts (milestone 3 item 8, decision 0023): a resume that sets its
 * fonts through fontspec, by name or by file, or through a font package that loads it, becomes one
 * whose fonts are NFSS families declared by file (decision 0003's loop, decision 0014's `fonts`),
 * so that its preamble dumps as a format and every compile after finds each font by file.
 *
 * fontspec's commands, `\setmainfont`, `\setsansfont`, `\setmonofont`, `\newfontfamily` and its kin,
 * `\newfontface` and its kin, `\fontspec` and `\defaultfontfeatures`, are read where XeTeX would
 * run them, in the preamble and the class and style files the upload holds, in the order TeX loads
 * them, and in the body; each family is what fontspec would declare (`fontspec.ts`), from the tree's
 * fonts (`FontIndex`); and each command becomes what selects it: `\rmdefault`, `\sfdefault` or
 * `\ttdefault` set to the family, with the bold series fontspec sets for it, a command that selects
 * it (`\NewDocumentCommand` as fontspec defines one), or the selection itself. The font packages
 * that load fontspec on XeTeX, roboto, sourcesanspro, lato, fontawesome and plex, and fontawesome5,
 * which loads its fonts as it starts, become a style file of the rewrite's own, `rt-<package>.sty`,
 * that does what the package does on XeTeX with the families declared by file. fontspec,
 * unicode-math and `\setmathfont` go: mathematics stays on the stock math fonts. The preamble gains
 * `\RequirePackage[OT1]{fontenc}` before the class, so that nothing selects a native font before
 * the format is dumped, and `rt-fontspec.sty` at its end, which makes TU the encoding again and sets
 * mathematics up as fontspec does at `\begin{document}`. Everything else stays byte for byte.
 *
 * What it cannot reproduce it refuses, naming the font or the feature: a font the tree does not
 * have, an option fontspec's emulation does not know (`fontspec.ts`), and the packages that need
 * fontspec itself, polyglossia and xeCJK among them.
 *
 * It is a function of the intake and the tree, and runs in the browser and in Node alike.
 */

import type { FontAdjust, FontFamily, FontShape } from "../templates/package";
import type { Tree } from "./fonts";
import {
  type Defaults,
  type FamilyKind,
  type FamilySpec,
  FontIndex,
  familyFor,
  htmlColour,
  initialDefaults,
  keyVals,
  setDefaults,
  splitList,
  type Unreproducible,
} from "./fontspec";
import { decodeText, encodeLike, type Intake } from "./intake";
import { joinPath } from "./paths";
import { type Refusal, refusal } from "./refusal";
import { blankComments, bracketed, group, xetexSkipped } from "./source";

/** A XeTeX import with its fonts declared by file. */
export interface XetexRewrite {
  /** The main file's preamble, up to `\begin{document}`, rewritten. */
  preamble: string;
  /** The main file from `\begin{document}` on, with any fontspec command in it rewritten. */
  body: string;
  /**
   * The job's files the rewrite changed, the upload's class and style files that load fontspec,
   * and those it adds, its own style files, by their paths in the job.
   */
  files: Record<string, Uint8Array>;
  /** The families, declared by file, which the format declares after the preamble. */
  fonts: FontFamily[];
  /** What a developer, or the report, may want to know: plain English, naming fonts at most. */
  warnings: string[];
  /** The font files of the tree unicode-math set mathematics in, which the stock fonts replace. */
  mathFonts: string[];
  /**
   * Where unicode-math was taken out, the preamble and files with it kept, and its `\setmathfont`,
   * which the check compiles to tell a difference unicode-math alone makes (`xetex-check.ts`).
   */
  maths?: { preamble: string; files: Record<string, Uint8Array> };
  /** What the corpus runner counts: the kinds of feature the families carry, each once per family. */
  features: Record<string, number>;
}

/**
 * Where a text of the job is edited: from `start` to before `end`, to `text`; or to `maths` in the
 * rewrite that keeps unicode-math (`XetexRewrite.maths`), when that differs.
 */
interface Edit {
  start: number;
  end: number;
  text: string;
  maths?: string;
}

/** A text the rewrite reads: the main file's, or a file of the job's by its path. */
interface Source {
  path: string;
  text: string;
  /** The same text with its comments blanked, every character in its place (`blankComments`). */
  blanked: string;
  /** The spans XeTeX does not read (`xetexSkipped`). */
  skipped: [number, number][];
  edits: Edit[];
}

/** Packages that need fontspec itself, which the rewrite cannot do without. */
const NEEDS_FONTSPEC = new Set([
  ...["polyglossia", "xeCJK", "xecjk", "mathspec", "xltxtra", "realscripts", "metalogo"],
  ...["xecolor", "fontsetup", "fontspec-xetex", "ctex", "xeCJKfntef", "fontwrap", "iffont"],
  ...["arabxetex", "bidi", "roboto-mono", "roboto-serif", "unicode-math-xetex"],
]);

/** fontspec's commands that change what its options mean, which the rewrite cannot follow. */
const REDEFINING = new Set([
  ...["newfontfeature", "newAATfeature", "newopentypefeature", "newICUfeature"],
  ...["aliasfontfeature", "aliasfontfeatureoption", "newfontscript", "newfontlanguage"],
  ...["DeclareFontExtensions", "addfontfeature", "addfontfeatures"],
]);

/** The commands the rewrite reads, as they appear in a source. */
const COMMANDS =
  /\\(documentclass|LoadClass|LoadClassWithOptions|usepackage|RequirePackage|RequirePackageWithOptions|input|include|setmainfont|setromanfont|setsansfont|setmonofont|newfontfamily|renewfontfamily|setfontfamily|providefontfamily|newfontface|renewfontface|setfontface|providefontface|fontspec|defaultfontfeatures|setmathfont|setboldmathfont|setmathrm|setboldmathrm|setmathsf|setmathtt|definecolor|colorlet|newfontfeature|newAATfeature|newopentypefeature|newICUfeature|aliasfontfeature|aliasfontfeatureoption|newfontscript|newfontlanguage|DeclareFontExtensions|addfontfeatures?|begin)(?![A-Za-z@])/g;

/** fontspec's commands that set a family's kind, and the default each sets. */
const KIND_COMMANDS: Readonly<Record<string, FamilyKind>> = {
  setmainfont: "rm",
  setromanfont: "rm",
  setsansfont: "sf",
  setmonofont: "tt",
};

/** fontspec's commands that define a command for a family, and how fontspec defines it. */
const DEFINING: Readonly<Record<string, { define: string; face: boolean }>> = {
  newfontfamily: { define: "NewDocumentCommand", face: false },
  renewfontfamily: { define: "RenewDocumentCommand", face: false },
  setfontfamily: { define: "DeclareDocumentCommand", face: false },
  providefontfamily: { define: "ProvideDocumentCommand", face: false },
  newfontface: { define: "NewDocumentCommand", face: true },
  renewfontface: { define: "RenewDocumentCommand", face: true },
  setfontface: { define: "DeclareDocumentCommand", face: true },
  providefontface: { define: "ProvideDocumentCommand", face: true },
};

/** The default math font unicode-math sets when a document names none. */
const DEFAULT_MATH_FONT = "latinmodern-math.otf";

/**
 * Rewrite a XeTeX import's fonts by file, from the tree's fonts; or refuse it, naming the font or
 * the feature the rewrite cannot reproduce.
 */
export function rewriteForXetex(intake: Intake, tree: Tree): XetexRewrite | Refusal {
  return new Rewriter(intake, tree).run();
}

/** A reason to stop, carried out of the walk. */
class Stop {
  constructor(readonly refusal: Refusal) {}
}

class Rewriter {
  private readonly index: FontIndex;
  private readonly defaults: Defaults = initialDefaults();
  private readonly colours = new Map<string, string>();
  private readonly families: FontFamily[] = [];
  private readonly bySignature = new Map<string, string>();
  private readonly names = new Set<string>();
  private readonly sources = new Map<string, Source>();
  private readonly loaded = new Set<string>();
  private readonly added: Record<string, string> = {};
  private readonly warnings: string[] = [];
  private readonly features: Record<string, number> = {};
  private readonly mentioned: Set<string>;
  private fontspec = false;
  private noMath = false;
  private unicodeMath = false;
  private mathFonts: string[] = [];

  constructor(
    private readonly intake: Intake,
    tree: Tree,
  ) {
    this.index = new FontIndex(tree.fonts);
    // Every control word the document's own sources name, which says which of a font package's
    // families it uses.
    const texts = [intake.main.text, ...this.jobTexts()];
    this.mentioned = new Set(
      texts.flatMap((text) => [...text.matchAll(/\\([A-Za-z@]+)/g)].map((m) => m[1] ?? "")),
    );
  }

  /** The job's text files, as text. */
  private jobTexts(): string[] {
    return Object.entries(this.intake.files)
      .filter(([path]) => /\.(?:tex|cls|sty)$/i.test(path))
      .map(([, bytes]) => decodeText(bytes));
  }

  run(): XetexRewrite | Refusal {
    try {
      return this.rewrite();
    } catch (error) {
      if (error instanceof Stop) return error.refusal;
      throw error;
    }
  }

  private rewrite(): XetexRewrite {
    const main = this.source("", this.intake.main.text);
    const begin = this.beginDocument(main);
    if (begin === undefined)
      throw new Stop(refusal("feature", "a document that begins in another file"));
    this.read(main, 0, begin, true);
    const documentClass = this.firstCommand(main, /\\documentclass(?![A-Za-z@])/g, begin);
    if (documentClass === undefined)
      throw new Stop(refusal("feature", "a document without \\documentclass"));
    main.edits.push({
      start: documentClass,
      end: documentClass,
      text: "\\RequirePackage{rt-preamble}\n",
    });
    this.added["rt-preamble.sty"] = PREAMBLE_STAND_IN;
    this.read(main, begin, main.text.length, false);

    this.added["rt-fontspec.sty"] = fontspecStandIn(
      this.fontspec && !this.noMath && !this.unicodeMath,
      this.unicodeMath
        ? [...this.mentioned]
            .filter((word) => /^[A-Za-z]+$/.test(word))
            .sort()
            .map((word): [string, string] => [UNICODE_MATH_ALIASES[word] ?? word, word])
        : [],
    );
    const { preamble, body, files } = this.assemble(main, begin, false);
    if (this.unicodeMath)
      this.warnings.push(
        "unicode-math is left out: mathematics is set in TeX's own math fonts, not the resume's.",
      );
    const kept = this.unicodeMath ? this.assemble(main, begin, true) : undefined;
    return {
      preamble,
      body,
      files,
      fonts: this.families,
      warnings: this.warnings,
      mathFonts: this.unicodeMath ? this.mathFonts : [],
      features: this.features,
      ...(kept === undefined ? {} : { maths: { preamble: kept.preamble, files: kept.files } }),
    };
  }

  /**
   * The rewritten preamble, body and files, with every edit, or with unicode-math and
   * `\setmathfont` kept (`maths`).
   */
  private assemble(
    main: Source,
    begin: number,
    maths: boolean,
  ): { preamble: string; body: string; files: Record<string, Uint8Array> } {
    const chosen = (edits: readonly Edit[]) =>
      edits.map((edit) =>
        maths && edit.maths !== undefined ? { ...edit, text: edit.maths } : edit,
      );
    const edits = chosen(main.edits);
    const text = applyEdits(main.text, edits);
    const shift = edits
      .filter((edit) => edit.end <= begin)
      .reduce((sum, edit) => sum + edit.text.length - (edit.end - edit.start), 0);
    const preamble = `${text.slice(0, begin + shift)}\\RequirePackage{rt-fontspec}\n`;
    const body = text.slice(begin + shift);
    const files: Record<string, Uint8Array> = {};
    for (const [path, source] of this.sources) {
      if (path === "" || source.edits.length === 0) continue;
      const original = this.intake.files[path] ?? new Uint8Array();
      const rewritten = applyEdits(source.text, chosen(source.edits));
      files[path] = encodeLike(original, rewritten) ?? new TextEncoder().encode(rewritten);
    }
    for (const [path, content] of Object.entries(this.added))
      files[path] = new TextEncoder().encode(content);
    return { preamble, body, files };
  }

  /** A text of the job, read once. */
  private source(path: string, text: string): Source {
    const had = this.sources.get(path);
    if (had) return had;
    const blanked = blankComments(text);
    const source: Source = { path, text, blanked, skipped: xetexSkipped(blanked), edits: [] };
    this.sources.set(path, source);
    return source;
  }

  /** Where `\begin{document}` is in the main file, outside what XeTeX skips. */
  private beginDocument(main: Source): number | undefined {
    for (const match of main.blanked.matchAll(/\\begin\s*\{document\}/g))
      if (!skippedAt(main.skipped, match.index)) return match.index;
    return undefined;
  }

  /** The first command a pattern finds in a source before `stop`, outside what XeTeX skips. */
  private firstCommand(source: Source, pattern: RegExp, stop: number): number | undefined {
    for (const match of source.blanked.matchAll(pattern))
      if (match.index < stop && !skippedAt(source.skipped, match.index)) return match.index;
    return undefined;
  }

  /**
   * Read a source from `from` to before `to`, as TeX runs it: each command the rewrite reads, a
   * file of the job it loads read where it loads it; `preamble` when this is the preamble's code.
   */
  private read(source: Source, from: number, to: number, preamble: boolean) {
    const { blanked } = source;
    const pattern = new RegExp(COMMANDS.source, "g");
    pattern.lastIndex = from;
    for (
      let match = pattern.exec(blanked);
      match && match.index < to;
      match = pattern.exec(blanked)
    ) {
      const start = match.index;
      if (skippedAt(source.skipped, start)) continue;
      const command = match[1] ?? "";
      const at = start + match[0].length;
      const end = this.command(source, command, start, at, preamble);
      if (end !== undefined && end > pattern.lastIndex) pattern.lastIndex = end;
    }
  }

  /** Handle one command at `start`, its arguments from `at`; the index after what it read. */
  private command(
    source: Source,
    command: string,
    start: number,
    at: number,
    preamble: boolean,
  ): number | undefined {
    const text = source.blanked;
    // A command a definition, a `\let` or a test names is not run where it stands, as AltaCV's
    // class lets `\newfontfamily` do nothing while academicons loads.
    if (named(text, start)) return at;
    if (REDEFINING.has(command)) throw new Stop(refusal("feature", `\\${command}`));
    switch (command) {
      case "begin":
        return undefined;
      case "documentclass":
      case "LoadClass":
      case "LoadClassWithOptions": {
        const name = mandatory(text, at);
        if (name && preamble) this.loadFile(`${name.value.trim()}.cls`);
        return name?.end;
      }
      case "input":
      case "include": {
        const name = group(text, at);
        if (name && preamble) {
          const file = name.value.trim();
          this.loadFile(/\.[A-Za-z]+$/.test(file) ? file : `${file}.tex`);
        }
        return name?.end;
      }
      case "usepackage":
      case "RequirePackage":
      case "RequirePackageWithOptions":
        return this.usepackage(source, command, start, at, preamble);
      case "defaultfontfeatures": {
        let after = at;
        const plus = text[after] === "+";
        if (plus) after++;
        const targets = bracketed(text, after);
        if (targets) after = targets.end;
        const options = group(text, after);
        if (!options) return undefined;
        setDefaults(this.defaults, plus, targets?.value, options.value);
        source.edits.push({ start, end: options.end, text: "" });
        return options.end;
      }
      case "setmathfont":
      case "setboldmathfont":
      case "setmathrm":
      case "setboldmathrm":
      case "setmathsf":
      case "setmathtt": {
        const call = fontCall(text, at);
        if (!call) return undefined;
        if (command === "setmathfont") this.setMathFont(call.name, call.options);
        source.edits.push({
          start,
          end: call.end,
          text: "",
          maths: source.text.slice(start, call.end),
        });
        return call.end;
      }
      case "definecolor": {
        let after = at;
        const type = bracketed(text, after);
        if (type) after = type.end;
        const name = group(text, after);
        const model = name && group(text, name.end);
        const spec = model && group(text, model.end);
        if (name && model && spec) {
          const hex = htmlColour(model.value.trim(), spec.value);
          if (hex !== undefined) this.colours.set(name.value.trim(), hex);
          return spec.end;
        }
        return undefined;
      }
      case "colorlet": {
        const name = group(text, at);
        const other = name && group(text, name.end);
        if (name && other) {
          const hex = this.colours.get(other.value.trim());
          if (hex !== undefined) this.colours.set(name.value.trim(), hex);
          return other.end;
        }
        return undefined;
      }
      default:
        return this.fontCommand(source, command, start, at);
    }
  }

  /** A class, package or source of the job, read where TeX loads it; once each. */
  private loadFile(name: string) {
    const path = joinPath("", name);
    if (path === undefined || this.loaded.has(path)) return;
    const bytes = this.intake.files[path];
    if (bytes === undefined) return;
    this.loaded.add(path);
    const source = this.source(path, decodeText(bytes));
    this.read(source, 0, source.text.length, true);
  }

  /**
   * `\usepackage` and its kin: fontspec and unicode-math taken out, a font package the rewrite
   * translates put in the place of its own style file (`rt-<package>.sty`), a package that needs
   * fontspec refused, and a package of the job read where it is loaded.
   */
  private usepackage(
    source: Source,
    command: string,
    start: number,
    at: number,
    preamble: boolean,
  ): number | undefined {
    const text = source.blanked;
    const options = bracketed(text, at);
    const names = group(text, options?.end ?? at);
    if (!names) return undefined;
    const date = bracketed(text, names.end);
    const end = date?.end ?? names.end;
    const given = splitList(options?.value ?? "");
    const kept: string[] = [];
    let changed = false;
    let unicodeMath = false;
    const replacements: string[] = [];
    for (const raw of names.value.split(",")) {
      const name = raw.trim();
      if (name === "") continue;
      if (name === "fontspec") {
        changed = true;
        this.fontspec = true;
        if (given.some((option) => option.trim() === "no-math")) this.noMath = true;
        continue;
      }
      if (name === "unicode-math") {
        changed = true;
        unicodeMath = true;
        this.fontspec = true;
        this.unicodeMath = true;
        if (this.mathFonts.length === 0) this.mathFonts = [DEFAULT_MATH_FONT];
        continue;
      }
      if (NEEDS_FONTSPEC.has(name)) throw new Stop(refusal("feature", name));
      const translate = FONT_PACKAGES[name];
      if (translate !== undefined && this.intake.files[`${name}.sty`] === undefined) {
        changed = true;
        if (this.loaded.has(`package:${name}`)) continue;
        this.loaded.add(`package:${name}`);
        const standIn = translate(this, given);
        if (standIn === undefined) {
          kept.push(name);
          continue;
        }
        this.added[`rt-${name}.sty`] = standIn;
        replacements.push(
          `\\${command === "usepackage" ? "usepackage" : "RequirePackage"}{rt-${name}}`,
        );
        continue;
      }
      kept.push(name);
      if (preamble) this.loadFile(`${name}.sty`);
    }
    if (changed) {
      const load = (packages: string[]) =>
        packages.length === 0
          ? ""
          : `\\${command}${options ? `[${options.value}]` : ""}{${packages.join(",")}}${date ? `[${date.value}]` : ""}`;
      const text = [load(kept), ...replacements].join("");
      source.edits.push({
        start,
        end,
        text,
        ...(unicodeMath
          ? { maths: [load([...kept, "unicode-math"]), ...replacements].join("") }
          : {}),
      });
    }
    return end;
  }

  /** unicode-math's `\setmathfont`, whose font's glyphs the stock math fonts replace. */
  private setMathFont(name: string, options: string) {
    const path = keyVals(options).find((each) => each.key === "Path") !== undefined;
    const found =
      /\.(?:otf|ttf)$/i.test(name) || path ? this.index.byFile(name) : this.index.find(name);
    this.mathFonts = [...new Set([...this.mathFonts, found?.file ?? name])];
  }

  /** A fontspec command that declares or selects a family, rewritten; undefined if not one. */
  private fontCommand(
    source: Source,
    command: string,
    start: number,
    at: number,
  ): number | undefined {
    const text = source.blanked;
    const kind = KIND_COMMANDS[command];
    const defining = DEFINING[command];
    let after = at;
    let defined: string | undefined;
    if (defining !== undefined) {
      const cs = /\s*(\\[A-Za-z@]+|\{\s*(\\[A-Za-z@]+)\s*\})/y;
      cs.lastIndex = after;
      const found = cs.exec(text);
      if (!found) return undefined;
      defined = found[2] ?? found[1];
      after = cs.lastIndex;
    } else if (kind === undefined && command !== "fontspec") return undefined;
    const call = fontCall(text, after);
    if (!call) return undefined;
    const options = defining?.face
      ? `BoldFont={},ItalicFont={},SmallCapsFont={},${call.options}`
      : call.options;
    let family: string;
    try {
      family = this.family({ name: call.name, options, ...(kind ? { kind } : {}) });
    } catch (error) {
      // A font or feature a definition's body asks for, which XeTeX meets only if the command is
      // used, stops the compile only then, naming the font, as fontspec would.
      if (!(error instanceof Stop) || !inDefinition(source, start)) throw error;
      const name = error.refusal.name ?? call.name;
      source.edits.push({
        start,
        end: call.end,
        text: `\\PackageError{rt-fonts}{${error.refusal.reason === "font" ? "missing font" : "unreproducible feature"} ${name.replace(/[^A-Za-z0-9 .,=+-]/g, "")}}{}`,
      });
      return call.end;
    }
    let replacement: string;
    if (kind !== undefined) {
      const which = kind === "rm" ? "rm" : kind === "sf" ? "sf" : "tt";
      replacement = `\\DeclareFontSeriesDefault[${which}]{bf}{\\bfdefault}\\def\\${which}default{${family}}\\ignorespaces `;
    } else if (defining !== undefined && defined !== undefined) {
      replacement = `\\${defining.define}${defined}{}{\\fontfamily{${family}}\\fontencoding{TU}\\selectfont}`;
    } else replacement = `\\fontfamily{${family}}\\fontencoding{TU}\\selectfont\\ignorespaces `;
    source.edits.push({ start, end: call.end, text: replacement });
    return call.end;
  }

  /**
   * The NFSS family for a font fontspec asks for, declared once for all that ask for the same
   * shapes; or a refusal, thrown, naming the font or feature that cannot be reproduced.
   */
  family(request: { name: string; options: string; kind?: FamilyKind }): string {
    const spec = familyFor(request, this.defaults, this.index, this.colours);
    if ("unreproducible" in spec) throw new Stop(unreproducible(spec));
    const nfss = /(?:^|,)\s*NFSSFamily\s*=\s*([^,]*)/.exec(request.options)?.[1]?.trim();
    const family = toFamily(spec, "");
    const signature = JSON.stringify([family.shapes, family.features, family.scale, family.adjust]);
    const had = this.bySignature.get(signature);
    if (had !== undefined && nfss === undefined) return had;
    let name: string;
    if (nfss !== undefined) {
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(nfss) || this.names.has(nfss))
        throw new Stop(refusal("feature", "NFSSFamily"));
      name = nfss;
    } else {
      const base = `Rt${request.name
        .replace(/\.[A-Za-z]+$/, "")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 24)}`;
      name = base;
      for (let n = 2; this.names.has(name); n++) name = `${base}${n}`;
    }
    this.names.add(name);
    this.bySignature.set(signature, name);
    this.families.push({ ...family, family: name });
    for (const kind of spec.kinds) this.features[kind] = (this.features[kind] ?? 0) + 1;
    return name;
  }

  /** `\defaultfontfeatures{...}` as a font package sets it. */
  setDefaults(options: string) {
    setDefaults(this.defaults, false, undefined, options);
  }

  /** Whether a source of the document names a control word, which says it uses a package's command. */
  mentions(...words: string[]): boolean {
    return words.some((word) => this.mentioned.has(word.replace(/^\\/, "")));
  }
}

/**
 * Whether the command at `start` is named rather than run: the second or third token of a
 * `\let`, the name a definition gives, or what `\ifx` or `\ifdefined` tests.
 */
function named(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 120), start);
  return (
    /\\(?:let|def|gdef|edef|xdef|ifx|ifdefined|show|meaning|string|noexpand|cs_set_eq:NN|cs_new_eq:NN|cs_gset_eq:NN)\s*$/.test(
      before,
    ) ||
    /\\(?:let|ifx|cs_set_eq:NN|cs_new_eq:NN|cs_gset_eq:NN)\s*\\[A-Za-z@:_]+\s*=?\s*$/.test(
      before,
    ) ||
    /\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|(?:New|Renew|Provide|Declare)DocumentCommand)\*?\s*\{?\s*$/.test(
      before,
    )
  );
}

/**
 * Whether an index falls in the body of a definition, a macro TeX runs only where it is used:
 * `\newcommand` and its kin, and `\def` and its kin, read once for each source.
 */
const definitions = new WeakMap<Source, [number, number][]>();

function inDefinition(source: Source, at: number): boolean {
  let spans = definitions.get(source);
  if (spans === undefined) {
    spans = [];
    const text = source.blanked;
    const definer =
      /\\((?:re)?newcommand|providecommand|DeclareRobustCommand|(?:New|Renew|Provide|Declare)DocumentCommand|g?def|[ex]def)(?![A-Za-z@])/g;
    for (const match of text.matchAll(definer)) {
      const kind = match[1] ?? "";
      let from = match.index + match[0].length;
      const name = /\s*\*?\s*(?:\\[A-Za-z@]+|\{\s*\\[A-Za-z@]+\s*\})/y;
      name.lastIndex = from;
      if (!name.exec(text)) continue;
      from = name.lastIndex;
      if (kind.endsWith("DocumentCommand")) from = group(text, from)?.end ?? from;
      else if (kind.endsWith("def")) {
        // A macro's parameter text, up to its body's brace.
        const brace = text.indexOf("{", from);
        if (brace < 0 || brace - from > 64) continue;
        from = brace;
      } else
        for (
          let option = bracketed(text, from), n = 0;
          option && n < 2;
          option = bracketed(text, from), n++
        )
          from = option.end;
      const body = group(text, from);
      if (body) spans.push([body.end - body.value.length - 1, body.end]);
    }
    definitions.set(source, spans);
  }
  // A span starts at its body's first character, which may be the command itself.
  return spans.some(([start, end]) => at >= start && at < end);
}

/** Whether an index falls in one of a source's skipped spans. */
function skippedAt(spans: readonly [number, number][], at: number): boolean {
  return spans.some(([start, end]) => at >= start && at < end);
}

/** A mandatory argument after any optional ones, with the index after it. */
function mandatory(text: string, at: number): { value: string; end: number } | undefined {
  let after = at;
  for (let option = bracketed(text, after); option; option = bracketed(text, after))
    after = option.end;
  return group(text, after);
}

/**
 * A fontspec command's arguments at `at`: `[options]{font}[options]`, the options joined as
 * fontspec joins them, and the index after the last.
 */
function fontCall(
  text: string,
  at: number,
): { name: string; options: string; end: number } | undefined {
  const before = bracketed(text, at);
  const name = group(text, before?.end ?? at);
  if (!name) return undefined;
  const after = bracketed(text, name.end);
  const options = [before?.value ?? "", after?.value ?? ""]
    .filter((each) => each.trim() !== "")
    .join(",");
  return { name: name.value.trim(), options, end: after?.end ?? name.end };
}

/** Apply a text's edits, which do not overlap, in order. */
function applyEdits(text: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const { start, end, text: replacement } of sorted) {
    if (start < at) continue;
    out += text.slice(at, start) + replacement;
    at = end;
  }
  return out + text.slice(at);
}

/** A refusal for what the emulation cannot reproduce. */
function unreproducible(why: Unreproducible): Refusal {
  return refusal(why.unreproducible === "font" ? "font" : "feature", why.name);
}

/**
 * A family as the package's `fonts` holds it (decision 0014, extended by decision 0023): each
 * shape's file and the features it loads with besides those every shape shares, which the family
 * holds; its scale and adjustments, which every shape of a fontspec family shares.
 */
function toFamily(spec: FamilySpec, name: string): FontFamily {
  const shapes = [...spec.shapes.entries()];
  const lists = shapes.map(([, shape]) => shape.features);
  let common = lists[0] ?? [];
  for (const list of lists) {
    let n = 0;
    while (n < common.length && n < list.length && common[n] === list[n]) n++;
    common = common.slice(0, n);
  }
  const out: Record<string, FontShape> = {};
  for (const [key, shape] of shapes) {
    const own = shape.features.slice(common.length);
    out[key] =
      own.length === 0 ? shape.font.file : { file: shape.font.file, features: own.join(";") };
  }
  const first = shapes[0]?.[1];
  const adjust: FontAdjust | undefined = first?.adjust;
  return {
    family: name,
    shapes: out,
    ...(common.length === 0 ? {} : { features: common.join(";") }),
    ...(first?.scale === undefined ? {} : { scale: first.scale }),
    ...(adjust === undefined ? {} : { adjust }),
  };
}

// The rewrite's own style files.

/**
 * `rt-preamble.sty`, loaded before the class: the preamble set in OT1, whose fonts are TFM fonts, so
 * that the format holds no native font (decision 0003), where XeTeX's LaTeX sets it in TU, whose
 * fonts are native. A native font's quad is its size, which a TFM font's is not, cmr12's being
 * 11.74982 pt at 12 pt; so each TFM font the preamble selects has its quad set to its size, and the
 * lengths a class and its size option set in em as they load, `\leftmargini`, `\labelsep` and
 * `\parindent` among them, come out as XeTeX's LaTeX sets them. `rt-fontspec.sty` takes the hook
 * away where the preamble ends.
 */
const PREAMBLE_STAND_IN = [
  "\\NeedsTeXFormat{LaTeX2e}",
  "\\ProvidesPackage{rt-preamble}[2026/09/27 resume-tools: the preamble in TFM fonts (decision 0023)]",
  "\\def\\rt@quad{\\ifnum\\XeTeXfonttype\\font=\\z@\\fontdimen6\\font=\\f@size\\p@\\fi}",
  "\\AddToHook{selectfont}[rt-preamble]{\\rt@quad}",
  "\\RequirePackage[OT1]{fontenc}",
  "\\endinput",
  "",
].join("\n");

/**
 * `rt-fontspec.sty`, loaded at the end of the rewritten preamble: TU as the encoding again, which
 * `\RequirePackage[OT1]{fontenc}` before the class set aside, unless the document chose another;
 * where fontspec was loaded without its `no-math` option and without unicode-math, mathematics set
 * up as fontspec sets it at `\begin{document}` (fontspec-code-math): the letters and symbols of
 * `legacymaths`, Computer Modern, and the operators and alphabets in the main font; and where
 * unicode-math was loaded, each of its symbols' commands that `symbols` names made to set its
 * character in text, as unicode-math makes it by letting the command be the character at
 * `\begin{document}`, while mathematics keeps TeX's own fonts (`UNICODE_MATH_TEXT`).
 */
function fontspecStandIn(
  maths: boolean,
  symbols: readonly [symbol: string, command: string][],
): string {
  const lines = [
    "\\NeedsTeXFormat{LaTeX2e}",
    "\\ProvidesPackage{rt-fontspec}[2026/09/27 resume-tools: fontspec's fonts by file (decision 0023)]",
    "\\edef\\rt@encoding{\\encodingdefault}\\def\\rt@otone{OT1}",
    "\\ifx\\rt@encoding\\rt@otone\\renewcommand{\\encodingdefault}{TU}\\fi",
    "\\RemoveFromHook{selectfont}[rt-preamble]",
  ];
  if (maths) lines.push(...FONTSPEC_MATHS);
  if (symbols.length > 0) {
    lines.push(...UNICODE_MATH_TEXT);
    for (let at = 0; at < symbols.length; at += 6)
      lines.push(
        symbols
          .slice(at, at + 6)
          .map(([symbol, command]) => `\\rt@want{${symbol}}{${command}}`)
          .join(""),
      );
    lines.push(...UNICODE_MATH_TABLE);
  }
  lines.push("\\endinput", "");
  return lines.join("\n");
}

/**
 * unicode-math lets each of its symbols' commands of the ordinary, alphabetic, binary, relation,
 * punctuation, operator and fence classes be the symbol's character at `\begin{document}`
 * (`\__um_define_math_chars:`), so that one used in text, as Awesome-CV's example sets `\cdotp`
 * between two titles and its class `\bullet` as a list's label, sets the character in the text's
 * font. Here each such command the document names, and each of unicode-math's commands that stands
 * for one (`UNICODE_MATH_ALIASES`), sets the symbol's character in text, and in mathematics is
 * what LaTeX made it, which the stock math fonts set: the command's meaning is kept, and the
 * command becomes one that asks the mode. `\rt@want{<symbol>}{<command>}` names each, each by its
 * name, so that no command of the document's is a token here.
 */
const UNICODE_MATH_TEXT = [
  "\\def\\rt@want#1#2{\\ifcsname rt@want@#1\\endcsname",
  "    \\expandafter\\g@addto@macro\\csname rt@want@#1\\endcsname{,#2}%",
  "  \\else\\expandafter\\def\\csname rt@want@#1\\endcsname{#2}\\fi}",
  "\\edef\\rt@umclasses{\\string\\mathord,\\string\\mathalpha,\\string\\mathbin,\\string\\mathrel,%",
  "  \\string\\mathpunct,\\string\\mathop,\\string\\mathfence,}",
  "\\def\\rt@umtext#1#2{%",
  "  \\expandafter\\global\\expandafter\\let\\csname rt@um@\\string#1\\endcsname#1%",
  "  \\protected\\xdef#1{\\noexpand\\ifmmode",
  "    \\expandafter\\noexpand\\csname rt@um@\\string#1\\endcsname",
  "    \\noexpand\\else\\char#2\\relax\\noexpand\\fi}}",
];

/**
 * unicode-math's commands that stand for another of its symbols' (unicode-math-xetex.sty's
 * `\protected\def\bullet{\smblkcircle}` and the rest), whose character in text is that symbol's.
 */
const UNICODE_MATH_ALIASES: Readonly<Record<string, string>> = {
  to: "rightarrow",
  le: "leq",
  ge: "geq",
  neq: "ne",
  bigcirc: "mdlgwhtcircle",
  circ: "vysmwhtcircle",
  bullet: "smblkcircle",
  mathyen: "yen",
  mathsterling: "sterling",
  diamond: "smwhtdiamond",
  emptyset: "varnothing",
  hbar: "hslash",
  land: "wedge",
  lor: "vee",
  owns: "ni",
  gets: "leftarrow",
  lnot: "neg",
  longdivision: "longdivisionsign",
  backepsilon: "upbackepsilon",
  eth: "matheth",
  dbkarow: "dbkarrow",
  drbkarow: "drbkarrow",
  hksearow: "hksearrow",
  hkswarow: "hkswarrow",
  digamma: "updigamma",
  Digamma: "upDigamma",
};

/** Reading unicode-math's table for the commands `\rt@want` names (`UNICODE_MATH_TEXT`). */
const UNICODE_MATH_TABLE = [
  "\\begingroup",
  "  \\def\\UnicodeMathSymbol#1#2#3#4{%",
  "    \\ifcsname rt@want@\\expandafter\\@gobble\\string#2\\endcsname",
  "      \\edef\\rt@umclass{\\noexpand\\in@{\\string#3,}{\\rt@umclasses}}\\rt@umclass",
  "      \\ifin@",
  "        \\expandafter\\let\\expandafter\\rt@commands",
  "          \\csname rt@want@\\expandafter\\@gobble\\string#2\\endcsname",
  "        \\@for\\rt@command:=\\rt@commands\\do{\\expandafter\\rt@umtext\\csname\\rt@command\\endcsname{#1}}%",
  "      \\fi",
  "    \\fi}",
  "  \\input{unicode-math-table.tex}",
  "\\endgroup",
];

/** fontspec 2.8a's `\fontspec_maybe_setup_maths:`, in LaTeX2e, as it runs at `\begin{document}`. */
const FONTSPEC_MATHS = [
  "\\newif\\ifrt@maths \\rt@mathstrue",
  "\\newif\\ifrt@euler \\newif\\ifrt@lucida",
  "\\@ifpackageloaded{euler}{\\rt@eulertrue}{}",
  "\\AtBeginDocument{%",
  "  \\@for\\rt@package:=anttor,arevmath,eulervm,mathdesign,concmath,cmbright,mathesf,gfsartemisia,%",
  "    gfsneohellenic,iwona,kpfonts,kmath,kurier,fouriernc,fourier,lmodern,mathpazo,mathptmx,%",
  "    MinionPro,unicode-math,breqn,pxfonts,txfonts,newpxmath,newtxmath,mtpro2\\do{%",
  "    \\@ifpackageloaded{\\rt@package}{\\rt@mathsfalse}{}}%",
  "  \\@ifpackageloaded{lucbmath}{\\rt@lucidatrue}{}%",
  "  \\@ifpackageloaded{lucidabr}{\\rt@lucidatrue}{}%",
  "  \\@ifpackageloaded{lucimatx}{\\rt@lucidatrue}{}%",
  "  \\ifrt@maths\\rt@setupmaths\\fi}",
  "\\def\\rt@setupmaths{%",
  "  \\DeclareSymbolFont{legacymaths}{OT1}{cmr}{m}{n}%",
  "  \\SetSymbolFont{legacymaths}{bold}{OT1}{cmr}{bx}{n}%",
  "  \\DeclareMathAccent{\\acute}{\\mathalpha}{legacymaths}{19}%",
  "  \\DeclareMathAccent{\\grave}{\\mathalpha}{legacymaths}{18}%",
  "  \\DeclareMathAccent{\\ddot}{\\mathalpha}{legacymaths}{127}%",
  "  \\DeclareMathAccent{\\tilde}{\\mathalpha}{legacymaths}{126}%",
  "  \\DeclareMathAccent{\\bar}{\\mathalpha}{legacymaths}{22}%",
  "  \\DeclareMathAccent{\\breve}{\\mathalpha}{legacymaths}{21}%",
  "  \\DeclareMathAccent{\\check}{\\mathalpha}{legacymaths}{20}%",
  "  \\DeclareMathAccent{\\hat}{\\mathalpha}{legacymaths}{94}%",
  "  \\DeclareMathAccent{\\dot}{\\mathalpha}{legacymaths}{95}%",
  "  \\DeclareMathAccent{\\mathring}{\\mathalpha}{legacymaths}{23}%",
  '  \\begingroup\\mathchardef\\@tempa="603A\\relax',
  "    \\ifx\\colon\\@tempa\\DeclareMathSymbol{\\colon}{\\mathpunct}{legacymaths}{58}\\fi",
  "  \\endgroup",
  "  \\ifrt@euler\\else",
  "    \\DeclareMathSymbol{!}{\\mathclose}{legacymaths}{33}%",
  "    \\DeclareMathSymbol{:}{\\mathrel}{legacymaths}{58}%",
  "    \\DeclareMathSymbol{;}{\\mathpunct}{legacymaths}{59}%",
  "    \\DeclareMathSymbol{?}{\\mathclose}{legacymaths}{63}%",
  "    \\ifrt@lucida\\else",
  "      \\@for\\rt@digit:=0,1,2,3,4,5,6,7,8,9\\do{%",
  "        \\expandafter\\DeclareMathSymbol\\expandafter{\\rt@digit}{\\mathalpha}{legacymaths}{\\expandafter`\\rt@digit}}%",
  "      \\DeclareMathSymbol{\\Gamma}{\\mathalpha}{legacymaths}{0}%",
  "      \\DeclareMathSymbol{\\Delta}{\\mathalpha}{legacymaths}{1}%",
  "      \\DeclareMathSymbol{\\Theta}{\\mathalpha}{legacymaths}{2}%",
  "      \\DeclareMathSymbol{\\Lambda}{\\mathalpha}{legacymaths}{3}%",
  "      \\DeclareMathSymbol{\\Xi}{\\mathalpha}{legacymaths}{4}%",
  "      \\DeclareMathSymbol{\\Pi}{\\mathalpha}{legacymaths}{5}%",
  "      \\DeclareMathSymbol{\\Sigma}{\\mathalpha}{legacymaths}{6}%",
  "      \\DeclareMathSymbol{\\Upsilon}{\\mathalpha}{legacymaths}{7}%",
  "      \\DeclareMathSymbol{\\Phi}{\\mathalpha}{legacymaths}{8}%",
  "      \\DeclareMathSymbol{\\Psi}{\\mathalpha}{legacymaths}{9}%",
  "      \\DeclareMathSymbol{\\Omega}{\\mathalpha}{legacymaths}{10}%",
  "      \\DeclareMathSymbol{+}{\\mathbin}{legacymaths}{43}%",
  "      \\DeclareMathSymbol{=}{\\mathrel}{legacymaths}{61}%",
  "      \\DeclareMathDelimiter{(}{\\mathopen}{legacymaths}{40}{largesymbols}{0}%",
  "      \\DeclareMathDelimiter{)}{\\mathclose}{legacymaths}{41}{largesymbols}{1}%",
  "      \\DeclareMathDelimiter{[}{\\mathopen}{legacymaths}{91}{largesymbols}{2}%",
  "      \\DeclareMathDelimiter{]}{\\mathclose}{legacymaths}{93}{largesymbols}{3}%",
  "      \\DeclareMathDelimiter{/}{\\mathord}{legacymaths}{47}{largesymbols}{14}%",
  "      \\DeclareMathSymbol{\\mathdollar}{\\mathord}{legacymaths}{36}%",
  '      \\renewcommand{\\hbar}{{\\mathchar"AF\\mkern-9mu h}}%',
  "    \\fi",
  "  \\fi",
  "  \\DeclareSymbolFont{operators}{TU}{\\rmdefault}{\\mddefault}{\\shapedefault}%",
  "  \\SetSymbolFont{operators}{normal}{TU}{\\rmdefault}{\\mddefault}{\\shapedefault}%",
  "  \\DeclareSymbolFontAlphabet\\mathrm{operators}%",
  "  \\SetMathAlphabet\\mathit{normal}{TU}{\\rmdefault}{\\mddefault}{\\itdefault}%",
  "  \\SetMathAlphabet\\mathbf{normal}{TU}{\\rmdefault}{\\bfdefault}{\\shapedefault}%",
  "  \\SetMathAlphabet\\mathsf{normal}{TU}{\\sfdefault}{\\mddefault}{\\shapedefault}%",
  "  \\SetMathAlphabet\\mathtt{normal}{TU}{\\ttdefault}{\\mddefault}{\\shapedefault}%",
  "  \\SetSymbolFont{operators}{bold}{TU}{\\rmdefault}{\\bfdefault}{\\shapedefault}%",
  "  \\SetMathAlphabet\\mathit{bold}{TU}{\\rmdefault}{\\bfdefault}{\\itdefault}%",
  "  \\SetMathAlphabet\\mathsf{bold}{TU}{\\sfdefault}{\\bfdefault}{\\shapedefault}%",
  "  \\SetMathAlphabet\\mathtt{bold}{TU}{\\ttdefault}{\\bfdefault}{\\shapedefault}}",
];

// The font packages.

/** A font package's stand-in on XeTeX, from its options, or undefined to keep the package. */
type Translate = (rewriter: Rewriter, options: string[]) => string | undefined;

/** A package's options as xkeyval reads them: each key, with its value when it has one. */
function optionsOf(options: string[]): Map<string, string> {
  return new Map(
    options.map((option) => {
      const [key = "", ...value] = option.split("=");
      return [key.trim(), value.join("=").trim()];
    }),
  );
}

/** A stand-in's opening: its name, and the package marked loaded, so that it loads once. */
function standInHead(name: string, version: string): string[] {
  return [
    "\\NeedsTeXFormat{LaTeX2e}",
    `\\ProvidesPackage{rt-${name}}[2026/09/27 resume-tools: ${name} on XeTeX, its fonts by file (decision 0023)]`,
    `\\expandafter\\def\\csname ver@${name}.sty\\endcsname{${version}}`,
  ];
}

/**
 * A font package's family, declared through fontspec's emulation with the defaults the package
 * sets; with the command that selects it when `command` is given, only where the document names
 * that command or one of `uses`.
 */
function packageFamily(
  rewriter: Rewriter,
  lines: string[],
  request: { command?: string; kind?: FamilyKind; options: string; name: string; uses?: string[] },
) {
  const { command, kind } = request;
  if (command !== undefined && !rewriter.mentions(command, ...(request.uses ?? []))) return;
  const family = rewriter.family({
    name: request.name,
    options: request.options,
    ...(kind ? { kind } : {}),
  });
  if (kind !== undefined)
    lines.push(
      `\\DeclareFontSeriesDefault[${kind}]{bf}{\\bfdefault}\\def\\${kind}default{${family}}`,
    );
  if (command !== undefined)
    lines.push(
      `\\NewDocumentCommand${command}{}{\\fontfamily{${family}}\\fontencoding{TU}\\selectfont}`,
    );
}

/** Bob Tennent's font packages' options for figures: the `Numbers` of fontspec they give. */
function figures(lining: boolean, tabular: boolean): string {
  return `Numbers={${tabular ? "Monospaced" : "Proportional"},${lining ? "Lining" : "OldStyle"}}`;
}

/** roboto.sty 2022/09/10 on XeTeX (`\ifroboto@otf`). */
const roboto: Translate = (rewriter, given) => {
  const options = optionsOf(given);
  let otf = true;
  let medium = false;
  let black = false;
  let thin = false;
  let light = false;
  let condensed = false;
  let slab = false;
  let lining = true;
  let tabular = false;
  let isDefault = false;
  let scale = "1";
  for (const [key, value] of options)
    switch (key) {
      case "scaled":
      case "scale":
        scale = value;
        break;
      case "default":
      case "sfdefault":
        isDefault = true;
        slab = false;
        break;
      case "type1":
        otf = false;
        break;
      case "medium":
        medium = true;
        black = false;
        break;
      case "bold":
        black = false;
        medium = false;
        break;
      case "black":
        black = true;
        medium = false;
        break;
      case "thin":
        thin = true;
        light = false;
        break;
      case "light":
        light = true;
        thin = false;
        break;
      case "regular":
        light = false;
        thin = false;
        break;
      case "condensed":
        condensed = true;
        slab = false;
        thin = false;
        break;
      case "rm":
      case "slab":
        slab = true;
        condensed = false;
        isDefault = false;
        break;
      case "lining":
      case "nf":
      case "lf":
        lining = true;
        break;
      case "oldstyle":
      case "osf":
        lining = false;
        break;
      case "tabular":
      case "t":
        tabular = true;
        break;
      case "proportional":
      case "p":
        tabular = false;
        break;
    }
  if (!otf) return undefined;
  const bold = black ? "Black" : medium ? "Medium" : "Bold";
  const regular = thin ? "Thin" : light ? "Light" : "Regular";
  const italic = regular === "Regular" ? "Italic" : `${regular}Italic`;
  const numbers = figures(lining, tabular);
  const lines = [
    ...standInHead(
      "roboto",
      "2022/09/10 (Bob Tennent) Supports Roboto fonts for all LaTeX engines.",
    ),
    "\\RequirePackage{ifxetex,ifluatex,xkeyval,textcomp}",
  ];
  rewriter.setDefaults(`Ligatures=TeX,Scale=${scale},Extension=.otf`);
  const faces = (up: string, it: string, bf: string, bfit: string) =>
    `UprightFont=*-${up},ItalicFont=*-${it},BoldFont=*-${bf},BoldItalicFont=*-${bfit}`;
  if (condensed)
    packageFamily(rewriter, lines, {
      kind: "sf",
      options: `${numbers},${faces(regular, italic, "Bold", "BoldItalic")}`,
      name: "RobotoCondensed",
    });
  else
    packageFamily(rewriter, lines, {
      kind: "sf",
      options: `${numbers},${faces(regular, italic, bold, `${bold}Italic`)}`,
      name: "Roboto",
    });
  lines.push("\\let\\robotofamily\\sfdefault");
  if (slab)
    packageFamily(rewriter, lines, {
      kind: "rm",
      options: `UprightFont=*-${regular},BoldFont=*-Bold`,
      name: "RobotoSlab",
    });
  if (isDefault) lines.push("\\renewcommand*\\familydefault{\\robotofamily}");
  const family = (command: string, options: string, name: string, uses: string[] = []) =>
    packageFamily(rewriter, lines, { command, options, name, uses });
  family("\\roboto", `${numbers},${faces(regular, italic, bold, `${bold}Italic`)}`, "Roboto");
  family(
    "\\robotocondensed",
    `${numbers},${faces(regular, italic, "Bold", "BoldItalic")}`,
    "RobotoCondensed",
  );
  family(
    "\\robotoboldcondensed",
    `${numbers},${faces("Bold", "BoldItalic", "Bold", "BoldItalic")}`,
    "RobotoCondensed",
  );
  family("\\robotoslab", `UprightFont=*-${regular},BoldFont=*-Bold`, "RobotoSlab");
  const two = (up: string, it: string) => `UprightFont=*-${up},ItalicFont=*-${it}`;
  const four = (figures: string) =>
    `Numbers={${figures}},${faces(regular, italic, bold, `${bold}Italic`)}`;
  if (condensed) {
    family("\\robotoregular", `${numbers},${two("Regular", "Italic")}`, "RobotoCondensed", [
      "robotoRegular",
    ]);
    family("\\robotolight", `${numbers},${two("Light", "LightItalic")}`, "RobotoCondensed", [
      "robotoLight",
    ]);
    family("\\robotobold", `${numbers},${two("Bold", "BoldItalic")}`, "RobotoCondensed", [
      "robotoBold",
    ]);
    family("\\robotoosf", four("Proportional,OldStyle"), "RobotoCondensed", ["robotoOsF"]);
    family("\\robotolf", four("Proportional,Lining"), "RobotoCondensed", ["robotoLF"]);
    family("\\robototlf", four("Monospaced,Lining"), "RobotoCondensed", ["robotoTLF"]);
    family("\\robototosf", four("Monospaced,OldStyle"), "RobotoCondensed", ["robotoTOsF"]);
  } else if (slab) {
    family("\\robotoregular", "UprightFont=*-Regular", "RobotoSlab", ["robotoRegular"]);
    family("\\robotothin", "UprightFont=*-Thin", "RobotoSlab", ["robotoThin"]);
    family("\\robotolight", "UprightFont=*-Light", "RobotoSlab", ["robotoLight"]);
    family("\\robotobold", "UprightFont=*-Bold", "RobotoSlab", ["robotoBold"]);
    family(
      "\\robotolf",
      `Numbers={Lining},UprightFont=*-${regular},BoldFont=*-${bold}`,
      "RobotoSlab",
      ["robotoLF"],
    );
  } else {
    family("\\robotoregular", `${numbers},${two("Regular", "Italic")}`, "Roboto", [
      "robotoRegular",
    ]);
    family("\\robotomedium", `${numbers},${two("Medium", "MediumItalic")}`, "Roboto", [
      "robotoMedium",
    ]);
    family("\\robotothin", `${numbers},${two("Thin", "ThinItalic")}`, "Roboto", ["robotoThin"]);
    family("\\robotolight", `${numbers},${two("Light", "LightItalic")}`, "Roboto", ["robotoLight"]);
    family("\\robotobold", `${numbers},${two("Bold", "BoldItalic")}`, "Roboto", ["robotoBold"]);
    family("\\robotoblack", `${numbers},${two("Black", "BlackItalic")}`, "Roboto", ["robotoBlack"]);
    family("\\robotoosf", four("Proportional,OldStyle"), "Roboto", ["robotoOsF"]);
    family("\\robotolf", four("Proportional,Lining"), "Roboto", ["robotoLF"]);
    family("\\robototlf", four("Monospaced,Lining"), "Roboto", ["robotoTLF"]);
    family("\\robototosf", four("Monospaced,OldStyle"), "Roboto", ["robotoTOsF"]);
  }
  for (const [text, font] of [
    ["Regular", "regular"],
    ["Medium", "medium"],
    ["Thin", "thin"],
    ["Light", "light"],
    ["Bold", "bold"],
    ["Black", "black"],
    ["TLF", "tlf"],
    ["LF", "lf"],
    ["OsF", "osf"],
    ["TOsF", "tosf"],
  ])
    lines.push(`\\DeclareTextFontCommand{\\roboto${text}}{\\roboto${font}}`);
  lines.push(
    `\\def\\robotoslablgr{\\fontencoding{LGR}\\fontfamily{RobotoSlab-TLF}\\selectfont}`,
    `\\def\\robotolgr{\\fontencoding{LGR}\\fontfamily{Roboto-${tabular ? "T" : ""}${lining ? "LF" : "OsF"}}\\selectfont}`,
  );
  rewriter.setDefaults("");
  lines.push("\\endinput", "");
  return lines.join("\n");
};

/** sourcesanspro.sty 2018/05/19 v2.7 on XeTeX (`\ifsourcesanspro@otf`). */
const sourcesanspro: Translate = (rewriter, given) => {
  let otf = true;
  let isDefault = false;
  let sfdefault = true;
  let oldstyle = false;
  let tabular = true;
  let black = false;
  let semibold = false;
  let light = false;
  let extralight = false;
  let scale = "1";
  for (const [key, value] of optionsOf(given))
    switch (key) {
      case "lining":
      case "nf":
      case "lf":
        oldstyle = false;
        break;
      case "oldstyle":
      case "osf":
        oldstyle = true;
        break;
      case "tabular":
        tabular = true;
        break;
      case "proportional":
        tabular = false;
        break;
      case "black":
        black = true;
        semibold = false;
        break;
      case "semibold":
        black = false;
        semibold = true;
        break;
      case "bold":
        black = false;
        semibold = false;
        break;
      case "light":
        light = true;
        extralight = false;
        break;
      case "extralight":
        light = false;
        extralight = true;
        break;
      case "regular":
        light = false;
        extralight = false;
        break;
      case "scale":
      case "scaled":
        scale = value;
        break;
      case "default":
        isDefault = true;
        break;
      case "sfdefault":
        sfdefault = true;
        break;
      case "nosfdefault":
        sfdefault = false;
        break;
      case "type1":
      case "t1":
        otf = false;
        break;
      case "opentype":
      case "otf":
        otf = true;
        break;
    }
  if (!otf) return undefined;
  const figurestyle = oldstyle ? "OldStyle" : "";
  const figurealign = tabular ? "" : "Proportional";
  const boldstyle = black ? "Black" : semibold ? "Semibold" : "Bold";
  const regstyle = light ? "Light" : extralight ? "ExtraLight" : "Regular";
  const lines = standInHead("sourcesanspro", "2018/05/19 v2.7 Adobe's Source Sans Pro typeface");
  lines.push("\\RequirePackage{ifxetex,ifluatex,xkeyval}");
  rewriter.setDefaults(
    `Ligatures=TeX,Numbers={${figurealign},${figurestyle}},Scale=${scale},Extension=.otf`,
  );
  const faces = (up: string, it: string, bf: string, bfit: string) =>
    `UprightFont=*-${up},ItalicFont=*-${it},BoldFont=*-${bf},BoldItalicFont=*-${bfit}`;
  if (sfdefault)
    packageFamily(rewriter, lines, {
      kind: "sf",
      options: faces(regstyle, `${regstyle}It`, boldstyle, `${boldstyle}It`),
      name: "SourceSansPro",
    });
  const family = (command: string, options: string) =>
    packageFamily(rewriter, lines, { command, options, name: "SourceSansPro" });
  family("\\sourcesanspro", faces("Regular", "RegularIt", "Bold", "BoldIt"));
  family("\\sourcesansprolight", faces("Light", "LightIt", "Semibold", "SemiboldIt"));
  family("\\sourcesansproextreme", faces("ExtraLight", "ExtraLightIt", "Black", "BlackIt"));
  family(
    "\\sourcesansprolf",
    `Numbers=${figurealign === "" ? "{}" : figurealign},${faces(regstyle, `${regstyle}It`, boldstyle, `${boldstyle}It`)}`,
  );
  rewriter.setDefaults("");
  if (isDefault) lines.push("\\edef\\familydefault{\\sfdefault}");
  lines.push("\\endinput", "");
  return lines.join("\n");
};

/** lato.sty 2019/06/20 on XeTeX (`\iflato@otf`). */
const lato: Translate = (rewriter, given) => {
  let otf = true;
  let lining = true;
  let tabular = true;
  let isDefault = false;
  let defaultSans = false;
  let scale = "1";
  for (const [key, value] of optionsOf(given))
    switch (key) {
      case "scale":
      case "scaled":
        scale = value;
        break;
      case "default":
        isDefault = true;
        break;
      case "defaultsans":
        defaultSans = true;
        break;
      case "lining":
        lining = true;
        break;
      case "oldstyle":
        lining = false;
        break;
      case "tabular":
        tabular = true;
        break;
      case "proportional":
        tabular = false;
        break;
      case "type1":
        otf = false;
        break;
    }
  if (!otf) return undefined;
  const features = [
    "Extension=.ttf",
    "Ligatures={TeX,Common}",
    `Scale=${scale}`,
    "FontFace={ul}{n}{*-Hairline}",
    "FontFace={ul}{it}{*-HairlineItalic}",
    "FontFace={el}{n}{*-Thin}",
    "FontFace={el}{it}{*-ThinItalic}",
    "FontFace={l}{n}{*-Light}",
    "FontFace={l}{it}{*-LightItalic}",
    "UprightFont={*-Regular}",
    "ItalicFont={*-Italic}",
    "FontFace={mb}{n}{*-Medium}",
    "FontFace={mb}{it}{*-MediumItalic}",
    "FontFace={sb}{n}{*-Semibold}",
    "FontFace={sb}{it}{*-SemiboldItalic}",
    "FontFace={b}{n}{*-Bold}",
    "FontFace={b}{it}{*-BoldItalic}",
    "BoldFont={*-Bold}",
    "BoldItalicFont={*-BoldItalic}",
    "FontFace={eb}{n}{*-Heavy}",
    "FontFace={eb}{it}{*-HeavyItalic}",
    "FontFace={ub}{n}{*-Black}",
    "FontFace={ub}{it}{*-BlackItalic}",
  ].join(",");
  const width = tabular ? "T" : "";
  const style = lining ? "LF" : "OsF";
  const lines = standInHead("lato", "2019/06/20 Style file for Lato.");
  lines.push(
    "\\RequirePackage{fontaxes}",
    "\\RequirePackage{ifluatex}",
    "\\RequirePackage{ifxetex}",
    "\\RequirePackage{xkeyval}",
  );
  lines.push(`\\newcommand*{\\latofamily}{lato-${width}${style}}`);
  // The four figure styles' families, which \lato and \latofamily select, by the names lato.sty
  // gives them, when the document names either.
  if (rewriter.mentions("\\lato", "\\latofamily")) {
    for (const [variant, numbers] of [
      ["TLF", "Monospaced,Lining"],
      ["LF", "Proportional,Lining"],
      ["TOsF", "Monospaced,OldStyle"],
      ["OsF", "Proportional,OldStyle"],
    ] as const)
      rewriter.family({
        name: "Lato",
        options: `${features},Numbers={${numbers}},NFSSFamily=lato-${variant}`,
      });
    lines.push(
      `\\NewDocumentCommand\\lato{}{\\fontfamily{lato-${width}${style}}\\fontencoding{TU}\\selectfont}`,
    );
  }
  if (rewriter.mentions("\\flafamily")) {
    const fla = rewriter.family({
      name: "Lato",
      options: `${features},Numbers={Monospaced,Lining},NFSSFamily=fla`,
    });
    lines.push(
      `\\NewDocumentCommand\\flafamily{}{\\fontfamily{${fla}}\\fontencoding{TU}\\selectfont}`,
    );
  }
  const numbers = `Numbers={${tabular ? "Monospaced" : "Proportional"},${lining ? "Lining" : "OldStyle"}}`;
  if (defaultSans)
    packageFamily(rewriter, lines, { kind: "sf", options: `${features},${numbers}`, name: "Lato" });
  if (isDefault)
    packageFamily(rewriter, lines, { kind: "rm", options: `${features},${numbers}`, name: "Lato" });
  lines.push("\\endinput", "");
  return lines.join("\n");
};

/** fontawesome.sty 2016/05/15 v4.6.3.1 on XeTeX (`\iffontawesome@otf`). */
const fontawesome: Translate = (rewriter) => {
  const lines = standInHead("fontawesome", "2016/05/15 v4.6.3.1 font awesome icons");
  lines.push(
    "\\RequirePackage{ifxetex,ifluatex}",
    "\\newcommand*{\\faicon}[1]{{\\csname faicon@#1\\endcsname}}",
    "\\input{fontawesomesymbols-generic.tex}",
  );
  const family = rewriter.family({ name: "FontAwesome", options: "" });
  lines.push(
    `\\NewDocumentCommand\\FA{}{\\fontfamily{${family}}\\fontencoding{TU}\\selectfont}`,
    "\\input{fontawesomesymbols-xeluatex.tex}",
    "\\renewcommand{\\faHourglass}[1][]{\\faicon{hourglass\\if\\relax\\detokenize{#1}\\relax\\else-#1\\fi}}",
    "\\renewcommand{\\faBattery}[1][4]{\\faicon{battery-#1}}",
    "\\endinput",
    "",
  );
  return lines.join("\n");
};

/**
 * fontawesome5.sty 2022/05/02 5.15.4 on XeTeX, which reads the glyphs' names of Font Awesome's
 * fonts as it loads, to define a command for each, and so loads them, which a format cannot hold:
 * its commands defined instead from its own table, `fontawesome5-mapping.def`, each the icon of its
 * name, which is set as the package sets one, by the glyph of that name, from the style asked for,
 * else the solid one, else the brands' font, with `\XeTeXglyph`, and in a box 1.5 em wide with its
 * `fixed` option.
 */
const fontawesome5: Translate = (_rewriter, given) => {
  const fixed = given.some((option) => option.trim() === "fixed");
  return [
    ...standInHead("fontawesome5", "2022/05/02 5.15.4 Font Awesome 5"),
    "\\RequirePackage{xparse}",
    "\\ExplSyntaxOn",
    `\\bool_new:N \\l__rtfa_fixed_bool ${fixed ? "\\bool_set_true:N \\l__rtfa_fixed_bool" : ""}`,
    "\\int_new:N \\l__rtfa_glyph_int",
    "\\cs_new_protected:Npn \\__fontawesome_def_icon:nnnnn #1#2#3#4#5 {",
    "  \\tl_if_empty:nF {#1} { \\cs_gset:Npn #1 { \\faPreselectedIcon{#2} } }",
    "}",
    "\\file_input:n {fontawesome5-mapping.def}",
    "\\str_new:N \\l_fontawesome_style_str",
    "\\NewDocumentCommand \\faPreselectedIcon {m s O{\\str_use:N \\l_fontawesome_style_str}} {",
    "  \\fontawesome_use_icon:nn {#3} {#1 \\IfBooleanT {#2} {-alt}}",
    "}",
    "\\NewDocumentCommand \\faIcon {s O{\\str_use:N \\l_fontawesome_style_str} m} {",
    "  \\fontawesome_use_icon:nn {#2} {#3 \\IfBooleanT {#1} {-alt}}",
    "}",
    "\\NewDocumentCommand \\faStyle {m} { \\str_set:Nn \\l_fontawesome_style_str {#1} }",
    '\\cs_new:Npn \\__rtfa_glyph:n #1 { \\the \\XeTeXglyphindex " #1 " \\scan_stop: }',
    "\\cs_new_protected:Nn \\fontawesome_use_icon:nn {",
    "  \\group_begin:",
    "    \\usefont {TU} {fontawesomefree} {#1} {n}",
    "    \\int_set:Nn \\l__rtfa_glyph_int { \\__rtfa_glyph:n {#2} }",
    "    \\int_compare:nNnT { \\l__rtfa_glyph_int } = { 0 } {",
    "      \\fontseries {solid} \\selectfont",
    "      \\int_set:Nn \\l__rtfa_glyph_int { \\__rtfa_glyph:n {#2} }",
    "      \\int_compare:nNnT { \\l__rtfa_glyph_int } = { 0 } {",
    "        \\fontfamily {fontawesomebrands} \\fontseries {regular} \\selectfont",
    "        \\int_set:Nn \\l__rtfa_glyph_int { \\__rtfa_glyph:n {#2} }",
    "        \\int_compare:nNnT { \\l__rtfa_glyph_int } = { 0 }",
    "          { \\PackageError {fontawesome5} {The~requested~icon~#2~was~not~found} {} }",
    "      }",
    "    }",
    "    \\bool_if:NTF \\l__rtfa_fixed_bool { \\makebox [1.5em] [c] } { \\use:n }",
    "      { \\XeTeXglyph \\l__rtfa_glyph_int }",
    "  \\group_end:",
    "}",
    "\\str_set:Nn \\l_fontawesome_style_str {solid}",
    "\\ExplSyntaxOff",
    "\\endinput",
    "",
  ].join("\n");
};

/** plex-sans.sty, plex-serif.sty and plex-mono.sty 2023 on XeTeX, by Bob Tennent, alike. */
function plex(which: "sans" | "serif" | "mono"): Translate {
  return (rewriter, given) => {
    let otf = true;
    let isDefault = false;
    let condensed = false;
    let medstyle = "Regular";
    let boldstyle = "Bold";
    let scale = "1";
    for (const [key, value] of optionsOf(given))
      switch (key) {
        case "scale":
          scale = value;
          break;
        case "type1":
          otf = false;
          break;
        case "sfdefault":
        case "default":
        case "ttdefault":
          isDefault = true;
          break;
        case "condensed":
          condensed = true;
          break;
        case "thin":
        case "t":
          medstyle = "Thin";
          break;
        case "extralight":
        case "el":
          medstyle = medstyle === "Thin" ? medstyle : "ExtraLight";
          break;
        case "light":
        case "l":
          medstyle = medstyle === "Regular" || medstyle === "Text" ? "Light" : medstyle;
          break;
        case "textmd":
        case "txmd":
          medstyle = medstyle === "Regular" ? "Text" : medstyle;
          break;
        case "text":
        case "tx":
          boldstyle = "Text";
          break;
        case "medium":
        case "mb":
          boldstyle = boldstyle === "Text" ? boldstyle : "Medium";
          break;
        case "semibold":
        case "sb":
          boldstyle = boldstyle === "Bold" ? "SemiBold" : boldstyle;
          break;
      }
    if (!otf) return undefined;
    const base =
      which === "sans" ? "IBMPlexSans" : which === "serif" ? "IBMPlexSerif" : "IBMPlexMono";
    const kind: FamilyKind = which === "sans" ? "sf" : which === "serif" ? "rm" : "tt";
    const italic = medstyle === "Regular" ? "Italic" : `${medstyle}Italic`;
    const faces = `UprightFont=*-${medstyle},ItalicFont=*-${italic},BoldFont=*-${boldstyle},BoldItalicFont=*-${boldstyle}Italic`;
    const lines = [
      ...standInHead(`plex-${which}`, `2023/09/30 (Bob Tennent) Style file for ${base} fonts`),
      "\\RequirePackage{ifxetex,ifluatex,xkeyval,textcomp}",
    ];
    rewriter.setDefaults(`Ligatures=TeX,Scale=${scale},Extension=.otf`);
    const name = which === "sans" && condensed ? "IBMPlexSansCondensed" : base;
    packageFamily(rewriter, lines, { kind, options: faces, name });
    lines.push(`\\let\\plex${which}family\\${kind}default`);
    if (isDefault) lines.push(`\\renewcommand*\\familydefault{\\plex${which}family}`);
    packageFamily(rewriter, lines, { command: `\\plex${which}`, options: faces, name: base });
    if (which === "sans")
      packageFamily(rewriter, lines, {
        command: "\\plexsanscondensed",
        options: faces,
        name: "IBMPlexSansCondensed",
      });
    rewriter.setDefaults("");
    lines.push("\\endinput", "");
    return lines.join("\n");
  };
}

/** The font packages the rewrite translates, by name. */
const FONT_PACKAGES: Readonly<Record<string, Translate>> = {
  roboto,
  sourcesanspro,
  lato,
  fontawesome,
  fontawesome5,
  "plex-sans": plex("sans"),
  "plex-serif": plex("serif"),
  "plex-mono": plex("mono"),
};

/** The font packages the rewrite puts a stand-in of its own in the place of. */
export const TRANSLATED_PACKAGES: readonly string[] = Object.keys(FONT_PACKAGES);
