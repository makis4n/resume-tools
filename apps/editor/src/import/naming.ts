/**
 * The naming request, built in the browser (milestone 3 item 6, plan section 6 step 4, decision
 * 0024): what an import sends the naming step about its template, from the body's tree
 * (`parse.ts`), the engine's signatures and definitions (`signatures.ts`), the probe's verdicts
 * (`probe.ts`) and the preamble. Nothing of the resume's text goes: the request holds the
 * template's definitions, masked; its signatures, each default written as its placeholder; the
 * probe's verdict on each argument; call sites whose every letter is `x` or `X` and every digit
 * `0`, outside the names of commands; and the preamble's settings, masked but for numbers, units,
 * colours and known keywords.
 *
 * The request is built for each template macro and environment the body calls or opens, and each
 * the preamble calls to store the header's text (`isSetter`): its signature, its definition and
 * the definitions of its closure, data by name alone (decision 0020), its key (`keyOf`, an
 * environment's `environmentKeyOf`), what the probe found of each argument, and up to three of its
 * calls, the ones whose arguments differ most.
 *
 * Every definition is masked by pattern, emails, links and phone numbers, before item 4 hashes it
 * (`maskDefinition`). One from the engine's tree, a class or package of TeX Live's, is public and
 * cannot hold the person's text: it goes as item 4 hashed it, so that its key is the same whoever
 * the person is, and a masked word of it could not tell anyone who has the package which word the
 * person's details hold. One the upload defines, in its main file or a class, package or file of
 * its own (`ownNames`), can hold them, and is masked by the document's own values too
 * (`ownHidden`): each of the document's phrases of two words or more, each identifier, an email, a
 * link's host, address or handle, or a phone's digits, and each word of the header's name, wherever
 * the definition holds it as whole words; and each pair of adjacent words of the definition's
 * text that a phrase of the document holds, however much longer the phrase. A definition that
 * masking changes is sent with the hash of what is sent, so that no hash of the person's text
 * leaves the browser; its key, and its dependents', are then the document's own. A macro a
 * storing call of the preamble's filled holds the person's text, whoever defines it, and goes by
 * its name alone, as data does (the signatures step reads it so, decision 0033). The text of a
 * definition's metadata, a `\hypersetup`'s `pdfauthor`, goes as its placeholder (`maskedMetadata`).
 *
 * The document's values are its body's text, its header's values and the texts its preamble
 * stores, and its page (`pageStrings`, decision 0033): the reference compile's glyphs, read as
 * words with the fonts the reference read them with, which hold whatever a macro of the preamble
 * writes that no body text names. The page's identifiers, its pairs of words, where a definition
 * holds the two adjacent or parted by glue alone, its numbers and its letter-spaced words mask the
 * document's own definitions; its single words are the template's as often as the person's, and
 * mask nothing. A page the detector cannot read refuses the request (`pageReadable`). A name of
 * the document's own that is the person's word, a macro that spells what it is named, goes as a
 * placeholder throughout, and the map back to it stays in the browser (`BuiltRequest.names`).
 *
 * `findLeaks` checks a request against a document more strictly than the builder masks, the
 * page's single words among what it looks for, in the document's own definitions too, and the
 * request's names, and `assertNoText` throws, naming where but never what, when any of the
 * document's text is in it, or when the page is one the detector cannot read.
 */

import {
  type CallSite,
  type Dependency,
  datePlaceholder,
  environmentKeyOf,
  type FamilyHint,
  keyOf,
  maskDefinition,
  NAMING_VERSION,
  NamingRequest,
  placeholder,
  REQUEST_CAPS,
  type RequestArgument,
  type RequestDefinition,
  type RequestMacro,
  type RequestPreamble,
  sha256,
} from "@resume-tools/naming";
import type { FontLibrary } from "../page/fonts";
import { type NativeFontFile, nativeFileName, parseNativeFont } from "../page/native";
import type { Tfm } from "../tex/tfm";
import { readSpec } from "./arguments";
import { storedIn } from "./candidates";
import { decodeText, type Intake } from "./intake";
import {
  type Argument,
  bodyOfText,
  buildTree,
  type DateNode,
  type Node,
  readBody,
  type Tree,
} from "./parse";
import { extensionOf } from "./paths";
import type { Probe } from "./probe";
import type { GlyphStream, ReferenceGlyph } from "./reference";
import { type Refusal, refusal } from "./refusal";
import type { EngineSignatures, Signature } from "./signatures";
import { classEnd, closing, commentAt, maskComments } from "./source";
import { STANDARD } from "./standard";

// The document's own values.

/** The header's values, as item 7 finds them in a document, which mask what leaves as its text. */
export interface HeaderValues {
  first?: string;
  last?: string;
  headline?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: readonly { label?: string; href?: string }[];
}

/**
 * A document's text, as the leak check and the masking read it: the body's tree, whose text runs,
 * link addresses, dates and raw chunks are the person's; the header's values, when found; the
 * texts the preamble stores, as Awesome-CV's `\name{...}` does, the probe's candidates there; the
 * page, what the reference compile set (`pageStrings`), which holds what a macro of the preamble
 * writes that no body text names; and the upload's sources, which say which definitions are the
 * document's own.
 */
export interface DocumentText {
  tree: Tree;
  header?: HeaderValues;
  stored?: readonly string[];
  /** The page's strings (`pageStrings`), the strongest of the detector's sources. */
  page?: PageStrings;
  /**
   * The names the request writes as placeholders, each read back to the document's
   * (`BuiltRequest.names`), so that the check reads a masked macro's definition as the document's
   * own, which only one of the document's own can be.
   */
  names?: ReadonlyMap<string, string>;
  /**
   * The upload's sources (`sourcesOf`): a definition whose name one of them defines is the
   * document's own (`ownNames`). Without them every definition is the tree's, and none is masked by
   * the document's values.
   */
  sources?: readonly string[];
}

// The document's own definitions.

/** The files of an upload a definition of the document's own can be in, but for its main file. */
const SOURCE_EXTENSIONS: readonly string[] = [".tex", ".cls", ".sty", ".def"];

/**
 * An upload's sources, as `buildRequest` and `assertNoText` take them: its main file's text, and
 * the text of each `.tex`, `.cls`, `.sty` and `.def` file it holds.
 */
export function sourcesOf(taken: Pick<Intake, "main" | "files">): string[] {
  const sources = [taken.main.text];
  for (const [path, bytes] of Object.entries(taken.files))
    if (SOURCE_EXTENSIONS.includes(extensionOf(path))) sources.push(decodeText(bytes));
  return sources;
}

/**
 * The forms that define a command, its name after them as a control word: `\def` and its kin,
 * `\let`, `\newcommand` and its kin, xargs', etoolbox's and xparse's, and tcolorbox's `\newtcbox`.
 */
const DEFINES_COMMAND =
  /\\(?:[gex]?def|let|(?:new|renew|provide)commandx?\*?|DeclareRobustCommand\*?|(?:new|renew|provide)robustcmd\*?|(?:New|Renew|Provide|Declare)(?:Expandable)?DocumentCommand|(?:re)?newtcbox(?:\s*\[[^\]]*\])?)\s*\{?\s*\\([A-Za-z@]+)/g;

/** expl3's forms: `\cs_new:Npn` and `\cs_set:Npn`, protected, without `\par` or expanding. */
const DEFINES_FUNCTION =
  /\\cs_(?:new|g?set)(?:_protected)?(?:_nopar)?:(?:Npn|Npx|Nn|Nx)\s*\\([A-Za-z@_:]+)/g;

/** The forms that define an environment, its name after them in braces: `\x` and `\endx`. */
const DEFINES_ENVIRONMENT =
  /\\(?:(?:new|renew)environment\*?|(?:New|Renew|Provide|Declare)DocumentEnvironment|(?:re)?newtcolorbox|(?:New|Renew|Provide|Declare)TColorBox)\s*(?:\[[^\]]*\]\s*)?\{([A-Za-z@*]+)\}/g;

/** The forms that define a command by its name spelt out: `\@namedef{x}`, `\csdef{x}`, `\csname`. */
const DEFINES_BY_NAME =
  /\\(?:@namedef|cs[gex]?def|cslet)\s*\{([A-Za-z@]+)\}|\\expandafter\s*\\(?:[gex]?def|let|(?:new|renew|provide)command\*?)\s*\\csname\s*([A-Za-z@]+)\s*\\endcsname/g;

/**
 * The name a macro the engine printed is defined under in a source: a robust command's `\x `, the
 * optional argument's `\\x`, xparse's `\x code` and an environment's code are all `x`'s.
 */
function baseName(name: string): string {
  const environment = /^environment (.+?) (?:code|end|end aux|end code)$/.exec(name);
  if (environment !== null) return environment[1] ?? name;
  return name
    .replace(/^\\/, "")
    .replace(/ code$/, "")
    .trimEnd();
}

/**
 * The names an upload's sources define (`sourcesOf`), outside comments, by the forms above: the
 * macros and environments that are the document's own, which its text can hold the person's
 * details in. A macro a source defines through a `\csname` it builds from an argument, as AltaCV's
 * `\NewInfoField` does, is not among them, and is read as the tree's.
 */
export function ownNames(sources: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    const code = maskComments(source);
    for (const found of code.matchAll(DEFINES_COMMAND)) names.add(found[1] ?? "");
    for (const found of code.matchAll(DEFINES_FUNCTION)) names.add(found[1] ?? "");
    for (const found of code.matchAll(DEFINES_BY_NAME)) names.add(found[1] ?? found[2] ?? "");
    for (const found of code.matchAll(DEFINES_ENVIRONMENT))
      for (const name of [found[1] ?? "", `end${found[1] ?? ""}`]) names.add(name);
  }
  names.delete("");
  return names;
}

/** Whether a macro the engine printed is the document's own: the upload defines its name. */
export const isOwn = (name: string, owned: ReadonlySet<string>) => owned.has(baseName(name));

// The document's texts, as the matchers read them.

/** What a text of the document's is, as a leak names it. */
export type Origin = "text" | "link" | "date" | "raw" | "header" | "stored" | "page";

/**
 * A text of the document's, as it is matched: its letters and digits, each folded; where it came
 * from; and its shape: an identifier, an email, a link's host, address or handle, or a phone's
 * digits; a phrase of two words or more; one word; a number the page shows, of two digits or more;
 * or a word the page shows letter-spaced, its letters joined (`PageStrings.runs`).
 */
interface Needle {
  chars: string[];
  origin: Origin;
  shape: "identifier" | "phrase" | "word" | "number" | "run";
}

/**
 * The document's texts, folded: those of MIN_NEEDLE characters or more by their first MIN_NEEDLE,
 * the numbers of two digits by both, and each pair of adjacent words its phrases and its page hold.
 */
interface Needles {
  byPrefix: Map<string, Needle[]>;
  /** The needles of two characters, the page's numbers of two digits, by those two. */
  short: Map<string, Needle[]>;
  /** Each pair of adjacent words a phrase or the page holds, each folded, a space between, and its origin. */
  pairs: Map<string, Origin>;
  /**
   * Each word the page shows, of NAME_WORD letters or more, folded, which masks an own definition
   * that spells it a letter a word (`spacedFound`), as europecv's title is kerned.
   */
  spaced: Set<string>;
}

/**
 * A character as the matchers read it: its base letter, its accents taken off, in lower case; or
 * nothing, for anything but a letter or a digit. TeX writes `&` as `\&`, `é` as `\'e` and an en
 * dash as `--`, so the matchers read letters and digits alone, and a text of the document's is
 * found in a definition however the definition's source writes its punctuation and accents.
 */
function fold(char: string): string {
  const base = char.normalize("NFD");
  const first = String.fromCodePoint(base.codePointAt(0) ?? 0);
  if (!/^[\p{L}\p{N}]$/u.test(first)) return "";
  const lowered = first.toLowerCase();
  return [...lowered].length === 1 ? lowered : first;
}

/** A text as the matchers read it: its letters and digits, folded (`fold`), in order. */
function folded(text: string): string {
  let out = "";
  for (const char of text) out += fold(char);
  return out;
}

/** A word: a letter or a digit, and the letters, digits and marks after it. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;

/** A text's words (`WORD`). */
const wordsOf = (text: string) => text.match(WORD) ?? [];

/**
 * Whether a folded text could be a placeholder: only `x` and `0`, so that looking for it would
 * find every call site. Nothing of it can leak.
 */
const placeholderLike = (text: string) => /^[x0]*$/.test(text);

/** The least letters and digits a text of the document's holds for the matchers to look for it. */
const MIN_NEEDLE = 3;

/**
 * The shortest identifier a setting, or a text the check reads as source, is searched for anywhere,
 * inside a word too, as a handle inside a colour's name; everything else is found as whole words
 * alone, so that a first name `Tom` never masks `bottom`.
 */
const ANYWHERE = 6;

/** The fewest letters and digits a link's path segment holds to be a handle, `quillinv`. */
const HANDLE = 5;

/** The fewest digits a run of digits and a phone's separators holds to be a number of the person's. */
const DIGITS = 7;

/** The longest key before an `=` a matcher reads as a key, not as text. */
const MAX_KEY = 64;

/** A command at a place: an environment's `\begin` or `\end` with its name, a word or a symbol. */
const COMMAND = /\\(?:begin|end)\s*\{[A-Za-z@*]*\}|\\[A-Za-z@]+|\\[\s\S]?/uy;

/**
 * A raw chunk's stretches of text: what lies between its commands, braces, TeX's special
 * characters and comments, trimmed, which TeX may set as text; and whether each is inside an
 * optional argument's brackets, as `\faFile*[regular]`'s style is, the nearest group open round it.
 * What a command takes as code (`CODE`), `\color{accent}`'s colour or `\selectlanguage{english}`'s
 * language, is no stretch of text, as a matcher reads the same in a definition.
 */
function rawPieces(source: string): { text: string; bracketed: boolean }[] {
  const pieces: { text: string; bracketed: boolean }[] = [];
  const open: { char: string; code: boolean }[] = [];
  /** The code command just read: how many of its mandatory arguments are still to come. */
  let taking: Takes | undefined;
  let current = "";
  const flush = () => {
    if (current.trim() !== "" && !open.some((each) => each.code))
      pieces.push({ text: current.trim(), bracketed: open.at(-1)?.char === "[" });
    current = "";
  };
  for (let i = 0; i < source.length; ) {
    const char = source[i] ?? "";
    if (char === "%") {
      flush();
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "\\") {
      flush();
      COMMAND.lastIndex = i;
      const command = COMMAND.exec(source)?.[0] ?? "\\";
      const code = CODE.get(command.slice(1));
      taking = code === undefined ? undefined : { ...code };
      i += Math.max(1, command.length);
      continue;
    }
    if ("{}[]$&#^_".includes(char)) {
      flush();
      if (char === "{" || char === "[") {
        // A code command's optional arguments, and as many mandatory ones as it takes, are code.
        const code = taking !== undefined && (char === "[" || taking.take > 0);
        if (code && char === "{" && taking !== undefined) taking.take--;
        if (taking !== undefined && taking.take === 0 && char === "{" && taking.after === undefined)
          taking = undefined;
        open.push({ char, code: code || open.some((each) => each.code) });
      } else if (char === "}" || char === "]") {
        const opener = char === "}" ? "{" : "[";
        const at = open.map((each) => each.char).lastIndexOf(opener);
        if (at >= 0) open.length = at;
      } else taking = undefined;
      i++;
      continue;
    }
    if (!/\s/.test(char) && open.every((each) => !each.code)) taking = undefined;
    current += char;
    i++;
  }
  flush();
  return pieces;
}

/** Every node of a tree, arguments' content and raw chunks' placed arguments among them. */
function* nodesOf(nodes: readonly Node[]): Generator<Node> {
  for (const node of nodes) {
    yield node;
    switch (node.kind) {
      case "section":
      case "call":
        for (const arg of node.args) if (arg.content !== undefined) yield* nodesOf(arg.content);
        break;
      case "list":
      case "item":
      case "environment":
      case "block":
        for (const arg of node.args) if (arg.content !== undefined) yield* nodesOf(arg.content);
        yield* nodesOf(node.content);
        break;
      case "group":
        yield* nodesOf(node.content);
        break;
      case "raw":
        for (const arg of node.args ?? [])
          if (arg.content !== undefined) yield* nodesOf(arg.content);
        break;
      default:
        break;
    }
  }
}

/** The characters that part a phone number's digits: spaces, brackets, dots, dashes, slashes. */
const PHONE_SEPARATORS = new Set([..." ().-/+~", "\u00a0", "\u2009", "\u202f"]);

/** The runs of digits a text holds, its phone's separators between them, of DIGITS or more. */
function digitRuns(text: string): string[] {
  const runs: string[] = [];
  let digits = "";
  for (const char of text) {
    if (/^\p{Nd}$/u.test(char)) digits += char;
    else if (!PHONE_SEPARATORS.has(char)) {
      if (digits.length >= DIGITS) runs.push(digits);
      digits = "";
    }
  }
  if (digits.length >= DIGITS) runs.push(digits);
  return runs;
}

/** An email address, whole. */
const EMAIL = /^[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u;

/**
 * A link's identifiers: the address after `mailto:`, the digits after `tel:`; or, for an address on
 * the web, its address without its scheme, its host, each without `www.`, and each segment of its
 * path of HANDLE letters and digits or more, a handle. A link inside the document, `#section`,
 * names none.
 */
function linkIdentifiers(href: string): string[] {
  const address = href.trim();
  const mail = /^mailto:(.+)$/i.exec(address);
  if (mail !== null) return [mail[1] ?? ""];
  const phone = /^tel:(.+)$/i.exec(address);
  if (phone !== null) return [(phone[1] ?? "").replace(/\D/g, "")];
  const bare = address.replace(/^[A-Za-z][A-Za-z0-9+.-]*:(?:\/\/)?/, "");
  const [place = "", ...path] = bare.split(/[/?#&=]+/);
  const host = place.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  if (!/[^.]\.[^.]/.test(host)) return [];
  const found = [bare, bare.replace(/^www\./i, ""), host, host.replace(/^www\./i, "")];
  for (const segment of path) if (folded(segment).length >= HANDLE) found.push(segment);
  return found;
}

/**
 * The identifiers a text holds: each email, each link written out with its scheme or `www.`, as
 * `linkIdentifiers` reads it, and each run of DIGITS digits or more.
 */
function identifiersIn(text: string): string[] {
  const found: string[] = [];
  for (const token of text.split(/\s+/)) {
    const bare = token.replace(/^[(<"'[]+|[)>"'.,;:\]]+$/g, "");
    if (bare.includes("@") && EMAIL.test(bare.replace(/^mailto:/i, "")))
      found.push(bare.replace(/^mailto:/i, ""));
    else if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.)/i.test(bare))
      found.push(...linkIdentifiers(bare));
  }
  found.push(...digitRuns(text));
  return found;
}

/** Whether a word starts with a letter: a word of text, where `5cm` and `2020` are numbers. */
const lettered = (word: string) => /^\p{L}/u.test(word);

/** How many letters a word holds, of any script. */
const lettersOf = (word: string) => (word.match(/\p{L}/gu) ?? []).length;

/**
 * A postcode of letters and digits, as an address writes it: the UK's, `QV1A 2ZX`, and Canada's,
 * `X9Q 0Q9`, a space between their halves or none, in any case.
 */
const POSTCODE =
  /(?<![\p{L}\p{N}])(?:[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}|[A-Z]\d[A-Z] ?\d[A-Z]\d)(?![\p{L}\p{N}])/giu;

/**
 * What a postal address is looked for by besides its phrase, as the header's location gives one:
 * each postcode of letters and digits (`POSTCODE`), an identifier; and each of its words that
 * holds a digit, a street's number or a postcode of digits, with the word before it and the word
 * after it where those start with letters, a phrase: `221B Larkspur`, `Hauptstraße 5`, `75001 Paris`
 * and `City 94103`, which no class's code holds, where a number alone may be, as `10000` is.
 */
function addressNeedles(address: string | undefined): [string, "identifier" | "phrase"][] {
  if (address === undefined) return [];
  const found: [string, "identifier" | "phrase"][] = [];
  for (const code of address.match(POSTCODE) ?? []) found.push([code, "identifier"]);
  const words = address.split(/[\s,;/]+/).filter((word) => folded(word) !== "");
  words.forEach((word, i) => {
    if (!/\p{N}/u.test(word)) return;
    const [before, after] = [words[i - 1], words[i + 1]];
    if (before !== undefined && lettered(folded(before)))
      found.push([`${before} ${word}`, "phrase"]);
    if (after !== undefined && lettered(folded(after))) found.push([`${word} ${after}`, "phrase"]);
  });
  return found;
}

// The page, as the leak detector reads it.

/** What `pageStrings` reads a glyph's advance through: the fonts, as the page loads them. */
export type PageFonts = Pick<FontLibrary, "load" | "loadNative">;

/**
 * The page's strings, as the leak detector reads them (`pageStrings`): the reference compile's
 * glyph stream is the document's text as the world reads it, whatever of it the body holds, the
 * header gives or a macro of the preamble writes. Each word of MIN_NEEDLE letters or more; each
 * pair of adjacent words of one line, of MIN_NEEDLE letters or more each, a space between; each
 * identifier, an email, a link's address, host or handle, or a run of DIGITS digits or more; each
 * number of NUMBER digits or more, a house's, a postcode's or a year; and each word the page shows
 * letter-spaced, its letters joined (`letterRuns`). Each once, in the page's order. And how many
 * glyphs the page sets, and how many of those it reads: a glyph whose text or advance its font
 * does not give is read as none.
 */
export interface PageStrings {
  words: readonly string[];
  pairs: readonly string[];
  identifiers: readonly string[];
  numbers: readonly string[];
  runs: readonly string[];
  glyphs: number;
  readable: number;
}

/**
 * The spacing accents TeX's `\accent` sets over a letter, as the page reads their glyphs
 * (`ACCENTS` of `tex/glyphs.ts`): OT1 sets `é` as `´` and `e`, and a word reads on through them.
 */
const SPACING_ACCENTS: ReadonlySet<string> = new Set([..."`´ˆ˜¯˘˙¨˚˝ˇ¸˛"]);

/**
 * The least gap between two glyphs of a line, in ems of the one before it, that parts two words.
 * Over the corpus's references a space, shrunk to its least, is 0.14 em or more, and a kern 0.06
 * em at most, and nothing lies between but a glyph or two.
 */
const WORD_GAP = 0.1;

/**
 * The most a glyph's baseline may move from the one before it, in ems, and the two be read on one
 * line: a superscript moves more.
 */
const BASELINE_MOVE = 0.2;

/**
 * How much wider than the narrowest gap of a run of single letters a gap must be to part two of
 * its letter-spaced words: soul's `\so` sets a quarter of an em between letters, and more than
 * twice that between words.
 */
const RUN_GAP = 1.5;

/** The fewest digits a number the page shows holds for the detector to look for it. */
const NUMBER = 2;

/**
 * The least share of a page's glyphs the detector reads (`pageReadable`), their text and advance
 * known: over the corpus a page it reads reads 97% of them or more, and one set in fonts whose
 * glyphs the page names nothing for, as T1's Computer Modern, whose metrics the tree has and whose
 * outlines it lacks, 1% at most.
 */
export const READABLE_SHARE = 3 / 4;

/**
 * The most glyphs the detector reads for each word of the page's (`pageReadable`): over the
 * corpus a page it reads shows a word, of three letters or more and each once, for every 39
 * glyphs at most.
 */
export const GLYPHS_PER_WORD = 100;

/**
 * Whether the detector can read a page: it reads READABLE_SHARE of its glyphs, a word for every
 * GLYPHS_PER_WORD of those, and a word at least. A page it cannot read tells it nothing of what a
 * macro of the preamble writes, and the request is refused rather than built without it
 * (decision 0033).
 */
export const pageReadable = (page: PageStrings): boolean =>
  page.words.length > 0 &&
  page.readable >= READABLE_SHARE * page.glyphs &&
  page.words.length * GLYPHS_PER_WORD >= page.readable;

/** A host as a page shows one, bare: labels of letters, digits and hyphens, the last of letters. */
const BARE_HOST = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u;

/**
 * The identifiers a word of the page holds, as `identifiersIn` finds them, and a link the page
 * shows without its scheme, `quill.example/type` or `quill.example`, read as `linkIdentifiers`
 * reads an address: its host and its handles.
 */
function pageIdentifiers(token: string): string[] {
  const found = identifiersIn(token);
  const bare = token.replace(/^[(<"'[]+|[)>"'.,;:\]]+$/g, "");
  const host = bare.split(/[/?#]/, 1)[0] ?? "";
  if (
    !bare.includes("@") &&
    !/^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.)/i.test(bare) &&
    host.length <= 253 &&
    BARE_HOST.test(host) &&
    /\.\p{L}{2,}$/u.test(host)
  )
    found.push(...linkIdentifiers(`https://${bare}`));
  return found;
}

/** Whether two files hold the same bytes. */
const sameFile = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * The upload's files by their names, as a native glyph's font names its file (`nativeFileName`):
 * none for a name that files of other bytes share, since which one the output read cannot be told.
 */
function filesByName(upload: Readonly<Record<string, Uint8Array>>) {
  const byName = new Map<string, Uint8Array | undefined>();
  for (const [path, bytes] of Object.entries(upload)) {
    const name = nativeFileName(path);
    const held = byName.get(name);
    if (!byName.has(name)) byName.set(name, bytes);
    else if (held !== undefined && !sameFile(held, bytes)) byName.set(name, undefined);
  }
  return byName;
}

/**
 * The advance of a glyph of a glyph stream, in scaled points, as the font that set it gives it: a
 * TeX font's width from its metrics, at its size, and a native font's advance from its file, at its
 * size and stretched as XeTeX stretches it; or undefined when its font is nowhere. A native font is
 * read as the reference read it: from the upload's file of its name when the stream says the
 * upload's was read (`ReferenceFonts.shipped`), and from the tree's by name otherwise. Each font is
 * loaded once, as the page loads it.
 */
async function advancesOf(
  stream: GlyphStream,
  fonts: PageFonts,
  upload: Readonly<Record<string, Uint8Array>>,
): Promise<(glyph: ReferenceGlyph) => number | undefined> {
  const tex = new Map<string, Tfm | undefined>();
  const native = new Map<string, NativeFontFile | undefined>();
  for (const page of stream.pages)
    for (const item of page.items)
      if (item.kind === "glyph") (item.native === true ? native : tex).set(item.font, undefined);
  const shipped = new Set(stream.fonts.shipped);
  const own = filesByName(upload);
  for (const name of tex.keys())
    tex.set(name, (await fonts.load(name).catch(() => undefined))?.tfm);
  for (const name of native.keys()) {
    if (!shipped.has(name)) {
      native.set(name, (await fonts.loadNative(name).catch(() => undefined))?.file);
      continue;
    }
    const bytes = own.get(name);
    try {
      native.set(name, bytes === undefined ? undefined : parseNativeFont(bytes));
    } catch {
      native.set(name, undefined);
    }
  }
  return (glyph) => {
    if (glyph.native === true) {
      const file = native.get(glyph.font);
      const units = file?.advanceOf(glyph.code);
      if (file === undefined || units === undefined || !(file.unitsPerEm > 0)) return undefined;
      return (units / file.unitsPerEm) * glyph.size * ((glyph.extend ?? 65536) / 65536);
    }
    const tfm = tex.get(glyph.font);
    const info = tfm?.chars[glyph.code - tfm.bc];
    const width = info === undefined ? undefined : tfm?.widths[info.width];
    return width === undefined ? undefined : (width / 2 ** 20) * glyph.size;
  };
}

/** A word of a line of the page: its text, and where it starts and ends, and its first glyph's em. */
interface PageToken {
  text: string;
  start: number;
  end: number;
  em: number;
}

/**
 * The words a line shows letter-spaced, each a run of tokens of one letter apiece joined, as soul's
 * `\so{Quill}` sets `Q u i l l`: a run parted where a gap is RUN_GAP times its narrowest or more,
 * since letter-spacing sets more between words than between letters. Each of MIN_NEEDLE letters
 * or more.
 */
function letterRuns(line: readonly PageToken[]): string[] {
  const runs: string[] = [];
  let run: PageToken[] = [];
  const flush = () => {
    const gaps = run.slice(1).map((token, i) => token.start - (run[i]?.end ?? token.start));
    const least = Math.min(...gaps);
    let word = "";
    run.forEach((token, i) => {
      if (i > 0 && (gaps[i - 1] ?? 0) > RUN_GAP * least) {
        if (lettersOf(word) >= MIN_NEEDLE) runs.push(word);
        word = "";
      }
      word += token.text;
    });
    if (run.length > 1 && lettersOf(word) >= MIN_NEEDLE) runs.push(word);
    run = [];
  };
  for (const token of line) {
    if (/^\p{L}\p{M}*$/u.test(token.text)) run.push(token);
    else flush();
  }
  flush();
  return runs;
}

/**
 * What a reference's glyphs read as, for the leak detector (`PageStrings`): each glyph's text as
 * the page names it (`glyphTextOf`), in the order the output sets them, a line's glyphs joined and
 * parted into words where the gap after a glyph's advance is WORD_GAP of an em or more, and lines
 * parted where a glyph's baseline moves or it steps back; a word TeX hyphenated at a line's end
 * read whole, a spacing accent left out and a mark kept with its letter. A glyph's advance is its
 * font's, read as the reference read the font: the upload's file first, `upload` being the
 * upload's files by path, and the tree's by name second (`advancesOf`). A glyph whose text or
 * advance is not known, as an icon's is not, or one whose font is nowhere, is not read, and parts
 * words. The words are then read as a body's text is read, parted at punctuation (`wordsOf`), and
 * a line's digits as a phone's (`digitRuns`); a pair never spans two lines. It takes time linear in
 * the glyphs.
 */
export async function pageStrings(
  stream: GlyphStream,
  fonts: PageFonts,
  upload: Readonly<Record<string, Uint8Array>> = {},
): Promise<PageStrings> {
  const advance = await advancesOf(stream, fonts, upload);
  const lines: PageToken[][] = [];
  let line: PageToken[] = [];
  let token: PageToken | undefined;
  /** Whether a line ended inside the token being read, a word TeX hyphenated. */
  let broken = false;
  let last: { glyph: ReferenceGlyph; end: number | undefined } | undefined;
  let glyphs = 0;
  let readable = 0;
  const endLine = () => {
    if (line.length > 0) lines.push(line);
    line = [];
  };
  const endToken = () => {
    if (token !== undefined && token.text !== "") line.push(token);
    token = undefined;
    if (broken) endLine();
    broken = false;
  };
  for (const page of stream.pages) {
    endToken();
    endLine();
    last = undefined;
    for (const item of page.items) {
      if (item.kind !== "glyph") continue;
      glyphs++;
      const text = item.text;
      if (text !== undefined && SPACING_ACCENTS.has(text)) {
        readable++;
        continue;
      }
      // A mark goes with the letter before it, wherever XeTeX places it.
      if (text !== undefined && text !== "" && /^\p{M}+$/u.test(text)) {
        readable++;
        if (token !== undefined) token.text += text;
        continue;
      }
      const width = advance(item);
      const known = text !== undefined && width !== undefined;
      if (known) readable++;
      if (last !== undefined) {
        const em = last.glyph.size;
        if (Math.abs(item.v - last.glyph.v) > BASELINE_MOVE * em || item.h < last.glyph.h) {
          // A word TeX hyphenated at a line's end goes on at the next line's start.
          if (
            known &&
            token !== undefined &&
            /\p{L}[-‐­]$/u.test(token.text) &&
            /^\p{Ll}/u.test(text)
          ) {
            token.text = token.text.slice(0, -1);
            broken = true;
          } else {
            endToken();
            endLine();
          }
        } else if (last.end === undefined || item.h - last.end >= WORD_GAP * em) endToken();
      }
      last = { glyph: item, end: width === undefined ? undefined : item.h + width };
      if (!known || text.trim() === "") {
        endToken();
        continue;
      }
      token ??= { text: "", start: item.h, end: item.h, em: item.size };
      token.text += text;
      token.end = item.h + width;
    }
  }
  endToken();
  endLine();
  const words = new Set<string>();
  const pairs = new Set<string>();
  const identifiers = new Set<string>();
  const numbers = new Set<string>();
  const runs = new Set<string>();
  for (const each of lines) {
    const sequence: string[] = [];
    for (const { text } of each) {
      for (const found of pageIdentifiers(text)) identifiers.add(found);
      for (const part of wordsOf(text)) {
        sequence.push(part);
        if (lettersOf(part) >= MIN_NEEDLE) words.add(part);
        if (part.length >= NUMBER && /^\p{Nd}+$/u.test(part)) numbers.add(part);
      }
    }
    for (const run of digitRuns(each.map((each) => each.text).join(" "))) identifiers.add(run);
    // A pair is two adjacent words of one line, each of MIN_NEEDLE letters or more.
    const paired = (word: string | undefined): word is string =>
      word !== undefined && lettered(word) && lettersOf(word) >= MIN_NEEDLE;
    sequence.forEach((word, i) => {
      const next = sequence[i + 1];
      if (paired(word) && paired(next)) pairs.add(`${word} ${next}`);
    });
    for (const run of letterRuns(each)) runs.add(run);
  }
  return {
    words: [...words],
    pairs: [...pairs],
    identifiers: [...identifiers],
    numbers: [...numbers],
    runs: [...runs],
    glyphs,
    readable,
  };
}

/**
 * The document's texts the matchers look for (`Needles`), each of MIN_NEEDLE letters and digits
 * or more, and none shaped as a placeholder. What the builder masks by: every phrase, two words or
 * more that start with letters, of the body's text runs, dates and raw chunks' pieces, of the
 * header's values, the name whole among them, and of the texts the preamble stores, each with its
 * pairs of adjacent words that start with letters; every identifier any of them holds, and each
 * link's, the header's and the body's alike; and each word of the header's name of MIN_NEEDLE
 * letters or more; the header's location, a postal address, by its postcodes of letters and
 * digits and by each of its words that holds a digit, a street's number or a postcode of digits,
 * with the word before it and the word after it (`addressNeedles`); and from the page
 * (`PageStrings`), its identifiers, its pairs of words, each word it shows letter-spaced, its
 * letters joined, and each number of two digits or more, which mask the document's own definitions
 * alone (`ownHidden`). Never a link's label, which is the class's word as often as not (`GitHub`),
 * nor a single word of the body's, a stored text's or the page's. What the check looks for
 * (`check`) is that and every other text of the document's besides, the single words among them,
 * the page's too. A text of the body's that holds `=` is code, `leftmargin=*`, and so is a raw
 * chunk's quantity, `0.5cm`, and a single word of its options' brackets, `\faFile*[regular]`: none
 * is looked for.
 */
function needlesOf(document: DocumentText, check: boolean): Needles {
  const byPrefix = new Map<string, Needle[]>();
  const short = new Map<string, Needle[]>();
  const pairs = new Map<string, Origin>();
  const spaced = new Set<string>();
  const seen = new Set<string>();
  const add = (text: string, origin: Origin, shape: Needle["shape"]) => {
    const found = folded(text);
    const chars = [...found];
    if (chars.length < (shape === "number" ? NUMBER : MIN_NEEDLE) || placeholderLike(found)) return;
    // The header's needles are kept apart, so that the check knows a word of the name as the
    // header's wherever the body writes it too.
    const id = `${shape} ${origin === "header" ? "header" : ""} ${found}`;
    if (seen.has(id)) return;
    seen.add(id);
    const [map, size] = chars.length < MIN_NEEDLE ? [short, NUMBER] : [byPrefix, MIN_NEEDLE];
    const prefix = chars.slice(0, size).join("");
    const list = map.get(prefix) ?? [];
    list.push({ chars, origin, shape });
    map.set(prefix, list);
  };
  const text = (value: string | undefined, origin: Origin, body = false, option = false) => {
    if (value === undefined) return;
    for (const each of identifiersIn(value)) add(each, origin, "identifier");
    if (body && (value.includes("=") || QUANTITY.test(value.trim()))) return;
    const words = wordsOf(value).map(folded);
    const named = words.filter(lettered);
    if (named.length < 2) {
      if (!check || option) return;
      add(value, origin, "word");
      // A text of one word and numbers, a name set above a phone number, holds the word alone.
      const [only] = named;
      if (only !== undefined && words.length > 1 && origin !== "date") add(only, origin, "word");
      return;
    }
    add(value, origin, "phrase");
    for (let i = 0; i + 1 < words.length; i++) {
      const [one = "", two = ""] = [words[i], words[i + 1]];
      const pair = `${one} ${two}`;
      if (lettered(one) && lettered(two) && `${one}${two}`.length >= MIN_NEEDLE && !pairs.has(pair))
        pairs.set(pair, origin);
    }
  };
  const link = (href: string | undefined, origin: Origin) => {
    for (const each of href === undefined ? [] : linkIdentifiers(href))
      add(each, origin, "identifier");
  };
  const source = document.tree.source;
  for (const node of nodesOf(document.tree.content)) {
    if (node.kind === "text") {
      text(node.runs.map((run) => run.text).join(""), "text", true);
      for (const run of node.runs) {
        text(run.text, "text", true);
        link(run.href, "link");
      }
    } else if (node.kind === "date") text(node.text, "date", true);
    else if (node.kind === "raw")
      for (const piece of rawPieces(source.slice(node.start, node.end)))
        text(piece.text, "raw", true, piece.bracketed);
  }
  const header = document.header ?? {};
  for (const value of [header.first, header.last, header.headline, header.email, header.phone])
    text(value, "header");
  text(header.location, "header");
  for (const [each, shape] of addressNeedles(header.location)) add(each, "header", shape);
  if (header.first !== undefined || header.last !== undefined)
    text(`${header.first ?? ""} ${header.last ?? ""}`.trim(), "header");
  for (const each of header.links ?? []) link(each.href, "header");
  for (const value of [header.first, header.last])
    for (const word of wordsOf(value ?? ""))
      if (lettersOf(word) >= MIN_NEEDLE) add(word, "header", "word");
  for (const value of document.stored ?? []) text(value, "stored");
  // The page, last, so that a text the body or the header holds too is known as theirs: its
  // identifiers, its pairs of words, which mask an own definition where it holds them adjacent or
  // parted by glue alone (`pairsFound`), never across other code as a phrase is found, its
  // letter-spaced words and its numbers; and for the check its single words too.
  const page = document.page;
  for (const each of page?.identifiers ?? []) add(each, "page", "identifier");
  for (const pair of page?.pairs ?? []) {
    const key = wordsOf(pair).map(folded).join(" ");
    if (!pairs.has(key)) pairs.set(key, "page");
  }
  for (const run of page?.runs ?? []) add(run, "page", "run");
  for (const number of page?.numbers ?? []) add(number, "page", "number");
  if (check) for (const word of page?.words ?? []) add(word, "page", "word");
  for (const word of [...(page?.words ?? []), ...(page?.runs ?? [])])
    if (lettersOf(word) >= NAME_WORD) spaced.add(folded(word));
  return { byPrefix, short, pairs, spaced };
}

// What a matcher reads of a request's texts.

/**
 * The letters and digits of a text a matcher reads, folded (`fold`): where each is in the text,
 * the code units from `at` to `to` that spell it, as `\o ` spells `ø` and `\' {e}` spells `é`, and
 * the character it stands for (`shown`), which a placeholder writes; whether each starts a word,
 * which it does when anything but a letter, a digit or a mark comes before it; whether each opens
 * a literal, a stretch of text that no command, brace, parameter or code parts; and whether what
 * parts it from the one before is glue alone (`glued`): space, a break, braces and the commands
 * that set nothing but those, a font or a size (`GLUE`), which part no pair of words on the page.
 */
interface Visible {
  at: number[];
  to: number[];
  text: string[];
  shown: string[];
  starts: boolean[];
  opens: boolean[];
  glued: boolean[];
}

/**
 * A visible text being read: `push` a character the reader met, and the code units that spell it;
 * `gap` anything between words; `glue` what ends a literal and parts no pair; `boundary` anything
 * else that ends one; `drop` the characters read since a place, which were code after all, as a
 * key is once its `=` comes.
 */
function reader() {
  const visible: Visible = {
    at: [],
    to: [],
    text: [],
    shown: [],
    starts: [],
    opens: [],
    glued: [],
  };
  let gap = true;
  let open = true;
  /** Whether anything but glue came since the character before. */
  let hard = true;
  return {
    visible,
    push(at: number, char: string, to = at + char.length) {
      // A mark is part of its letter's word, as a Devanagari vowel sign is.
      if (/^\p{M}$/u.test(char)) return;
      const letter = fold(char);
      if (letter === "") {
        gap = true;
        return;
      }
      visible.at.push(at);
      visible.to.push(to);
      visible.text.push(letter);
      visible.shown.push(char);
      visible.starts.push(gap);
      visible.opens.push(open);
      visible.glued.push(open && !hard);
      gap = false;
      open = false;
      hard = false;
    },
    gap() {
      gap = true;
    },
    glue() {
      gap = true;
      open = true;
    },
    boundary() {
      gap = true;
      open = true;
      hard = true;
    },
    drop(from: number) {
      if (visible.opens.slice(from).includes(true)) open = true;
      for (const list of Object.values(visible)) list.length = Math.min(list.length, from);
      gap = true;
      hard = true;
    },
  };
}

/**
 * What a pattern masked (`maskDefinition`), `<link____>`: its kind's name is the contract's word,
 * not the text's, and no matcher reads it.
 */
const PATTERN_PLACEHOLDER = /<(?:link|email|phone|postcode)_*>/y;

/** The length of a pattern's placeholder at `at` of a text, or 0. */
function placeholderAt(text: string, at: number): number {
  PATTERN_PLACEHOLDER.lastIndex = at;
  return PATTERN_PLACEHOLDER.exec(text)?.[0].length ?? 0;
}

/**
 * The letters and digits of source a matcher reads: not a command's name, `\begin` and `\end` with
 * the environment's, nor a control symbol's character; nor what a comment holds, nor a pattern's
 * placeholder.
 */
export function visibleOfSource(source: string): Visible {
  const read = reader();
  for (let i = 0; i < source.length; ) {
    const char = source[i] ?? "";
    const masked = char === "<" ? placeholderAt(source, i) : 0;
    if (masked > 0) {
      read.boundary();
      i += masked;
      continue;
    }
    if (char === "%") {
      read.boundary();
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "\\") {
      let j = i + 1;
      while (j < source.length && /[A-Za-z]/.test(source[j] ?? "")) j++;
      if (j === i + 1) {
        read.gap();
        i += 1 + ([...source.slice(i + 1, i + 3)][0]?.length ?? 1);
        continue;
      }
      read.boundary();
      const name = source.slice(i + 1, j);
      if (name === "begin" || name === "end") {
        let k = j;
        while (k < source.length && /[ \t\n\r]/.test(source[k] ?? "")) k++;
        const close = source[k] === "{" ? source.indexOf("}", k) : -1;
        if (close > 0 && /^[A-Za-z@*]*$/.test(source.slice(k + 1, close))) j = close + 1;
      }
      i = j;
      continue;
    }
    if (char === "{" || char === "}") {
      read.boundary();
      i++;
      continue;
    }
    const code = source.codePointAt(i) ?? 0;
    const whole = String.fromCodePoint(code);
    read.push(i, whole);
    i += whole.length;
  }
  return read.visible;
}

/** A name xparse gives a command's code, after the command's own name: `\cvxp code`. */
const COMMAND_CODE = /^code /;

/** And an environment's, after `\environment`: `\environment cvbox end code`. */
const ENVIRONMENT_CODE = /^[^\s\\{}]+ (?:end aux|end code|end|code) /;

/**
 * A control sequence at `at` of a meaning, as the engine prints one there (`signatures.ts`): its
 * name, and where it ends. The printout writes a space after a name of more than one character,
 * and after one of any printable character but the backslash, whose category is the escape's while
 * it prints: so `\\` is the control symbol, a line's end, with nothing after it, and what follows
 * it is text, or the next token, `\\Harbour` the break and then a word; and a character outside
 * printable ASCII that is no letter is one of its own, as a control symbol. But a command's optional-argument code
 * is named by a backslash and the command's name, `\\cvitem `, a space after it: the kernel's
 * `\@protected@testopt \cvitem \\cvitem {}` hands its work to it, and `before`, the name of the
 * control word that ends where this one starts, tells it so. A name xparse gives a command's or an
 * environment's code, which holds spaces, is read whole.
 */
function controlSequence(
  meaning: string,
  at: number,
  to: number,
  before?: string,
): { name: string; end: number } {
  const next = meaning.codePointAt(at + 1);
  if (next === undefined || at + 1 >= to) return { name: "", end: at + 1 };
  if (next === 32) return { name: " ", end: at + 2 };
  if (next === 92) {
    const named =
      before === undefined
        ? undefined
        : before === "@testopt"
          ? /^[^\s\\{}]+(?= )/.exec(meaning.slice(at + 2, Math.min(to, at + 258)))?.[0]
          : meaning.startsWith(`${before} `, at + 2) && at + 3 + before.length <= to
            ? before
            : undefined;
    return named === undefined
      ? { name: "\\", end: at + 2 }
      : { name: `\\${named}`, end: at + 3 + named.length };
  }
  if (next < 33 || (next > 126 && !/^\p{L}$/u.test(String.fromCodePoint(next)))) {
    const char = String.fromCodePoint(next);
    return { name: char, end: at + 1 + char.length };
  }
  const space = meaning.indexOf(" ", at + 1);
  const stop = space < 0 || space >= to ? to : space;
  let name = meaning.slice(at + 1, stop);
  let end = Math.min(to, stop + 1);
  const code = (name === "environment" ? ENVIRONMENT_CODE : COMMAND_CODE).exec(
    meaning.slice(end, Math.min(to, end + 256)),
  );
  if (code !== null) {
    name = `${name} ${code[0].trimEnd()}`;
    end += code[0].length;
  }
  return { name, end };
}

/**
 * LaTeX's letter commands, and the letter each sets: `Bj\o rnstad` is `Bjørnstad` on the page, and
 * a matcher reads it so, the letter spelt by the command and the space the printout writes after
 * it. `\i` and `\j`, the dotless letters, are `i` and `j` under an accent.
 */
const LETTER_COMMANDS: ReadonlyMap<string, string> = new Map([
  ...[
    ["o", "ø"],
    ["O", "Ø"],
    ["l", "ł"],
    ["L", "Ł"],
    ["ae", "æ"],
    ["AE", "Æ"],
    ["oe", "œ"],
  ],
  ...[
    ["OE", "Œ"],
    ["aa", "å"],
    ["AA", "Å"],
    ["ss", "ß"],
    ["SS", "SS"],
    ["i", "ı"],
    ["j", "ȷ"],
  ],
  ...[
    ["dh", "ð"],
    ["DH", "Ð"],
    ["th", "þ"],
    ["TH", "Þ"],
    ["ng", "ŋ"],
    ["NG", "Ŋ"],
    ["dj", "đ"],
  ],
  ...[["DJ", "Đ"]],
] as [string, string][]);

/**
 * LaTeX's accent commands, and the combining mark each puts on the letter after it: `Mar\' {\i }n`
 * reads `Marín`, the accented letter composed (NFC), as the page names it.
 */
const ACCENTS: ReadonlyMap<string, string> = new Map([
  ...[
    ["'", "́"],
    ["`", "̀"],
    ["^", "̂"],
    ['"', "̈"],
    ["~", "̃"],
  ],
  ...[
    ["=", "̄"],
    [".", "̇"],
    ["u", "̆"],
    ["v", "̌"],
    ["H", "̋"],
  ],
  ...[
    ["c", "̧"],
    ["k", "̨"],
    ["r", "̊"],
    ["b", "̱"],
    ["d", "̣"],
  ],
  ...[["t", "͡"]],
] as [string, string][]);

/**
 * Commands that put nothing between two words but space, a break, a change of font or size, or a
 * group that holds text: glue, which a page pair matches across (`pairsFound`), as
 * `Quill\hspace{0.4em}Invented` and `\textbf{Quill} \textbf{Invented}` show a pair on the page.
 */
const GLUE: ReadonlySet<string> = new Set([
  ...["par", "newline", "linebreak", "quad", "qquad", "enskip", "enspace", "thinspace"],
  ...["negthinspace", "hfill", "hfil", "hss", "vfill", "vfil", "noindent", "indent"],
  ...["leavevmode", "relax", "ignorespaces", "unskip", "strut", "centering", "raggedright"],
  ...["raggedleft", "protect", "nobreak", "allowbreak", "bfseries", "mdseries", "itshape"],
  ...["slshape", "scshape", "upshape", "rmfamily", "sffamily", "ttfamily", "normalfont", "em"],
  ...["bf", "it", "sc", "rm", "sf", "tt", "sl", "selectfont", "tiny", "scriptsize"],
  ...["footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"],
  ...["textbf", "textit", "textsc", "textsf", "textrm", "texttt", "textup", "textmd", "textsl"],
  ...["textnormal", "emph", "underline", "mbox", "hbox", "text", "uppercase", "lowercase"],
  ...["MakeUppercase", "MakeLowercase", "MakeTextUppercase", "MakeTextLowercase"],
]);

/**
 * TeX's commands whose argument is a length and no group, `\hskip 2pt plus 1fil`: code, and glue.
 */
const BARE_LENGTHS: ReadonlySet<string> = new Set(["hskip", "vskip", "kern", "hglue", "vglue"]);

/** A length after one of BARE_LENGTHS: a number and a unit or a register, and its stretch. */
const BARE_LENGTH =
  /^ ?[-+]? ?(?:(?:\d+(?:[.,]\d*)?|[.,]\d+) ?(?:true ?)?(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu|px|fil{1,3})|\\[A-Za-z@]+ ?)(?: ?(?:plus|minus) ?[-+]? ?(?:(?:\d+(?:[.,]\d*)?|[.,]\d+) ?(?:true ?)?(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu|px|fil{1,3})|\\[A-Za-z@]+ ?))*/;

/** What a command whose arguments are code takes: its mandatory arguments, and optional ones after. */
interface Takes {
  take: number;
  after?: true;
}

/** A list of commands that take `take` arguments of code, and optional ones after them when `after`. */
const takes = (take: number, names: readonly string[], after?: true) =>
  names.map((name): [string, Takes] => [name, after === undefined ? { take } : { take, after }]);

/**
 * LaTeX's commands whose arguments are lengths, braced, a star before them or none: code, which a
 * matcher reads as nothing, and glue.
 */
const BRACED_LENGTHS: ReadonlyMap<string, Takes> = new Map([
  ...takes(1, ["hspace", "vspace", "addvspace", "hskip@", "phantom", "hphantom", "vphantom"]),
  ...takes(2, ["rule"]),
]);

/**
 * Commands whose arguments are code, not text the page shows, as a matcher reads a meaning, and how
 * many mandatory arguments each takes, braced or a single token, the optional ones before and
 * between them with them: a colour's, a counter's, a length's or a boolean's name, a package's, a
 * class's or a file's, a graphic's among them, a label or a link's target, a key list, a font's
 * name and features, an icon's name, a language, a condition, pgf's mathematics, and a message's
 * text, which the log shows and the page never does; and tikz's paths' option lists, whose every
 * entry is a key, `[rounded corners]`. `\csname` to `\endcsname` is code too, and so is each key of
 * a key list, the text before an `=`, and in an option list's brackets each value, as tikz's
 * `[draw=white]` has it.
 */
const CODE: ReadonlyMap<string, Takes> = new Map([
  ...takes(1, ["color", "pagecolor", "textcolor", "colorbox", "rowcolor", "cellcolor"]),
  ...takes(1, ["columncolor", "arrayrulecolor", "stepcounter", "refstepcounter", "value"]),
  ...takes(1, ["usecounter", "newlength", "@nameuse", "@namedef", "begin", "end", "input"]),
  ...takes(1, ["include", "label", "ref", "pageref", "hyperlink", "hypertarget", "hypersetup"]),
  ...takes(1, ["pgfkeys", "tikzset", "pgfkeysvalueof", "pgfmathparse", "ifbool", "newbool"]),
  ...takes(1, ["boolean", "ifthenelse", "@ifundefined", "@ifpackageloaded", "@ifclassloaded"]),
  ...takes(1, ["IfFileExists", "fontfamily", "fontseries", "fontshape", "fontencoding"]),
  ...takes(1, ["selectlanguage", "foreignlanguage", "typeout", "message", "wlog"]),
  ...takes(1, ["@latex@warning", "@latex@warning@no@line", "@latex@info", "@latex@info@no@line"]),
  ...takes(2, ["colorlet", "fcolorbox", "setcounter", "addtocounter", "setlength", "addtolength"]),
  ...takes(2, ["setbool", "equal", "fontsize", "pgfmathsetmacro", "pgfmathtruncatemacro"]),
  ...takes(2, ["pgfmathsetlengthmacro", "pgfmathsetlength", "pgfmathsetcount"]),
  ...takes(2, ["PackageWarning", "PackageWarningNoLine", "PackageInfo", "ClassWarning"]),
  ...takes(2, ["ClassWarningNoLine", "ClassInfo", "GenericWarning", "GenericInfo", "@latex@error"]),
  ...takes(3, ["definecolor", "rowcolors", "PackageError", "ClassError"]),
  ...takes(4, ["usefont", "GenericError"]),
  ...takes(1, ["newcounter", "usepackage", "RequirePackage", "documentclass", "fontspec"], true),
  ...takes(1, ["setmainfont", "setsansfont", "setmonofont"], true),
  ...takes(2, ["newfontfamily"], true),
  ...takes(1, ["includegraphics", "faIcon"]),
  // tikz's option lists, `\node [rounded corners, draw=white]`: each entry a key, code.
  ...takes(0, ["tikz", "node", "draw", "path", "fill", "filldraw", "shade", "shadedraw"], true),
  ...takes(0, ["clip", "coordinate", "matrix", "pic", "tikzpicture"], true),
]);

/**
 * A quantity a definition writes as code where a matcher meets a number: a number and a unit,
 * `12pt`, or a length's register, `0.97\textwidth`, or a fraction below one, `0.85`, as a class's
 * table and box widths are, never a house's number, a postcode or a year, which the page shows.
 */
const QUANTITY_AT =
  /^[-+]?(?:(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:true ?)?(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu|px|fil{1,3})(?![A-Za-z])|(?:\d+(?:[.,]\d*)?|[.,]\d+) ?\\[A-Za-z@]*(?:width|height|size|skip|sep|indent|margin|depth|fill)(?![A-Za-z@])|0?[.,]\d+)/;

/**
 * The schemes of an address a definition writes as code, `https://\@homepage` or
 * `skype:\@skype?call`, whose letters are the protocol's, never text a page shows as the person's:
 * a word of them right before `:` and anything but a space is code, as a key is before its `=`.
 */
const SCHEMES: ReadonlySet<string> = new Set([
  ...["http", "https", "ftp", "ftps", "sftp", "file", "mailto", "tel", "callto", "skype", "sms"],
  ...["fax", "geo", "xmpp", "irc", "ircs", "matrix", "tg", "whatsapp", "viber", "facetime"],
]);

/**
 * Where a group of a meaning that opens at `at` with `open` ends, past its `close`, braces nested
 * and control sequences passed over; or -1 when it does not close before `to`, or before the group
 * it is in does.
 */
function groupEnd(meaning: string, at: number, to: number, open: string, close: string): number {
  let depth = 0;
  let braces = 0;
  for (let i = at; i < to; i++) {
    const char = meaning[i];
    if (char === "\\") i++;
    else if (open === "{") {
      if (char === "{") depth++;
      else if (char === "}" && --depth === 0) return i + 1;
    } else if (char === "{") braces++;
    else if (char === "}" && --braces < 0) return -1;
    else if (braces === 0 && char === open) depth++;
    else if (braces === 0 && char === close && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Where a code command's arguments (`CODE`) end, from `at`, just past the command: a star first is
 * the command's own, as `\hspace *{...}`'s.
 */
function pastArguments(meaning: string, at: number, to: number, code: Takes): number {
  let i = at;
  const spaces = () => {
    while (i < to && meaning[i] === " ") i++;
  };
  const bracketed = () => {
    const end = meaning[i] === "[" ? groupEnd(meaning, i, to, "[", "]") : -1;
    if (end > 0) i = end;
    return end > 0;
  };
  if (meaning[i] === "*") i++;
  for (let taken = 0; taken < code.take; ) {
    spaces();
    if (i >= to || meaning[i] === "}") return i;
    if (bracketed()) continue;
    if (meaning[i] === "{") {
      const end = groupEnd(meaning, i, to, "{", "}");
      if (end < 0) return i;
      i = end;
    } else if (meaning[i] === "\\") i = controlSequence(meaning, i, to).end;
    else if (meaning[i] === "#" && /[1-9#]/.test(meaning[i + 1] ?? "")) i += 2;
    else i += String.fromCodePoint(meaning.codePointAt(i) ?? 0).length;
    taken++;
  }
  for (let before = i; code.after !== undefined; before = i) {
    spaces();
    if (!bracketed()) {
      i = before;
      break;
    }
  }
  return i;
}

/** A key of a key list, the text before its `=`: letters, digits, spaces and a key's punctuation. */
const KEY = /^[\s\p{L}\p{N}@*./-]+$/u;

/**
 * The letters and digits of a `\meaning` a matcher reads, of its parameter text and its
 * replacement text: not a command's name, which TeX prints up to the space after it, an
 * environment's after `\begin` or `\end`, nor a parameter; nor any argument a command takes as code
 * (`CODE`) or as a length (`BRACED_LENGTHS`, `BARE_LENGTHS`), what `\csname` names, a key of a key
 * list, an address's scheme (`SCHEMES`), a quantity (`QUANTITY_AT`), or a pattern's placeholder. A
 * letter command is its letter (`LETTER_COMMANDS`), an accent
 * and the letter after it the accented letter (`ACCENTS`), and `\-`, `\/` and an empty group
 * nothing, so that `Bj\o rnstad`, `Mar\' {\i }n` and `Wei\ss {}enfeld` read as the page shows them.
 * A control word, a parameter, an option's bracket and code each end a literal; glue ends one and
 * parts no pair (`GLUE`, braces and `\\`, a line's end); a control symbol else parts words and not
 * literals.
 */
export function visibleOfMeaning(meaning: string): Visible {
  const read = reader();
  const head = /^((?:\\(?:protected|long|outer) ?)*)macro:/.exec(meaning);
  if (head === null) return read.visible;
  const arrow = meaning.indexOf("->", head[0].length);
  /** Where an option's value that starts at `at` ends: at its list's next `,` or its `]`. */
  const valueEnd = (at: number, to: number) => {
    let j = at;
    while (j < to && !",]}".includes(meaning[j] ?? "")) {
      if (meaning[j] === "{") {
        const end = groupEnd(meaning, j, to, "{", "}");
        if (end < 0) return to;
        j = end;
      } else if (meaning[j] === "\\") j = controlSequence(meaning, j, to).end;
      else j++;
    }
    return j;
  };
  /**
   * The letter an accent at `from`, just past its command, puts its mark on, braced or not, a
   * letter command's among them, and the accented letter composed; or undefined for none.
   */
  const accented = (from: number, to: number, mark: string) => {
    let at = from;
    const braced = meaning[at] === "{";
    if (braced) at++;
    let base: string | undefined;
    if (meaning[at] === "\\") {
      const { name, end } = controlSequence(meaning, at, to);
      base = name === "i" || name === "j" ? name : LETTER_COMMANDS.get(name);
      at = end;
    } else {
      const char = String.fromCodePoint(meaning.codePointAt(at) ?? 0);
      if (at < to && /^\p{L}$/u.test(char)) base = char;
      at += char.length;
    }
    if (base === undefined || [...base].length !== 1 || at > to) return undefined;
    if (braced) {
      if (meaning[at] !== "}") return undefined;
      at++;
    }
    return { char: `${base}${mark}`.normalize("NFC"), end: at };
  };
  const scan = (from: number, to: number) => {
    read.boundary();
    let key = { at: 0, from };
    const keyFrom = (at: number) => {
      key = { at: read.visible.text.length, from: at };
    };
    keyFrom(from);
    /** The groups open where the reader is: `{` and `[`, the innermost last. */
    const groups: string[] = [];
    const closeGroup = (opener: string) => {
      const at = groups.lastIndexOf(opener);
      if (at >= 0 && (opener === "{" || at > groups.lastIndexOf("{"))) groups.length = at;
    };
    /**
     * The control word read last, and where it ended, spaces after it passed over, which names
     * `\\cvitem ` after `\cvitem `, and after a robust command's `\cvitem  `.
     */
    let last = { name: "", end: -1 };
    for (let i = from; i < to; ) {
      const char = meaning[i] ?? "";
      if (char === "\\") {
        const { name, end } = controlSequence(
          meaning,
          i,
          to,
          last.end === i ? last.name : undefined,
        );
        let after = end;
        while (after < to && meaning[after] === " ") after++;
        last = { name, end: after };
        const letter = LETTER_COMMANDS.get(name);
        if (letter !== undefined) {
          for (const each of letter) read.push(i, each, end);
          i = end;
          continue;
        }
        const mark = ACCENTS.get(name);
        const accent = mark === undefined ? undefined : accented(end, to, mark);
        if (accent !== undefined) {
          read.push(i, accent.char, accent.end);
          i = accent.end;
          continue;
        }
        i = end;
        // A discretionary hyphen, and an italic correction, set nothing between two letters.
        if (name === "-" || name === "/") continue;
        const length = BRACED_LENGTHS.get(name);
        if ([...name].length === 1 && !/^[A-Za-z]$/.test(name)) {
          if (name === "\\") read.glue();
          else read.gap();
        } else if (GLUE.has(name)) read.glue();
        else if (length !== undefined) {
          read.glue();
          i = pastArguments(meaning, i, to, length);
        } else if (BARE_LENGTHS.has(name)) {
          read.glue();
          i += BARE_LENGTH.exec(meaning.slice(i, Math.min(to, i + 256)))?.[0].length ?? 0;
        } else {
          read.boundary();
          if (name === "csname" || name === "ifcsname") {
            const close = meaning.indexOf("\\endcsname", i);
            i = close < 0 || close >= to ? to : controlSequence(meaning, close, to).end;
          } else {
            const code = CODE.get(name);
            if (code !== undefined) i = pastArguments(meaning, i, to, code);
          }
        }
        keyFrom(i);
        continue;
      }
      if (char === "#" && /[1-9#]/.test(meaning[i + 1] ?? "")) {
        read.boundary();
        i += 2;
        keyFrom(i);
        continue;
      }
      // An empty group sets nothing, as `Wei\ss{}enfeld`'s parts no word.
      if (char === "{" && meaning[i + 1] === "}") {
        i += 2;
        continue;
      }
      if (char === "{" || char === "}") {
        if (char === "{") groups.push(char);
        else closeGroup("{");
        read.glue();
        i++;
        keyFrom(i);
        continue;
      }
      if (char === "=") {
        const before = meaning.slice(key.from, i);
        if (before.length <= MAX_KEY && KEY.test(before) && /\p{L}/u.test(before))
          read.drop(key.at);
        read.gap();
        i++;
        // In an option list's brackets, the value is code too: `draw=white`, `anchor=west`.
        if (groups.at(-1) === "[") {
          read.boundary();
          i = valueEnd(i, to);
        }
        keyFrom(i);
        continue;
      }
      if (char === "[" || char === "]") {
        if (char === "[") groups.push(char);
        else closeGroup("[");
        read.boundary();
        i++;
        keyFrom(i);
        continue;
      }
      if (",;()".includes(char)) {
        read.gap();
        i++;
        keyFrom(i);
        continue;
      }
      // An address's scheme is code, `https://\@homepage`, where no link is left to mask.
      if (char === ":" && !/[\s}]/.test(meaning[i + 1] ?? " ")) {
        const before = meaning.slice(key.from, i);
        if (SCHEMES.has(before.toLowerCase())) {
          read.drop(key.at);
          i++;
          keyFrom(i);
          continue;
        }
      }
      const masked = char === "<" ? placeholderAt(meaning, i) : 0;
      if (masked > 0 && i + masked <= to) {
        read.boundary();
        i += masked;
        keyFrom(i);
        continue;
      }
      // A quantity, `0.97\textwidth` or `12pt`, is code, where a word does not go on into it.
      const quantity =
        /[\d.,+-]/.test(char) && !/[\p{L}\p{N}]/u.test(meaning[i - 1] ?? "")
          ? QUANTITY_AT.exec(meaning.slice(i, Math.min(to, i + 64)))
          : null;
      if (quantity !== null) {
        read.boundary();
        i += quantity[0].length;
        keyFrom(i);
        continue;
      }
      const whole = String.fromCodePoint(meaning.codePointAt(i) ?? 0);
      read.push(i, whole);
      i += whole.length;
    }
  };
  if (arrow < 0) scan(head[0].length, meaning.length);
  else {
    scan(head[0].length, arrow);
    scan(arrow + 2, meaning.length);
  }
  return read.visible;
}

/** The words of a visible text, each its folded letters and digits, in order. */
function visibleWords(visible: Visible): string[] {
  const words: string[] = [];
  visible.text.forEach((char, i) => {
    if (visible.starts[i] === true || words.length === 0) words.push(char);
    else words[words.length - 1] += char;
  });
  return words;
}

/**
 * The tree's vocabulary: every word and number the tree's definitions a request carries show as
 * text (`visibleOfMeaning`), folded, tikz's `node` and `at`, hyperref's `http`, a class's `Page`.
 * It is built from the request itself, never from a dictionary: the check reads no word of it as
 * the person's alone in an own definition or a name, and no pair of the page's that holds one of
 * them masks an own definition (decision 0033).
 */
function vocabularyOf(meanings: Iterable<string>): Set<string> {
  const vocabulary = new Set<string>();
  for (const meaning of meanings)
    for (const word of visibleWords(visibleOfMeaning(meaning))) vocabulary.add(word);
  return vocabulary;
}

/** How a matcher takes a text of the document's: as whole words, anywhere, or not at all. */
type Take = "whole" | "anywhere" | undefined;

/**
 * Which of a text's visible characters spell a text of the document's, as `take` has each taken,
 * and where the first came from: `whole`, only where it starts a word and ends one; `anywhere`,
 * inside words too.
 */
function found(
  visible: Visible,
  needles: Needles,
  take: (needle: Needle) => Take,
): { hide: Uint8Array; origin?: Origin } {
  const chars = visible.text;
  const size = chars.length;
  const hide = new Uint8Array(size);
  let origin: Origin | undefined;
  const startsAt = (i: number) => i >= size || visible.starts[i] === true;
  const at = (i: number, needle: Needle) => needle.chars.every((char, k) => chars[i + k] === char);
  /** Whether a word starts inside a stretch, past its first character. */
  const parted = (i: number, length: number) =>
    visible.starts.slice(i + 1, i + length).includes(true);
  const look = (i: number, candidates: readonly Needle[] | undefined) => {
    for (const needle of candidates ?? []) {
      const how = take(needle);
      const length = needle.chars.length;
      if (how === undefined || i + length > size || !at(i, needle)) continue;
      if (how === "whole" && !(startsAt(i) && startsAt(i + length))) continue;
      // A number is one word, never digits a range's or a list's punctuation parts, `1,...,5`.
      if (needle.shape === "number" && parted(i, length)) continue;
      hide.fill(1, i, i + length);
      origin ??= needle.origin;
    }
  };
  for (let i = 0; i + NUMBER <= size; i++) {
    if (i + MIN_NEEDLE <= size)
      look(i, needles.byPrefix.get(`${chars[i]}${chars[i + 1]}${chars[i + 2]}`));
    if (needles.short.size > 0) look(i, needles.short.get(`${chars[i]}${chars[i + 1]}`));
  }
  return { hide, ...(origin === undefined ? {} : { origin }) };
}

/**
 * The pairs of adjacent words of a text that a phrase of the document holds, or the page shows
 * (the literal rule, in the definition's direction), marked in `hide`, and where the first came
 * from: `{\Large Quill Invented}` holds a pair of the paragraph `Quill Invented, typesetter at
 * Larkspur Labs`, though not the paragraph. The two words sit in one literal, or glue alone parts
 * them (`Visible.glued`), `Quill\hspace{0.4em}Invented`, never an option's bracket, a parameter or
 * code; and a pair of the page's that holds a word of the tree's vocabulary is no needle, tikz's
 * `node` and `at` a resume's `Node at` (C2 of item 11's review).
 */
function pairsFound(
  visible: Visible,
  pairs: ReadonlyMap<string, Origin>,
  hide: Uint8Array,
  vocabulary: ReadonlySet<string>,
) {
  let origin: Origin | undefined;
  const words: { from: number; to: number; literal: number; text: string }[] = [];
  let literal = -1;
  visible.text.forEach((char, i) => {
    if (visible.opens[i] === true) literal++;
    const last = words.at(-1);
    if (visible.starts[i] === true || last === undefined)
      words.push({ from: i, to: i + 1, literal, text: char });
    else {
      last.to = i + 1;
      last.text += char;
    }
  });
  for (let w = 0; w + 1 < words.length; w++) {
    const first = words[w];
    const second = words[w + 1];
    if (first === undefined || second === undefined) continue;
    if (first.literal !== second.literal && visible.glued[second.from] !== true) continue;
    const hit = pairs.get(`${first.text} ${second.text}`);
    if (hit === undefined) continue;
    if (hit === "page" && (vocabulary.has(first.text) || vocabulary.has(second.text))) continue;
    hide.fill(1, first.from, second.to);
    origin ??= hit;
  }
  return origin;
}

/**
 * The words a definition spells letter-spaced, a letter a word, as europecv's kerned title,
 * `E\ecv@kern u\ecv@kern r...`, that the page shows whole (`Needles.spaced`) and the tree's
 * vocabulary does not hold, marked in `hide`: a word so spelt is the page's text, set in a way of
 * its own, as the joined letters of a word the page shows letter-spaced are (`PageStrings.runs`).
 */
function spacedFound(
  visible: Visible,
  words: ReadonlySet<string>,
  hide: Uint8Array,
  vocabulary: ReadonlySet<string>,
): Origin | undefined {
  let origin: Origin | undefined;
  const size = visible.text.length;
  const single = (i: number) =>
    visible.starts[i] === true &&
    (i + 1 >= size || visible.starts[i + 1] === true) &&
    /^\p{L}$/u.test(visible.text[i] ?? "");
  for (let i = 0; i < size; ) {
    if (!single(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < size && single(j)) j++;
    for (let a = i; a < j; a++) {
      let spelt = "";
      for (let b = a; b < j && b - a < 64; b++) {
        spelt += visible.text[b];
        if (b - a + 1 < NAME_WORD || !words.has(spelt) || vocabulary.has(spelt)) continue;
        hide.fill(1, a, b + 1);
        origin ??= "page";
      }
    }
    i = j;
  }
  return origin;
}

/**
 * What of an own definition's visible text is the document's (decision 0024): each of its texts
 * the definition holds as whole words, as `take` takes them, each pair of adjacent words of the
 * definition's that a phrase of the document holds or the page shows (`pairsFound`), and each word
 * of the page's it spells letter-spaced (`spacedFound`); and where the first came from.
 */
function ownHidden(
  visible: Visible,
  needles: Needles,
  take: (needle: Needle) => Take,
  vocabulary: ReadonlySet<string>,
): { hide: Uint8Array; origin?: Origin } {
  const { hide, origin } = found(visible, needles, take);
  const paired = pairsFound(visible, needles.pairs, hide, vocabulary);
  const spaced = spacedFound(visible, needles.spaced, hide, vocabulary);
  const first = origin ?? paired ?? spaced;
  return { hide, ...(first === undefined ? {} : { origin: first }) };
}

/**
 * How a setting takes the document's texts, and the check a text it reads as source: an
 * identifier of ANYWHERE characters or more anywhere, and all else as whole words, but the page's
 * numbers and letter-spaced words, which are sought in own definitions alone.
 */
const settingTake = (needle: Needle): Take =>
  needle.shape === "number" || needle.shape === "run"
    ? undefined
    : needle.shape === "identifier" && needle.chars.length >= ANYWHERE
      ? "anywhere"
      : "whole";

/**
 * A text with the characters `hide` marks among its visible ones written as their placeholders,
 * each in place of the code units that spell it, `\o ` among them.
 */
function hidden(text: string, visible: Visible, hide: Uint8Array): string {
  if (!hide.includes(1)) return text;
  let out = "";
  let from = 0;
  visible.at.forEach((at, i) => {
    if (hide[i] !== 1) return;
    out += `${text.slice(from, Math.max(from, at))}${placeholder(visible.shown[i] ?? "")}`;
    from = Math.max(from, visible.to[i] ?? at);
  });
  return out + text.slice(from);
}

// Call sites.

/** The names the page may show a call site with: the table's, and what the engine says is defined. */
type Known = (name: string) => boolean;

/** Where a site's text is cut, so that no command's name is cut in two: before its backslash. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(0, max - 1);
  const backslash = kept.lastIndexOf("\\");
  if (backslash >= 0 && backslash > kept.length - 80) kept = kept.slice(0, backslash);
  return `${kept}…`;
}

/**
 * A stretch of the body's source as a call site shows it: every date its date's shape; every
 * command's name as it is, where the table knows it or the engine says it is defined, and as its
 * placeholder otherwise; environments' names, control symbols, braces and punctuation as they
 * are; every other letter and digit as its placeholder; comments left out and spaces made one.
 */
function sketch(
  source: string,
  from: number,
  to: number,
  dates: readonly DateNode[],
  known: Known,
): string {
  let out = "";
  let space = false;
  const put = (text: string) => {
    if (space && out !== "") out += " ";
    space = false;
    out += text;
  };
  let d = 0;
  while (d < dates.length && (dates[d]?.start ?? 0) < from) d++;
  for (let i = from; i < to; ) {
    const date = dates[d];
    if (date !== undefined && date.start === i && date.end <= to) {
      put(datePlaceholder(date.dates));
      i = date.end;
      d++;
      continue;
    }
    const char = source[i] ?? "";
    if (char === "%") {
      const newline = source.indexOf("\n", i);
      i = newline < 0 || newline >= to ? to : newline + 1;
      continue;
    }
    if (/\s/.test(char)) {
      space = true;
      i++;
      continue;
    }
    if (char === "\\") {
      let j = i + 1;
      while (j < to && /[A-Za-z]/.test(source[j] ?? "")) j++;
      if (j === i + 1) {
        const next = [...source.slice(i + 1, i + 3)][0] ?? "";
        // A control symbol shows its character, but a space's as a space, and a letter's or a
        // digit's, which a control symbol's never is in ASCII, as its placeholder.
        const shown = /\s/.test(next) ? " " : /[\p{L}\p{N}]/u.test(next) ? placeholder(next) : next;
        put(`\\${shown}`);
        i += 1 + next.length;
        continue;
      }
      const name = source.slice(i + 1, j);
      if (name === "begin" || name === "end") {
        let k = j;
        while (k < to && /[ \t\n\r]/.test(source[k] ?? "")) k++;
        const close = source[k] === "{" ? source.indexOf("}", k) : -1;
        if (close > 0 && close < to && /^[A-Za-z@*]*$/.test(source.slice(k + 1, close))) {
          put(`\\${name}{${source.slice(k + 1, close)}}`);
          i = close + 1;
          continue;
        }
      }
      put(`\\${known(name) ? name : placeholder(name)}`);
      i = j;
      continue;
    }
    const code = source.codePointAt(i) ?? 0;
    const whole = String.fromCodePoint(code);
    put(placeholder(whole));
    i += whole.length;
  }
  return out;
}

/** What an argument holds, for telling calls apart: absent, empty, a date, text, or more. */
function shapeOf(arg: Argument | undefined): string {
  if (arg === undefined || !arg.present) return "absent";
  const content = arg.content ?? [];
  if (content.length === 0) return "empty";
  if (content.every((node) => node.kind === "date")) return "date";
  if (content.every((node) => node.kind === "text")) return "text";
  return "other";
}

/**
 * Up to REQUEST_CAPS.sites calls, the first and then those whose arguments' shapes differ from the
 * ones taken, and then the next in the source's order: the model sees a macro's variations.
 */
function chosen<T extends { args: readonly Argument[] }>(calls: readonly T[]): T[] {
  const taken: T[] = [];
  const shapes = new Set<string>();
  const shape = (call: T) => call.args.map(shapeOf).join("|");
  for (const call of calls) {
    if (taken.length >= REQUEST_CAPS.sites) break;
    if (taken.length > 0 && shapes.has(shape(call))) continue;
    taken.push(call);
    shapes.add(shape(call));
  }
  for (const call of calls) {
    if (taken.length >= REQUEST_CAPS.sites) break;
    if (!taken.includes(call)) taken.push(call);
  }
  return taken;
}

// Signatures.

/**
 * A signature as the request holds it: each default its arguments give, `O{...}`, `G{...}`,
 * `D<>{...}`, `R<>{...}` and `E{...}{...}`'s, written by `mask`, and the rest, xparse's letters,
 * delimiters and tokens, as it is.
 */
export function maskedSignature(spec: string, mask: (text: string) => string): string {
  let out = "";
  let i = 0;
  const copy = (to: number) => {
    out += spec.slice(i, to);
    i = to;
  };
  /** Where a brace group that opens at `at` ends, or the end of the signature. */
  const group = (at: number) => {
    const end = groupEnd(spec, at, spec.length, "{", "}");
    return end < 0 ? spec.length : end;
  };
  /** Where one token that starts at `at` ends: a command, a brace group or a character. */
  const token = (at: number) => {
    if (spec[at] === "\\")
      return at + (/^\\(?:[A-Za-z@]+|[\s\S])/.exec(spec.slice(at))?.[0].length ?? 1);
    if (spec[at] === "{") return group(at);
    return at + String.fromCodePoint(spec.codePointAt(at) ?? 0).length;
  };
  const defaulted = () => {
    if (spec[i] !== "{") return;
    const end = group(i);
    out += `{${mask(spec.slice(i + 1, Math.max(i + 1, end - 1)))}}`;
    i = end;
  };
  while (i < spec.length) {
    const char = spec[i];
    if (char === "O" || char === "G") {
      copy(i + 1);
      defaulted();
    } else if (char === "D" || char === "R") {
      copy(token(token(i + 1)));
      defaulted();
    } else if (char === "E") {
      copy(i + 1);
      if (spec[i] === "{") copy(group(i));
      defaulted();
    } else if (char === "d" || char === "r") copy(token(token(i + 1)));
    else if (char === "t") copy(token(i + 1));
    else if ((char === "e" || char === "u") && spec[i + 1] === "{") copy(group(i + 1));
    else copy(i + 1);
  }
  return out;
}

// The preamble's settings.

/** Commands whose statements set the page, the base size, fonts, colours or spacing. */
const SETTING_COMMANDS = new Set([
  ...["geometry", "newgeometry", "setlength", "addtolength", "linespread", "setstretch"],
  ...["definecolor", "colorlet", "setmainfont", "setsansfont", "setmonofont", "newfontfamily"],
  ...["defaultfontfeatures", "fontsize", "renewcommand", "setlist", "titlespacing"],
  ...["titleformat", "columnratio", "usepackage", "RequirePackage", "pagecolor", "color"],
  ...["fontfamily", "selectfont", "setsecnumdepth", "moderncvstyle", "moderncvcolor"],
]);

/** Packages whose loading, and options, set the page, fonts, colours or spacing. */
const SETTING_PACKAGES = new Set([
  ...["geometry", "fullpage", "fontenc", "inputenc", "fontspec", "xcolor", "color", "setspace"],
  ...["parskip", "titlesec", "enumitem", "microtype", "lmodern", "charter", "helvet", "times"],
  ...["mathpazo", "palatino", "roboto", "lato", "sourcesanspro", "sourcesans3", "fontawesome"],
  ...["fontawesome5", "noto", "noto-sans", "FiraSans", "raleway", "carlito", "paracol"],
  ...["libertine", "tgpagella", "tgheros", "tgtermes", "ebgaramond", "CormorantGaramond"],
  ...["sectsty", "ragged2e", "multicol", "anyfontsize", "fix-cm", "mathptmx", "cabin"],
]);

/**
 * Words a setting keeps as they are: the settings' own keywords, the packages above, the names of
 * classes and of the fonts in the engine's tree, and xcolor's models and colours. A colour the
 * preamble names is kept too, and numbers, lengths and hex colours are.
 */
const KEYWORDS = new Set(
  [
    ...["paper", "papersize", "a4paper", "a5paper", "b5paper", "letterpaper", "legalpaper"],
    ...["executivepaper", "landscape", "portrait", "margin", "hmargin", "vmargin", "left"],
    ...["right", "top", "bottom", "inner", "outer", "lmargin", "rmargin", "tmargin", "bmargin"],
    ...["textwidth", "textheight", "width", "height", "total", "body", "includehead"],
    ...["includefoot", "includeheadfoot", "includemp", "includeall", "ignorehead", "ignorefoot"],
    ...["headheight", "headsep", "footskip", "marginparwidth", "marginparsep", "columnsep"],
    ...["hscale", "vscale", "scale", "centering", "nohead", "nofoot", "noheadfoot", "showframe"],
    ...["heightrounded", "twoside", "oneside", "onecolumn", "twocolumn", "draft", "final"],
    ...["fleqn", "leqno", "titlepage", "notitlepage", "openright", "openany", "pt", "in", "cm"],
    ...["mm", "em", "ex", "bp", "pc", "sp", "dd", "cc", "fil", "fill", "plus", "minus", "true"],
    ...["false", "T1", "OT1", "TU", "LY1", "utf8", "latin1", "default", "sfdefault", "rmdefault"],
    ...["ttdefault", "familydefault", "scaled", "osf", "lf", "lining", "oldstyle", "tabular"],
    ...["proportional", "light", "medium", "regular", "bold", "semibold", "condensed", "sc", "sf"],
    ...["rm", "tt", "Ligatures", "TeX", "Numbers", "Scale", "MatchLowercase", "Path", "Extension"],
    ...["UprightFont", "BoldFont", "ItalicFont", "BoldItalicFont", "SmallCapsFont", "Renderer"],
    ...["Mapping", "tex", "text", "Color", "Colour", "Roboto", "Lato", "Source", "Sans", "Serif"],
    ...["Pro", "Latin", "Modern", "Font", "Awesome", "Free", "Brands", "Solid", "Regular"],
    ...["Light", "Medium", "Bold", "Italic", "Semibold", "otf", "ttf", "Noto", "Fira", "Open"],
    ...["usenames", "dvipsnames", "svgnames", "x11names", "table", "HTML", "RGB", "rgb", "cmyk"],
    ...["gray", "Gray", "HSB", "hsb", "wave", "black", "blue", "brown", "cyan", "darkgray"],
    ...["green", "lightgray", "lime", "magenta", "olive", "orange", "pink", "purple", "red"],
    ...["teal", "violet", "white", "yellow", "leftmargin", "rightmargin", "labelsep", "itemsep"],
    ...["topsep", "parsep", "partopsep", "noitemsep", "nosep", "label", "align", "itemindent"],
    ...["labelwidth", "labelindent", "font", "before", "after", "itemize", "enumerate"],
    ...["description", "section", "subsection", "subsubsection", "paragraph", "block", "hang"],
    ...["display", "runin", "wrap", "frame", "onehalfspacing", "doublespacing", "singlespacing"],
    ...["article", "extarticle", "report", "moderncv", "altacv", "europecv", "europasscv"],
    ...["simplecv", "res", "resume", "classic", "casual", "banking", "oldstyle", "fancy"],
    ...["email", "link", "phone", "normalsize", "small", "large", "footnotesize", "scriptsize"],
    ...["tiny", "huge", "linkcolor", "urlcolor", "colorlinks", "hidelinks", "pdftex", "xetex"],
    ...["dvipdfmx", "withhyper", "ragged2e", "normalphoto", "bookmarks", "english", "british"],
    ...["american", "german", "french", "spanish", "bfseries", "mdseries", "itshape", "scshape"],
  ]
    .concat([...SETTING_PACKAGES])
    .map((word) => word.toLowerCase()),
);

/** A number, with a unit or a register's name after it: a length, a size, a ratio. */
const QUANTITY =
  /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu|px|fil|fill|filll)?$/i;

/** A colour in hex, as `\definecolor{...}{HTML}{8F0D0D}` gives it. */
const HEX = /^[0-9A-Fa-f]{6}$/;

/** The document class, its options and its name, the first `\documentclass` outside comments. */
function classOf(preamble: string): { name: string; options: string[] } | undefined {
  const found = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(preamble);
  if (found === null) return undefined;
  const options = (found[1] ?? "")
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");
  return { name: (found[2] ?? "").trim(), options };
}

/** The preamble with its comments taken out, a comment being `%` after an even run of backslashes. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== "%") continue;
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
        if (backslashes % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Where a group of a statement that opens at `at`, with `open` and `close`, ends, past its close; or -1. */
function statementGroupEnd(text: string, at: number, open: string, close: string): number {
  let depth = 0;
  for (let i = at; i < text.length && i < at + REQUEST_CAPS.setting; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * A statement's end: its command, a star, then its arguments, braced or bracketed, or a command
 * for its first, as `\setlength\parskip{0pt}` gives, past spaces and one line's end each.
 */
function statementEnd(text: string, from: number): number {
  let at = from;
  let groups = 0;
  for (; groups < 6; groups++) {
    let next = at;
    while (text[next] === " " || text[next] === "\t") next++;
    if (text[next] === "\n") {
      next++;
      while (text[next] === " " || text[next] === "\t") next++;
      if (text[next] === "\n") break;
    }
    const char = text[next];
    if (char === "*" && groups === 0) {
      at = next + 1;
      continue;
    }
    if (char === "{" || char === "[") {
      const end = statementGroupEnd(text, next, char, char === "{" ? "}" : "]");
      if (end < 0) break;
      at = end;
      continue;
    }
    const name = char === "\\" && groups === 0 ? /^\\[A-Za-z@]+/.exec(text.slice(next)) : null;
    if (name === null) break;
    at = next + name[0].length;
  }
  return at;
}

/** Whether a statement is a setting: its command sets one, and its package or macro is one. */
function isSetting(command: string, statement: string): boolean {
  if (command === "usepackage" || command === "RequirePackage") {
    const names = /\{([^}]*)\}\s*$/.exec(statement)?.[1] ?? "";
    return names.split(",").some((name) => SETTING_PACKAGES.has(name.trim()));
  }
  if (command === "renewcommand") {
    const target = /^\\renewcommand\*?\s*\{?\\([A-Za-z@]+)/.exec(statement)?.[1] ?? "";
    return /font|family|default|size|stretch|colou?r|skip|sep|margin|spacing|marker/i.test(target);
  }
  return true;
}

/** The colours a preamble names, with `\definecolor` or `\colorlet`, which settings keep. */
function coloursOf(preamble: string): Set<string> {
  const names = new Set<string>();
  for (const found of preamble.matchAll(
    /\\(?:definecolor|colorlet)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
  ))
    names.add((found[1] ?? "").trim().toLowerCase());
  return names;
}

/**
 * A setting as the request holds it: its emails, links and phone numbers masked by pattern, then
 * every word but a number or a length, a hex colour, a colour the preamble names or a keyword
 * written as its placeholder; commands' names, braces and punctuation as they are. A keyword or a
 * colour's name that is a word of the person's, one of `personal`, goes as its placeholder too:
 * a word the page shows, or a text the preamble stores holds, of MIN_NEEDLE letters or more, as a
 * last name that is a colour's (decision 0038). The request is built without the header's values,
 * which only its answers give, and those words hold them.
 */
function maskedSetting(
  statement: string,
  colours: ReadonlySet<string>,
  personal: ReadonlySet<string>,
): string {
  const keep = (word: string) =>
    QUANTITY.test(word) ||
    HEX.test(word) ||
    ((KEYWORDS.has(word.toLowerCase()) || colours.has(word.toLowerCase())) &&
      !personal.has(folded(word)));
  let out = "";
  const text = maskDefinition(statement);
  for (let i = 0; i < text.length; ) {
    const char = text[i] ?? "";
    if (char === "\\") {
      const name = /^\\(?:[A-Za-z@]+|.)/su.exec(text.slice(i))?.[0] ?? "\\";
      out +=
        /^\\[\p{L}\p{N}]$/u.test(name) && !/^\\[A-Za-z]$/.test(name)
          ? `\\${placeholder(name.slice(1))}`
          : name;
      i += name.length;
      continue;
    }
    const word = /^[\p{L}\p{N}][\p{L}\p{N}.,+-]*/u.exec(text.slice(i))?.[0];
    if (word !== undefined) {
      // A word runs to its last letter or digit; a trailing dot or comma is punctuation.
      const trimmed = word.replace(/[.,+-]+$/, "");
      out += keep(trimmed) ? trimmed : placeholder(trimmed);
      i += trimmed.length;
      continue;
    }
    out += char;
    i += char.length;
  }
  return out;
}

/**
 * The words of the person's a setting may not keep as a keyword or a colour's name
 * (`maskedSetting`): each word the page shows and each word of a text the preamble stores, of
 * MIN_NEEDLE letters or more, folded. The header's values are among them, whether the request is
 * built with those or without, as the browser builds it (decision 0038).
 */
function personalWords(document: Pick<DocumentText, "page" | "stored">): Set<string> {
  const words = new Set<string>();
  for (const word of [...(document.page?.words ?? []), ...(document.stored ?? []).flatMap(wordsOf)])
    if (lettersOf(word) >= MIN_NEEDLE) words.add(folded(word));
  return words;
}

/**
 * The preamble's candidate settings: the class and its options, and each statement of a setting
 * command, in order, its comments gone, each masked as a setting is (`maskedSetting`), the
 * person's words given as `personal`, then by the document's own values, its words and phrases as
 * whole words and its identifiers of ANYWHERE characters or more anywhere (`settingTake`), and
 * cut at the request's cap.
 */
function preambleOf(
  preamble: string,
  needles: Needles,
  personal: ReadonlySet<string>,
): RequestPreamble {
  const text = withoutComments(preamble);
  const colours = coloursOf(text);
  const mask = (statement: string) => {
    const masked = maskedSetting(statement.replace(/\s+/g, " ").trim(), colours, personal);
    const visible = visibleOfSource(masked);
    return cut(
      hidden(masked, visible, found(visible, needles, settingTake).hide),
      REQUEST_CAPS.setting,
    );
  };
  const settings: string[] = [];
  for (const command of text.matchAll(/\\([A-Za-z@]+)/g)) {
    if (settings.length >= REQUEST_CAPS.settings) break;
    const name = command[1] ?? "";
    if (!SETTING_COMMANDS.has(name)) continue;
    const start = command.index;
    const end = statementEnd(text, start + command[0].length);
    const statement = text.slice(start, end);
    if (isSetting(name, statement)) settings.push(mask(statement));
  }
  const documentClass = classOf(text);
  return {
    ...(documentClass === undefined
      ? {}
      : {
          class: {
            name: mask(documentClass.name),
            options: documentClass.options.slice(0, REQUEST_CAPS.options).map(mask),
          },
        }),
    settings,
  };
}

// The request.

/** Options for building a request. */
export interface RequestOptions {
  /** The header's values, as item 7 finds them, which mask definitions as the body's text does. */
  header?: HeaderValues;
  /**
   * Template macros and environments to describe though the document does not call them, as the
   * seed describes a class's macros its sample leaves out: each is asked of the engine too.
   */
  also?: { commands?: readonly string[]; environments?: readonly string[] };
  /**
   * The upload's sources (`sourcesOf`), which say which definitions are the document's own and are
   * masked by its values; without them every definition is the tree's, and goes as item 4 hashed
   * it.
   */
  sources?: readonly string[];
  /**
   * The page's strings (`pageStrings`), whose pairs of words, identifiers, numbers and
   * letter-spaced words mask the document's own definitions, so that a name a macro of the preamble
   * writes, which no body text names, is masked where the page shows it; a page the detector cannot
   * read (`pageReadable`) refuses the request.
   */
  page?: PageStrings;
}

/** A naming request as the builder gives it, and the names it masks, which stay in the browser. */
export interface BuiltRequest {
  request: NamingRequest;
  /**
   * Each name the request writes as a placeholder, `rtxa`, and the document's name it stands for:
   * a macro of the document's own named after a word of the person's (`nameOrigin`). The answers
   * come back under the placeholders, and the import reads them under the document's names
   * through it (`realNames`).
   */
  names: ReadonlyMap<string, string>;
}

/**
 * A request the contract's schema refuses, which the builder never gives: where it breaks the
 * contract, by the kind of place and the macro, never what it holds.
 */
export class InvalidRequest extends Error {
  readonly problems: readonly { kind: LeakKind | "request"; macro?: string }[];

  constructor(problems: readonly { kind: LeakKind | "request"; macro?: string }[]) {
    const shown = problems.map((each) =>
      each.macro === undefined ? each.kind : `${each.kind} of ${each.macro}`,
    );
    super(`The naming request breaks its contract in ${[...new Set(shown)].join(", ")}.`);
    this.name = "InvalidRequest";
    this.problems = problems;
  }
}

/** A call, or an environment opened, in the body or the preamble: its node, whatever holds it. */
interface Use {
  of: RequestMacro["of"];
  name: string;
  args: readonly Argument[];
  content?: readonly Node[];
  source: string;
}

/** The families a class's name says, as the corpus's classifier reads them (decision 0017). */
const CLASS_FAMILIES: ReadonlyMap<string, FamilyHint> = new Map([
  ["altacv", "altacv"],
  ["awesome-cv", "awesome-cv"],
  ["moderncv", "moderncv"],
  ["europecv", "europecv"],
]);

/**
 * The family a document's class says it is, when it is one of the corpus's; or Jake's Resume, whose
 * forks load `article`, when the body calls `\resumeSubheading`, as the corpus's classifier has it.
 */
function familyOf(
  className: string | undefined,
  called: ReadonlySet<string>,
): FamilyHint | undefined {
  const byClass = CLASS_FAMILIES.get(className?.toLowerCase() ?? "");
  if (byClass !== undefined) return byClass;
  return called.has("resumeSubheading") ? "jake" : undefined;
}

/** A signature's arguments' kinds, in order, as the request lists them. */
function argumentKinds(spec: string | undefined): RequestArgument["kind"][] {
  const parts = spec === undefined ? undefined : readSpec(spec);
  return (parts ?? []).map((part) =>
    part.type === "optionalStar"
      ? "star"
      : part.type === "optionalToken"
        ? "token"
        : part.type === "optional"
          ? "optional"
          : "mandatory",
  );
}

/**
 * The calls a preamble makes, at its top level, to the macros that store the header's text, as the
 * probe found them (`isSetter`): each call's node in the preamble's own tree, which the engine's
 * signatures read as they read the body's.
 */
function preambleCalls(
  preamble: string,
  signatures: EngineSignatures,
  setters: ReadonlySet<string>,
): { tree?: Tree; calls: Node[] } {
  if (setters.size === 0) return { calls: [] };
  const read = readBody(bodyOfText(preamble));
  if ("refused" in read) return { calls: [] };
  const tree = buildTree(read, signatures);
  if ("refused" in tree) return { calls: [] };
  return {
    tree,
    calls: tree.content.filter((node) => node.kind === "call" && setters.has(node.name)),
  };
}

// Names.

/** The fewest letters a part of a name holds for the check to read it as a word of the page's. */
const NAME_WORD = 4;

/**
 * A name's parts, as the check reads a name for the person's words: parted before a capital that
 * follows a small letter or starts a word of small letters, and at anything but a letter, `@`,
 * `_`, `:` and digits among them, each folded: `\quillPage` is `quill` and `page`.
 */
function nameParts(name: string): string[] {
  return name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}]+/u)
    .map(folded)
    .filter((part) => part !== "");
}

/**
 * What a name is looked for by: each word of the header's name, of MIN_NEEDLE letters or more; each
 * word the page shows, letter-spaced ones among them, of NAME_WORD letters or more; and each pair
 * of the page's, as two parts of a name in a row and as one run together, `\quillinvented`.
 */
interface NameNeedles {
  words: Map<string, Origin>;
  pairs: Map<string, Origin>;
  joined: Map<string, string>;
}

/** The needles a document's names are looked for by (`NameNeedles`), folded. */
function nameNeedlesOf(document: Pick<DocumentText, "header" | "page">): NameNeedles {
  const words = new Map<string, Origin>();
  const pairs = new Map<string, Origin>();
  const joined = new Map<string, string>();
  for (const value of [document.header?.first, document.header?.last])
    for (const word of wordsOf(value ?? ""))
      if (lettersOf(word) >= MIN_NEEDLE) words.set(folded(word), "header");
  for (const word of [...(document.page?.words ?? []), ...(document.page?.runs ?? [])])
    if (lettersOf(word) >= NAME_WORD && !words.has(folded(word))) words.set(folded(word), "page");
  for (const pair of document.page?.pairs ?? []) {
    const parts = wordsOf(pair).map(folded);
    pairs.set(parts.join(" "), "page");
    joined.set(parts.join(""), parts.join(" "));
  }
  return { words, pairs, joined };
}

/**
 * Whether a name is the person's text, and where that came from: a part of it is a word of the
 * header's name, `\cvQuill`; the name, its parts together, is a word the page shows of NAME_WORD
 * letters or more, `\Wrenfield`; or two of its parts in a row, or its letters run together, are a
 * pair the page shows, `\quillPage` for a person named Quill Page, `\quillinvented`. A word of the
 * page's is one none of the tree's vocabulary, which a class's own name spells as often as the
 * person's. And the macro spells out what its name is (`spells`), as a shortcut for a word does,
 * `\newcommand{\Wrenfield}{\textsc{Wrenfield}}`: a template's names are made of the words its page
 * shows as labels, `\email` and `\tagline` beside the person's address and headline, which they
 * store and never spell, and `\resumeItem` of a page headed Resume, whose part alone is no word of
 * the person's either. A macro that holds data spells whatever its name is, and a name of code's,
 * `\@email`, never is one.
 */
function nameOrigin(
  name: string,
  needles: NameNeedles,
  vocabulary: ReadonlySet<string>,
  spells: (words: readonly string[]) => boolean,
): { origin: Origin; words: string[] } | undefined {
  const parts = nameParts(name);
  const plain = (word: string) => !vocabulary.has(word);
  const header = parts.filter((part) => needles.words.get(part) === "header");
  if (header.length > 0 && spells(header)) return { origin: "header", words: header };
  const whole = parts.join("");
  const origin = needles.words.get(whole);
  if (origin !== undefined && [...whole].length >= NAME_WORD && plain(whole) && spells([whole]))
    return { origin, words: [whole] };
  const paired = (pair: string | undefined): pair is string =>
    pair !== undefined &&
    needles.pairs.has(pair) &&
    pair.split(" ").every(plain) &&
    spells(pair.split(" "));
  for (let k = 0; k + 1 < parts.length; k++) {
    const pair = `${parts[k]} ${parts[k + 1]}`;
    if (paired(pair)) return { origin: "page", words: pair.split(" ") };
  }
  const run = needles.joined.get(whole);
  return paired(run) ? { origin: "page", words: run.split(" ") } : undefined;
}

/**
 * Needles for words, each looked for whole, as the words a macro's name is made of are in its own
 * definitions once the name is the person's (`nameOrigin`).
 */
function needlesFor(words: Iterable<string>, origin: Origin): Needles {
  const byPrefix = new Map<string, Needle[]>();
  for (const word of words) {
    const chars = [...word];
    if (chars.length < MIN_NEEDLE) continue;
    const prefix = chars.slice(0, MIN_NEEDLE).join("");
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), { chars, origin, shape: "phrase" }]);
  }
  return { byPrefix, short: new Map(), pairs: new Map(), spaced: new Set() };
}

/**
 * Whether a macro spells out words, as `nameOrigin` asks of its name: each of them is a word its
 * definitions show (`visibleOfMeaning`), every printed form of its name's among them, `texts`; or
 * it holds data, whose text never leaves, and its name is letters alone, as a shortcut's is and
 * `\@email` is not.
 */
function spelling(base: string, texts: readonly string[], data: boolean) {
  const shown = new Set(texts.flatMap((text) => visibleWords(visibleOfMeaning(text))));
  return (words: readonly string[]) =>
    words.every((word) => shown.has(word)) || (data && /^\p{L}+$/u.test(base));
}

/** A placeholder name's letters for a number: `a` to `z`, then `ba`, as a number in base 26. */
function placeholderLetters(n: number): string {
  let out = "";
  let rest = n;
  do {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return out;
}

/** A name spelt as a regular expression's text. */
const literally = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * How a request writes the names it masks (`personal`, each document's name by its placeholder
 * `rtx` and letters): `name` a macro's name as the engine printed it, its base replaced, a robust
 * command's `quillPage `, an optional argument's `\quillPage`, xparse's `quillPage code` and an
 * environment's `environment quillbox code` and `endquillbox` among them; and `text` a definition's
 * or a call site's text, each control word, `\begin` and `\end` of an environment and xparse's name
 * of one replaced.
 */
function renamer(personal: ReadonlyMap<string, string>) {
  if (personal.size === 0) return { name: (name: string) => name, text: (text: string) => text };
  const alternatives = [...personal.keys()]
    .sort((a, b) => b.length - a.length)
    .map(literally)
    .join("|");
  const word = new RegExp(String.raw`\\(${alternatives})(?![A-Za-z@])`, "g");
  const environment = new RegExp(String.raw`(\\(?:begin|end) ?\{)(${alternatives})\}`, "g");
  const code = new RegExp(String.raw`(\\environment )(${alternatives})(?= )`, "g");
  const of = (name: string) => personal.get(name) ?? name;
  return {
    name(name: string) {
      const environmentCode = /^(environment )(.+?)( (?:code|end|end aux|end code))$/.exec(name);
      if (environmentCode !== null)
        return `${environmentCode[1]}${of(environmentCode[2] ?? "")}${environmentCode[3]}`;
      const parts = /^(\\?)(.*?)((?: code)?\s*)$/.exec(name);
      return parts === null ? name : `${parts[1]}${of(parts[2] ?? "")}${parts[3]}`;
    },
    text(text: string) {
      return text
        .replace(word, (_, name: string) => `\\${of(name)}`)
        .replace(environment, (_, head: string, name: string) => `${head}${of(name)}}`)
        .replace(code, (_, head: string, name: string) => `${head}${of(name)}`);
    },
  };
}

/**
 * The names of a request the check reads: each definition's, each macro's and each of its
 * dependencies, and each command's and environment's a call site keeps.
 */
function namesOf(request: NamingRequest): Set<string> {
  const names = new Set<string>();
  for (const definition of request.definitions) names.add(definition.name);
  for (const macro of request.macros) {
    names.add(macro.name);
    for (const dependency of macro.dependencies) names.add(dependency);
    for (const site of macro.sites)
      for (const text of [...site.arguments, site.body]) {
        for (const found of (text ?? "").matchAll(/\\([A-Za-z@]+)/g)) names.add(found[1] ?? "");
        for (const found of (text ?? "").matchAll(/\\(?:begin|end)\s*\{([^}]*)\}/g))
          names.add(found[1] ?? "");
      }
  }
  names.delete("");
  return names;
}

// Metadata.

/** Where a list's items part, a separator at no brace's depth. */
function topLevel(list: string, separator: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === separator && depth === 0) {
      items.push(list.slice(from, i));
      from = i + 1;
    }
  }
  items.push(list.slice(from));
  return items;
}

/**
 * An own definition with each value of its `\hypersetup` key lists that is text, `pdfauthor`'s or
 * `pdftitle`'s, written as its placeholder: metadata never reaches the page, which the detector
 * reads, and the matchers read a key list as code, so what it holds is sent as no text at all. A
 * value that is a command, a number or a length, a hex colour, a keyword or a colour of xcolor's
 * is kept (decision 0033).
 */
function maskedMetadata(meaning: string): string {
  let out = "";
  let from = 0;
  for (const match of meaning.matchAll(/\\hypersetup ?\{/g)) {
    const open = match.index + match[0].length - 1;
    if (open < from) continue;
    const end = groupEnd(meaning, open, meaning.length, "{", "}");
    if (end < 0) continue;
    const list = topLevel(meaning.slice(open + 1, end - 1), ",").map((item) => {
      const at = item.indexOf("=");
      if (at < 0) return item;
      const value = item.slice(at + 1);
      const bare = value
        .trim()
        .replace(/^\{([\s\S]*)\}$/, "$1")
        .trim();
      const kept =
        bare === "" ||
        /^\\[A-Za-z@]+ ?$/.test(bare) ||
        QUANTITY.test(bare) ||
        HEX.test(bare) ||
        KEYWORDS.has(bare.toLowerCase());
      return kept ? item : `${item.slice(0, at + 1)}${placeholder(value)}`;
    });
    out += `${meaning.slice(from, open + 1)}${list.join(",")}}`;
    from = end;
  }
  return out + meaning.slice(from);
}

// The request.

/**
 * Where a request the schema refuses breaks the contract (`InvalidRequest`): each problem's kind of
 * place and macro, from its path in the request as built, never what the place holds.
 */
function problemsOf(
  built: { macros: readonly RequestMacro[]; definitions: readonly RequestDefinition[] },
  issues: readonly { path: readonly PropertyKey[] }[],
  own: (name: string) => boolean,
): { kind: LeakKind | "request"; macro?: string }[] {
  return issues.map(({ path }) => {
    const [where, at, field] = path;
    if (where === "macros" && typeof at === "number") {
      const macro = built.macros[at]?.name;
      const kind =
        field === "sites" ? "call site" : field === "signature" ? "signature" : "request";
      return { kind, ...(macro === undefined ? {} : { macro }) };
    }
    if (where === "definitions" && typeof at === "number") {
      const macro = built.definitions[at]?.name;
      if (macro === undefined) return { kind: "request" };
      return { kind: own(macro) ? "own definition" : "tree definition", macro };
    }
    if (where === "preamble") return { kind: field === "class" ? "class" : "setting" };
    return { kind: "request" };
  });
}

/**
 * The naming request for a document (decision 0024): each template macro and environment its body
 * calls or opens, and each the preamble calls to store the header's text, with its definition and
 * its closure's, masked, its key, the probe's verdicts and up to three call sites; and the
 * preamble's settings. `tree` is the body's, `signatures` what the engine said of the body's names
 * and the preamble's (`probeUses`), `probe` the probe's aggregates and candidates, and
 * `preamble` the main file's text before `\begin{document}`; the options give the upload's
 * sources, the header's values and the page's strings, which the import passes all of (decision
 * 0033). A name of the document's own that is a word of the person's is written as a placeholder
 * throughout, and the map back to it is given with the request (`BuiltRequest`), never in it. The
 * request is checked against the contract's schema before it is given back, so that a call site
 * holding the document's text throws (`InvalidRequest`) rather than leaves; and a page the
 * detector cannot read (`pageReadable`) refuses it, since what a macro of the preamble writes on
 * the page would then go unseen.
 */
export async function buildRequest(
  tree: Tree,
  signatures: EngineSignatures,
  probe: Pick<Probe, "macros" | "candidates">,
  preamble: string,
  options: RequestOptions = {},
): Promise<BuiltRequest | Refusal> {
  if (options.page !== undefined && !pageReadable(options.page)) return refusal("unreadable");
  const ofPreamble = probe.candidates.filter((each) => each.where === "preamble");
  const document = {
    tree,
    ...(options.header === undefined ? {} : { header: options.header }),
    stored: ofPreamble.map((each) => each.text),
    ...(options.page === undefined ? {} : { page: options.page }),
  };
  const needles = needlesOf(document, false);
  const owned = ownNames(options.sources ?? []);
  const commandOf = (name: string): Signature | undefined =>
    Object.hasOwn(signatures.commands, name) ? signatures.commands[name] : undefined;
  const environmentOf = (name: string): Signature | undefined =>
    Object.hasOwn(signatures.environments, name) ? signatures.environments[name] : undefined;
  const macroOf = (name: string) =>
    Object.hasOwn(signatures.macros, name) ? signatures.macros[name] : undefined;
  const known: Known = (name) =>
    name === "begin" ||
    name === "end" ||
    STANDARD.has(name) ||
    macroOf(name) !== undefined ||
    (commandOf(name) !== undefined && commandOf(name)?.kind !== "undefined");
  const datesOf = (nodes: readonly Node[]) =>
    [...nodesOf(nodes)]
      .filter((node): node is DateNode => node.kind === "date")
      .sort((a, b) => a.start - b.start);
  /**
   * A signature's default as the request holds it: masked by pattern, then every letter and digit
   * written as its placeholder, a command's name among them, which the schema reads as code.
   */
  const defaultOf = (text: string) => placeholder(maskDefinition(text));

  // The uses, in the source's order: the preamble's storing calls first, then the body's.
  const setters = new Set(
    ofPreamble.filter((each) => each.of === "call" && each.name !== "").map((each) => each.name),
  );
  const head = preambleCalls(preamble, signatures, setters);
  const sources = new Map<string, DateNode[]>([[tree.source, datesOf(tree.content)]]);
  if (head.tree !== undefined) sources.set(head.tree.source, datesOf(head.tree.content));
  const uses: Use[] = [];
  const isTemplate = (name: string) => commandOf(name)?.kind === "template";
  for (const node of head.calls)
    if (node.kind === "call" && isTemplate(node.name))
      uses.push({
        of: "command",
        name: node.name,
        args: node.args,
        source: head.tree?.source ?? "",
      });
  for (const name of setters)
    if (isTemplate(name) && !uses.some((use) => use.name === name))
      uses.push({ of: "command", name, args: [], source: "" });
  for (const node of nodesOf(tree.content)) {
    if (node.kind === "call" && isTemplate(node.name))
      uses.push({ of: "command", name: node.name, args: node.args, source: tree.source });
    else if (node.kind === "environment" && environmentOf(node.name)?.kind === "template")
      uses.push({
        of: "environment",
        name: node.name,
        args: node.args,
        content: node.content,
        source: tree.source,
      });
    else if (node.kind === "raw" && node.name !== undefined && isTemplate(node.name))
      uses.push({ of: "command", name: node.name, args: [], source: "" });
  }
  for (const name of options.also?.commands ?? [])
    if (macroOf(name) !== undefined) uses.push({ of: "command", name, args: [], source: "" });
  for (const name of options.also?.environments ?? [])
    if (macroOf(name) !== undefined) uses.push({ of: "environment", name, args: [], source: "" });

  const byMacro = new Map<string, Use[]>();
  for (const use of uses) {
    const id = `${use.of}|${use.name}`;
    const list = byMacro.get(id) ?? [];
    list.push(use);
    byMacro.set(id, list);
  }

  // A macro a storing call of the preamble's stored its argument in holds the person's text,
  // whoever defines it, as europecv's `\ecv@rfoot` holds what `\ecvfootnote` was given: it is data,
  // as the signatures step reads it too (`signatures`), and goes by its name alone.
  const storage = new Set([...setters].flatMap((name) => storedIn(macroOf(name))));
  const isDefinition = (name: string) => {
    const macro = macroOf(name);
    return macro !== undefined && macro.kind !== "data" && !storage.has(name);
  };

  // Each macro's closure, and so every name the request defines, before anything is masked.
  const planned = [...byMacro.values()].flatMap((list) => {
    const [first] = list;
    const own = first === undefined ? undefined : macroOf(first.name);
    if (first === undefined || own === undefined) return [];
    const { of, name } = first;
    const endName = `end${name}`;
    const end = of === "environment" ? macroOf(endName) : undefined;
    const closure = [
      ...(end === undefined ? [] : [endName]),
      ...(own.kind === "data" ? [] : own.dependencies),
      ...(end === undefined || end.kind === "data" ? [] : end.dependencies),
    ];
    return [{ of, name, list, own, end, endName, closure }];
  });
  const defined = new Set(
    planned.flatMap((each) => [each.name, ...each.closure]).filter((name) => macroOf(name)),
  );
  // The tree's vocabulary: every word its definitions the request carries show, which no pair of
  // the page's that holds one masks, and no name that is one of them is taken for the person's.
  const vocabulary = vocabularyOf(
    [...defined].flatMap((name) => {
      const macro = macroOf(name);
      return macro === undefined ||
        macro.kind === "data" ||
        !isDefinition(name) ||
        isOwn(name, owned)
        ? []
        : [macro.meaning];
    }),
  );

  // The names that are the person's words: the document's own, which the check reads as it reads
  // text (`nameOrigin`), each written as a placeholder throughout, `rtx` and letters.
  const bases = new Set([...defined].filter((name) => isOwn(name, owned)).map(baseName));
  for (const source of [tree.source, head.tree?.source ?? ""]) {
    for (const found of source.matchAll(/\\([A-Za-z@]+)/g))
      if (owned.has(found[1] ?? "")) bases.add(found[1] ?? "");
    for (const found of source.matchAll(/\\(?:begin|end)\s*\{([^}]*)\}/g))
      if (owned.has(found[1] ?? "")) bases.add(found[1] ?? "");
  }
  const nameNeedles = nameNeedlesOf(document);
  const taken = new Set(
    [
      ...Object.keys(signatures.macros),
      ...Object.keys(signatures.commands),
      ...Object.keys(signatures.environments),
      ...owned,
    ].map(baseName),
  );
  // What each such name's macro spells, its every printed form's definition read, or whether it
  // holds data.
  const printed = new Map<string, { texts: string[]; data: boolean }>();
  for (const [name, macro] of Object.entries(signatures.macros)) {
    const base = baseName(name);
    if (!bases.has(base)) continue;
    const entry = printed.get(base) ?? { texts: [], data: false };
    if (macro.kind === "data" || storage.has(name)) entry.data = true;
    else entry.texts.push(macro.meaning);
    printed.set(base, entry);
  }
  const personal = new Map<string, string>();
  /** The words each such name is made of, which its own definitions spell, and are masked in. */
  const spelt = new Map<string, Needles>();
  let next = 0;
  for (const base of [...bases].sort()) {
    if (base.startsWith("end") && bases.has(base.slice(3))) continue;
    const entry = printed.get(base) ?? { texts: [], data: false };
    const spells = spelling(base, entry.texts, entry.data);
    const person = nameOrigin(base, nameNeedles, vocabulary, spells);
    if (person === undefined) continue;
    let name: string;
    do name = `rtx${placeholderLetters(next++)}`;
    while (taken.has(name) || taken.has(`end${name}`));
    personal.set(base, name);
    spelt.set(base, needlesFor(person.words, person.origin));
  }
  for (const base of bases) {
    const begun = personal.get(base.slice(3));
    if (base.startsWith("end") && begun !== undefined) personal.set(base, `end${begun}`);
  }
  const rename = renamer(personal);

  // The definitions: every macro's own and its closure's; the document's own masked by its values,
  // its page's numbers not those the tree's code shows too, and its metadata's text.
  const ownTake = (needle: Needle): Take =>
    (needle.shape === "number" || needle.shape === "run") && vocabulary.has(needle.chars.join(""))
      ? undefined
      : "whole";
  const definitions = new Map<string, RequestDefinition>();
  const define = async (name: string) => {
    if (definitions.has(name)) return;
    const macro = macroOf(name);
    if (macro === undefined) return;
    if (macro.kind === "data" || storage.has(name)) {
      definitions.set(name, { kind: "data", name: rename.name(name) });
      return;
    }
    let text = macro.meaning;
    if (isOwn(name, owned)) {
      const visible = visibleOfMeaning(text);
      const { hide } = ownHidden(visible, needles, ownTake, vocabulary);
      // A macro named after a word of the person's that it spells holds that word too.
      const words = spelt.get(baseName(name));
      if (words !== undefined)
        found(visible, words, () => "whole").hide.forEach((each, i) => {
          if (each === 1) hide[i] = 1;
        });
      text = maskedMetadata(hidden(text, visible, hide));
    }
    text = rename.text(text);
    const hash = text === macro.meaning ? macro.hash : await sha256(text);
    definitions.set(name, { kind: "definition", name: rename.name(name), hash, text });
  };

  const macros: RequestMacro[] = [];
  for (const { of, name, list, own, end, endName, closure } of planned) {
    await define(name);
    for (const dependency of closure) await define(dependency);
    // Every name a closure holds is one the engine printed, so each has a definition.
    const dependencies = [...new Set(closure)].filter(
      (each) => each !== name && definitions.has(each),
    );
    const signature = (of === "environment" ? environmentOf(name) : commandOf(name))?.spec;
    const kinds = argumentKinds(signature);
    const aggregates = probe.macros.filter(
      (each) => each.of === (of === "environment" ? "environment" : "call") && each.name === name,
    );
    const args: RequestArgument[] = kinds.map((kind, i) => {
      const aggregate = aggregates.find((each) => each.index === i + 1);
      return {
        index: i + 1,
        kind,
        ...(aggregate === undefined ? {} : { verdict: aggregate.verdict }),
        ...(aggregate?.empty === undefined ? {} : { empty: aggregate.empty }),
      };
    });
    const called = list.filter((use) => use.source !== "");
    const shown = (source: string, from: number, to: number, dates: DateNode[], max: number) =>
      cut(rename.text(sketch(source, from, to, dates, known)), max);
    const sites: CallSite[] = chosen(called).map((use) => {
      const dates = sources.get(use.source) ?? [];
      const site: CallSite = {
        arguments: kinds.map((_, i) => {
          const arg = use.args[i];
          if (arg === undefined || !arg.present) return null;
          return shown(use.source, arg.innerStart, arg.innerEnd, dates, REQUEST_CAPS.site);
        }),
      };
      const content = use.content ?? [];
      const firstNode = content[0];
      const lastNode = content.at(-1);
      if (of === "environment" && firstNode !== undefined && lastNode !== undefined)
        site.body = shown(use.source, firstNode.start, lastNode.end, dates, 600);
      return site;
    });
    const ownDefinition = definitions.get(name);
    const endDefinition = end === undefined ? undefined : definitions.get(endName);
    const hashed = (names: readonly string[]) =>
      names.flatMap((dependency): Dependency[] => {
        const found = definitions.get(dependency);
        return found?.kind === "definition" ? [[found.name, found.hash]] : [];
      });
    // An environment's key is its `\begin` code's, its `\end` code the first of its closure
    // (`environmentKeyOf`), as item 4's keys have it; one whose `\end` code holds data, or that
    // the engine did not print, keys as a command does, data left out. A masked name is keyed as
    // the request writes it, so that the service computes the same key from the request.
    const key =
      ownDefinition?.kind !== "definition"
        ? undefined
        : of === "environment" && endDefinition?.kind === "definition"
          ? await environmentKeyOf(
              NAMING_VERSION,
              ownDefinition.hash,
              endDefinition.name,
              endDefinition.hash,
              hashed(dependencies.filter((each) => each !== endName)),
            )
          : await keyOf(NAMING_VERSION, ownDefinition.hash, hashed(dependencies));
    const capped = (macro: typeof own | undefined) =>
      macro !== undefined && macro.kind !== "data" && macro.capped;
    macros.push({
      of,
      name: rename.name(name),
      ...(signature === undefined
        ? {}
        : { signature: rename.text(maskedSignature(signature, defaultOf)) }),
      ...(key === undefined ? {} : { key }),
      dependencies: dependencies.map((each) => definitions.get(each)?.name ?? each),
      capped: capped(own) || capped(end),
      arguments: args,
      sites,
      calls: called.length,
    });
  }

  const family = familyOf(
    classOf(withoutComments(preamble))?.name,
    new Set(planned.map((each) => each.name)),
  );
  const built = {
    version: NAMING_VERSION,
    engine: signatures.engine,
    ...(family === undefined ? {} : { family }),
    preamble: preambleOf(preamble, needles, personalWords(document)),
    macros,
    definitions: [...definitions.values()],
  };
  const parsed = NamingRequest.safeParse(built);
  const real = new Map([...personal].map(([name, masked]) => [masked, name]));
  if (!parsed.success)
    throw new InvalidRequest(
      problemsOf(built, parsed.error.issues, (name) =>
        isOwn(real.get(baseName(name)) ?? name, owned),
      ),
    );
  return { request: parsed.data, names: real };
}

/** The naming request an import sends, and the document's text the check reads it against. */
export interface SentRequest extends BuiltRequest {
  /** What `assertNoText` and `findLeaks` read the request against. */
  document: DocumentText;
}

/**
 * The naming request an import sends (decision 0038), built as the browser builds it and as
 * `corpus leak` proves it, one function for both so that the two cannot drift: with the upload's
 * sources and the page's strings its reference sets, read with the upload's fonts first
 * (`pageStrings`), and never with the header's values, which only the answers to the request give;
 * with what the check reads it against, the body's tree, the texts the preamble stores, the
 * sources, the page and the names the request writes as placeholders. A page the detector cannot
 * read refuses the request, as `buildRequest` does.
 */
export async function importRequest(inputs: {
  tree: Tree;
  signatures: EngineSignatures;
  probe: Pick<Probe, "macros" | "candidates">;
  /** The main file's text before `\begin{document}`. */
  preamble: string;
  intake: Pick<Intake, "main" | "files">;
  reference: GlyphStream;
  fonts: PageFonts;
}): Promise<SentRequest | Refusal> {
  const { tree, signatures, probe, intake } = inputs;
  const sources = sourcesOf(intake);
  const page = await pageStrings(inputs.reference, inputs.fonts, intake.files);
  const built = await buildRequest(tree, signatures, probe, inputs.preamble, { sources, page });
  if ("refused" in built) return built;
  const stored = probe.candidates
    .filter((each) => each.where === "preamble")
    .map((each) => each.text);
  return { ...built, document: { tree, stored, sources, page, names: built.names } };
}

/**
 * A name a request gives back, as the document names it: a placeholder the builder wrote in place
 * of the person's word (`BuiltRequest.names`) read back, its forms as `renamer` writes them, and
 * any other name as it is.
 */
export function realName(names: ReadonlyMap<string, string>, name: string): string {
  return names.size === 0 ? name : renamer(names).name(name);
}

// Redefinitions.

/** Where a main file's `\begin{document}` starts, the first outside a comment; or -1. */
export function documentStart(text: string): number {
  let offset = 0;
  for (const line of text.split("\n")) {
    const found = /\\begin\s*\{document\}/.exec(line.slice(0, commentAt(line)));
    if (found !== null) return offset + found.index;
    offset += line.length + 1;
  }
  return -1;
}

/** Options for putting an answer's redefinitions in a main file. */
export interface RedefinitionOptions {
  /**
   * Where they go: right after `\documentclass` (`class`, the default), where a macro the class
   * defines can be redefined and nothing the preamble does has read it yet; or right before
   * `\begin{document}` (`preamble`), where a macro a package or the preamble defines can be,
   * which after the class is not defined yet.
   */
  placement?: "class" | "preamble";
}

/**
 * A main file's text with an answer's redefinitions after its document class, or before its
 * document with `placement: "preamble"`, each once by its name, the first given of a name taken, in
 * order, a line each: what item 7 does with the redefinitions of the answers it assembles from
 * (decision 0024), trying `class` and then `preamble` when a compile stops. Undefined when the text
 * has no `\documentclass`, or no `\begin{document}`, to put them by.
 */
export function withRedefinitions(
  text: string,
  redefinitions: readonly { name: string; latex: string }[],
  options: RedefinitionOptions = {},
): string | undefined {
  const preamble = options.placement === "preamble";
  const at = preamble ? documentStart(text) : classEnd(text);
  if (at < 0) return undefined;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const each of redefinitions) {
    if (seen.has(each.name)) continue;
    seen.add(each.name);
    lines.push(each.latex);
  }
  if (lines.length === 0) return text;
  if (!preamble) return `${text.slice(0, at)}\n${lines.join("\n")}\n${text.slice(at)}`;
  const before = at === 0 || text[at - 1] === "\n" ? "" : "\n";
  return `${text.slice(0, at)}${before}${lines.join("\n")}\n${text.slice(at)}`;
}

// The leak check.

/**
 * How the check reads a text of a request: a definition, the document's own or the tree's; a
 * setting or the class, source whose keywords are kept; or other source.
 */
type Reads = "own" | "tree" | "setting" | "source";

/** What kind of place in a request holds a text, as a leak names it: a name among them. */
export type LeakKind =
  | "own definition"
  | "tree definition"
  | "call site"
  | "signature"
  | "setting"
  | "class"
  | "name";

/**
 * A text of the document's that a request holds (`findLeaks`): what kind of text it is, the
 * body's, a link's, a date, a raw chunk's, the header's, a stored text or the page's; what kind of
 * place holds it, and the macro whose definition, call site or signature that is, none for a
 * setting, the class or a name, which a leak never repeats; and where, as a message says it. Never
 * the text.
 */
export interface Leak {
  origin: Origin;
  kind: LeakKind;
  macro?: string;
  where: string;
  /**
   * Whether only a single word the builder does not mask by is there, one of the body's, a stored
   * text's or the page's, which the check alone looks for, stricter on purpose: the gate refuses
   * the request as it does any leak, and the builder is not at fault, as it is for any other.
   */
  alone?: true;
}

/** A text of a request as the check reads it: where it is, and how it is read. */
interface Held {
  kind: LeakKind;
  macro?: string;
  where: string;
  text: string;
  reads: Reads;
}

/**
 * The texts of a signature's brace groups, a space between: its defaults, `O{...}`'s among them,
 * and the tokens `e{...}`, `E{...}{...}` and `u{...}` give. What lies outside them is xparse's
 * argument types, `s o m`, which are code however they spell a word.
 */
function signatureText(spec: string): string {
  const groups: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < spec.length; i++) {
    const char = spec[i];
    if (char === "\\") i++;
    else if (char === "{" && depth++ === 0) from = i + 1;
    else if (char === "}" && depth > 0 && --depth === 0) groups.push(spec.slice(from, i));
  }
  return groups.join(" ");
}

/**
 * Where a request holds a text, and how the check reads it: never the text itself. `owns` says
 * whether a definition's name is the document's own.
 */
function textsOf(request: NamingRequest, owns: (name: string) => boolean): Held[] {
  const texts: Held[] = [];
  for (const definition of request.definitions)
    if (definition.kind === "definition") {
      const own = owns(definition.name);
      texts.push({
        kind: own ? "own definition" : "tree definition",
        macro: definition.name,
        where: `the definition of ${definition.name}`,
        text: definition.text,
        reads: own ? "own" : "tree",
      });
    }
  for (const macro of request.macros) {
    const name = macro.name;
    if (macro.signature !== undefined)
      texts.push({
        kind: "signature",
        macro: name,
        where: `the signature of ${name}`,
        text: signatureText(macro.signature),
        reads: "source",
      });
    macro.sites.forEach((site, s) => {
      site.arguments.forEach((argument, a) => {
        if (argument !== null)
          texts.push({
            kind: "call site",
            macro: name,
            where: `call site ${s + 1} of ${name}, argument ${a + 1}`,
            text: argument,
            reads: "source",
          });
      });
      if (site.body !== undefined)
        texts.push({
          kind: "call site",
          macro: name,
          where: `call site ${s + 1} of ${name}, its body`,
          text: site.body,
          reads: "source",
        });
    });
  }
  request.preamble.settings.forEach((setting, i) =>
    texts.push({ kind: "setting", where: `setting ${i + 1}`, text: setting, reads: "setting" }),
  );
  const documentClass = request.preamble.class;
  if (documentClass !== undefined) {
    texts.push({
      kind: "class",
      where: "the class's name",
      text: documentClass.name,
      reads: "setting",
    });
    documentClass.options.forEach((option, i) =>
      texts.push({
        kind: "class",
        where: `the class's option ${i + 1}`,
        text: option,
        reads: "setting",
      }),
    );
  }
  return texts;
}

/**
 * Each place a request holds any of a document's text (`Leak`), found more strictly than the
 * builder masks, on purpose: any text of the body's, a run, a date as it is spelt or a raw
 * chunk's piece, any header value or word of the name, any text the preamble stores, any word or
 * pair of words the page shows (`PageStrings`), and any identifier any of them holds, of
 * MIN_NEEDLE letters and digits or more, single words among them, spelt out as whole words in a
 * call site, a signature's defaults, a setting or the class. In a definition of the document's
 * own, the same, and besides the page's numbers of two digits or more and its letter-spaced words
 * joined, and a pair of words of the document's or the page's where the definition holds the two
 * adjacent or parted by glue alone (`pairsFound`); but a word only the page shows only where it is
 * of NAME_WORD letters or more and none of the tree's vocabulary (`vocabularyOf`), the words the
 * tree's definitions the request carries show, which a class's code spells as often as the
 * person's; so `Born 12 March 1994` in a preamble's macro is found, whatever the builder could not
 * mask of it. In a definition of the tree's, a phrase of two words or more or an identifier of the
 * body's, the header's or a stored text's, since a single word of public code is no leak, and the
 * tree's classes set their own words on the page. Nor, in a setting or the class, is a single word
 * of the body's, a stored text's or the page's that a setting keeps as it is, one of its keywords
 * (`KEYWORDS`), `english` for a language section's word, or the name of a colour the settings
 * define, which the class's code names too; a word of the header's is, since the builder masks it
 * there. A text of one word and numbers, a name set above a phone number that the parser reads as
 * one run, is looked for as that word alone too. And every name the request holds of a macro of the
 * document's own, a definition's, a macro's, a dependency's and a command's a call site keeps, is
 * read as the builder reads it (`nameOrigin`): one that is a word of the header's name, or a word
 * or pair the page shows, is a leak, which names no macro. What it reads of a definition is what
 * the builder reads (`visibleOfMeaning`): a text written into code, a colour's name or a message,
 * it does not see.
 */
export function findLeaks(request: NamingRequest, document: DocumentText): Leak[] {
  const needles = needlesOf(document, true);
  const owned = ownNames(document.sources ?? []);
  const names = document.names ?? new Map<string, string>();
  const owns = (name: string) => isOwn(realName(names, name), owned);
  const vocabulary = vocabularyOf(
    request.definitions.flatMap((each) =>
      each.kind === "definition" && !owns(each.name) ? [each.text] : [],
    ),
  );
  const kept = new Set(
    [...KEYWORDS, ...coloursOf(request.preamble.settings.join("\n"))].map(folded),
  );
  const settingWord = (needle: Needle): Take =>
    needle.shape === "word" && needle.origin !== "header" && kept.has(needle.chars.join(""))
      ? undefined
      : settingTake(needle);
  const ownTake = (needle: Needle): Take => {
    const word = needle.chars.join("");
    if (needle.shape === "word" && needle.origin === "page")
      return lettersOf(word) >= NAME_WORD && !vocabulary.has(word) ? "whole" : undefined;
    if ((needle.shape === "number" || needle.shape === "run") && vocabulary.has(word))
      return undefined;
    return "whole";
  };
  const treeTake = (needle: Needle): Take =>
    needle.shape === "word" ||
    needle.shape === "number" ||
    needle.shape === "run" ||
    needle.origin === "page"
      ? undefined
      : "whole";
  /** A take, with the single words the builder does not mask by left out. */
  const masking =
    (take: (needle: Needle) => Take) =>
    (needle: Needle): Take =>
      needle.shape === "word" && needle.origin !== "header" ? undefined : take(needle);
  const originIn = (text: string, reads: Reads, masks: boolean): Origin | undefined => {
    const as = (take: (needle: Needle) => Take) => (masks ? masking(take) : take);
    if (reads === "source") return found(visibleOfSource(text), needles, as(settingTake)).origin;
    if (reads === "setting") return found(visibleOfSource(text), needles, as(settingWord)).origin;
    if (reads === "own") {
      const visible = visibleOfMeaning(text);
      return masks
        ? ownHidden(visible, needles, as(ownTake), vocabulary).origin
        : found(visible, needles, ownTake).origin;
    }
    return found(visibleOfMeaning(text), needles, as(treeTake)).origin;
  };
  const leaks: Leak[] = [];
  for (const { kind, macro, where, text, reads } of textsOf(request, owns)) {
    const masked = originIn(text, reads, true);
    const origin = masked ?? originIn(text, reads, false);
    if (origin !== undefined)
      leaks.push({
        origin,
        kind,
        ...(macro === undefined ? {} : { macro }),
        where,
        ...(masked === undefined ? { alone: true as const } : {}),
      });
  }
  const nameNeedles = nameNeedlesOf(document);
  // What each name's definitions the request holds are, by its base: their texts, or data.
  const held = new Map<string, { texts: string[]; data: boolean }>();
  for (const each of request.definitions) {
    const base = baseName(each.name);
    const entry = held.get(base) ?? { texts: [], data: false };
    if (each.kind === "definition") entry.texts.push(each.text);
    else entry.data = true;
    held.set(base, entry);
  }
  for (const name of namesOf(request)) {
    if (!isOwn(name, owned)) continue;
    const base = baseName(name);
    const entry = held.get(base) ?? { texts: [], data: false };
    const spells = spelling(base, entry.texts, entry.data);
    const person = nameOrigin(base, nameNeedles, vocabulary, spells);
    if (person !== undefined)
      leaks.push({ origin: person.origin, kind: "name", where: "a name the request holds" });
  }
  return leaks;
}

/**
 * A word of the header's that a setting or the class holds, as `explainSettingLeaks` tells it,
 * never the word: the setting's command, or `documentclass` for the class; the key it is the value
 * of, where the key is one of the settings' keywords; how many letters and digits it has; whether
 * the page shows it as a word, and a stored text holds it as a word; whether the setting keeps it as
 * it is (a keyword or a colour the preamble names), where every other word goes as its placeholder;
 * and which needles would mask it there (`caughtBy`): the header's words, of MIN_NEEDLE letters or
 * more, which the browser's request is built without; the page's words, of MIN_NEEDLE letters or
 * more, or of NAME_WORD as a macro's name is read; a stored text's word; and none of those but the
 * header's reached a setting's single word before decision 0038.
 */
export interface SettingLeak {
  command: string;
  key?: string;
  letters: number;
  onPage: boolean;
  stored: boolean;
  kept: boolean;
  caughtBy: string[];
}

/**
 * Why a request's settings and class hold words of the header's (`SettingLeak`), for the leak
 * runner to tell a failure it finds there without the text (decision 0038).
 */
export function explainSettingLeaks(request: NamingRequest, document: DocumentText): SettingLeak[] {
  const needles = needlesOf(document, true);
  const pageWords = new Set((document.page?.words ?? []).map(folded));
  const storedWords = new Set((document.stored ?? []).flatMap(wordsOf).map(folded));
  const kept = new Set(
    [...KEYWORDS, ...coloursOf(request.preamble.settings.join("\n"))].map(folded),
  );
  const header = (needle: Needle): Take =>
    needle.origin === "header" ? settingTake(needle) : undefined;
  const places = [
    ...request.preamble.settings.map((text) => ({
      text,
      command: /^\\([A-Za-z@]+)/.exec(text)?.[1] ?? "a setting",
    })),
    ...(request.preamble.class === undefined
      ? []
      : [request.preamble.class.name, ...request.preamble.class.options].map((text) => ({
          text,
          command: "documentclass",
        }))),
  ];
  const told: SettingLeak[] = [];
  for (const { text, command } of places) {
    const visible = visibleOfSource(text);
    const { hide } = found(visible, needles, header);
    for (let i = 0; i < visible.text.length; ) {
      if (hide[i] !== 1) {
        i++;
        continue;
      }
      let j = i;
      while (j < visible.text.length && hide[j] === 1) j++;
      const word = visible.text.slice(i, j).join("");
      const before = text.slice(0, visible.at[i] ?? 0);
      const key = /([A-Za-z@]+)\s*=\s*\{?\s*$/.exec(before)?.[1];
      told.push({
        command,
        ...(key !== undefined && KEYWORDS.has(key.toLowerCase()) ? { key } : {}),
        letters: j - i,
        onPage: pageWords.has(word),
        stored: storedWords.has(word),
        kept: kept.has(word),
        caughtBy: [
          `the header's words, of ${MIN_NEEDLE} letters or more`,
          ...(pageWords.has(word) ? [`the page's words, of ${MIN_NEEDLE} letters or more`] : []),
          ...(pageWords.has(word) && j - i >= NAME_WORD
            ? [`the page's words, of ${NAME_WORD} letters or more`]
            : []),
          ...(storedWords.has(word) ? ["a stored text's words"] : []),
        ],
      });
      i = j;
    }
  }
  return told;
}

/**
 * Throw when a request holds any of a document's text, as `findLeaks` finds it, or when the page
 * the document was read by is one the detector cannot read (`pageReadable`), which leaves what a
 * macro of the preamble writes unseen: the message says what kind of text is where, never the text.
 */
export function assertNoText(request: NamingRequest, document: DocumentText): void {
  if (document.page !== undefined && !pageReadable(document.page))
    throw new Error(
      "The naming request is refused: the page's fonts cannot be read, so the check cannot tell the document's text.",
    );
  const [leak] = findLeaks(request, document);
  if (leak !== undefined)
    throw new Error(
      `The naming request holds the document's text (${leak.origin}) in ${leak.where}.`,
    );
}
