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
 * its name alone, as data does.
 *
 * The document's values are its body's text, its header's values and the texts its preamble
 * stores, and its page (`pageStrings`, decision 0029): the reference compile's glyphs, read as
 * words, which hold whatever a macro of the preamble writes that no body text names. The page's
 * pairs of words and its identifiers mask the document's own definitions and the settings as the
 * body's do; its single words are the template's as often as the person's, and mask nothing.
 *
 * `findLeaks` checks a request against a document more strictly than the builder masks, the
 * page's single words among what it looks for outside definitions, and `assertNoText` throws,
 * naming where but never what, when any of the document's text is in it.
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
import type { NativeFontFile } from "../page/native";
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
import type { EngineSignatures, Signature } from "./signatures";
import { maskComments } from "./source";
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
 * digits; a phrase of two words or more; or one word.
 */
interface Needle {
  chars: string[];
  origin: Origin;
  shape: "identifier" | "phrase" | "word";
}

/** The document's texts, folded, by their first MIN_NEEDLE characters, and their phrases' pairs. */
interface Needles {
  byPrefix: Map<string, Needle[]>;
  /** Each pair of adjacent words a phrase holds, each folded, a space between, and its origin. */
  pairs: Map<string, Origin>;
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
 * pair of adjacent words that start with letters, a space between; and each identifier, an email,
 * a link's address, host or handle, or a run of DIGITS digits or more. Each once, in the page's
 * order.
 */
export interface PageStrings {
  words: readonly string[];
  pairs: readonly string[];
  identifiers: readonly string[];
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

/**
 * The advance of a glyph of a glyph stream, in scaled points, as its font gives it: a TeX font's
 * width from its metrics, at its size, and a native font's advance from its file, at its size and
 * stretched as XeTeX stretches it; or undefined when its font did not load. Each font is loaded
 * once, as the page loads it.
 */
async function advancesOf(
  stream: GlyphStream,
  fonts: PageFonts,
): Promise<(glyph: ReferenceGlyph) => number | undefined> {
  const tex = new Map<string, Tfm | undefined>();
  const native = new Map<string, NativeFontFile | undefined>();
  for (const page of stream.pages)
    for (const item of page.items)
      if (item.kind === "glyph") (item.native === true ? native : tex).set(item.font, undefined);
  for (const name of tex.keys())
    tex.set(name, (await fonts.load(name).catch(() => undefined))?.tfm);
  for (const name of native.keys())
    native.set(name, (await fonts.loadNative(name).catch(() => undefined))?.file);
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

/**
 * What a reference's glyphs read as, for the leak detector (`PageStrings`): each glyph's text as
 * the page names it (`glyphTextOf`), in the order the output sets them, a line's glyphs joined and
 * parted into words where the gap after a glyph's advance is WORD_GAP of an em or more, and lines
 * parted where a glyph's baseline moves or it steps back; a word TeX hyphenated at a line's end
 * read whole, a spacing accent left out and a mark kept with its letter. The words are then read
 * as a body's text is read, parted at punctuation (`wordsOf`), and a line's digits as a phone's
 * (`digitRuns`). A glyph with no text parts words. It takes time linear in the glyphs.
 */
export async function pageStrings(stream: GlyphStream, fonts: PageFonts): Promise<PageStrings> {
  const advance = await advancesOf(stream, fonts);
  const lines: string[][] = [];
  let line: string[] = [];
  let token = "";
  let last: ReferenceGlyph | undefined;
  const endToken = () => {
    if (token !== "") line.push(token);
    token = "";
  };
  const endLine = () => {
    endToken();
    if (line.length > 0) lines.push(line);
    line = [];
  };
  for (const page of stream.pages) {
    endLine();
    last = undefined;
    for (const item of page.items) {
      if (item.kind !== "glyph") continue;
      const text = item.text ?? "";
      if (SPACING_ACCENTS.has(text)) continue;
      // A mark goes with the letter before it, wherever XeTeX places it.
      if (text !== "" && /^\p{M}+$/u.test(text)) {
        token += text;
        continue;
      }
      if (last !== undefined) {
        const em = last.size;
        const end = last.h + (advance(last) ?? em / 2);
        if (Math.abs(item.v - last.v) > BASELINE_MOVE * em || item.h < last.h) {
          // A word TeX hyphenated at a line's end goes on at the next line's start.
          if (/\p{L}[-\u2010\u00ad]$/u.test(token) && /^\p{Ll}/u.test(text))
            token = token.slice(0, -1);
          else endLine();
        } else if (item.h - end >= WORD_GAP * em) endToken();
      }
      last = item;
      if (text.trim() === "") endToken();
      else token += text;
    }
  }
  endLine();
  const identifiers = new Set<string>();
  const sequence: string[] = [];
  for (const each of lines) {
    for (const word of each) {
      for (const found of pageIdentifiers(word)) identifiers.add(found);
      for (const part of wordsOf(word)) sequence.push(part);
    }
    for (const run of digitRuns(each.join(" "))) identifiers.add(run);
  }
  const words = new Set<string>();
  const pairs = new Set<string>();
  sequence.forEach((word, i) => {
    if (lettersOf(word) >= MIN_NEEDLE) words.add(word);
    const next = sequence[i + 1];
    if (next !== undefined && lettered(word) && lettered(next)) pairs.add(`${word} ${next}`);
  });
  return { words: [...words], pairs: [...pairs], identifiers: [...identifiers] };
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
 * with the word before it and the word after it (`addressNeedles`); and the page's pairs of words
 * and its identifiers (`PageStrings`), as the body's. Never a link's label, which is the class's
 * word as often as not (`GitHub`), nor a single word of the body's, a stored text's or the page's.
 * What the check looks for (`check`) is that and every other text of the document's besides, the
 * single words among them, the page's too. A text of the body's that holds `=` is code,
 * `leftmargin=*`, and so is a raw chunk's quantity, `0.5cm`, and a single word of its options'
 * brackets, `\faFile*[regular]`: none is looked for.
 */
function needlesOf(document: DocumentText, check: boolean): Needles {
  const byPrefix = new Map<string, Needle[]>();
  const pairs = new Map<string, Origin>();
  const seen = new Set<string>();
  const add = (text: string, origin: Origin, shape: Needle["shape"]) => {
    const found = folded(text);
    const chars = [...found];
    if (chars.length < MIN_NEEDLE || placeholderLike(found)) return;
    // The header's needles are kept apart, so that the check knows a word of the name as the
    // header's wherever the body writes it too.
    const id = `${shape} ${origin === "header" ? "header" : ""} ${found}`;
    if (seen.has(id)) return;
    seen.add(id);
    const prefix = chars.slice(0, MIN_NEEDLE).join("");
    const list = byPrefix.get(prefix) ?? [];
    list.push({ chars, origin, shape });
    byPrefix.set(prefix, list);
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
  // identifiers and its pairs of words, which mask as the body's phrases do, and for the check its
  // single words too.
  const page = document.page;
  for (const each of page?.identifiers ?? []) add(each, "page", "identifier");
  for (const pair of page?.pairs ?? []) add(pair, "page", "phrase");
  if (check) for (const word of page?.words ?? []) add(word, "page", "word");
  return { byPrefix, pairs };
}

// What a matcher reads of a request's texts.

/**
 * The letters and digits of a text a matcher reads, folded (`fold`): their places in the text, in
 * code units; whether each starts a word, which it does when anything but a letter, a digit or a
 * mark comes before it; and whether each opens a literal, a stretch of text that no command,
 * brace, parameter or code parts.
 */
interface Visible {
  at: number[];
  text: string[];
  starts: boolean[];
  opens: boolean[];
}

/**
 * A visible text being read: `push` a character the reader met; `gap` anything between words;
 * `boundary` anything that ends a literal; `drop` the characters read since a place, which were
 * code after all, as a key is once its `=` comes.
 */
function reader() {
  const visible: Visible = { at: [], text: [], starts: [], opens: [] };
  let gap = true;
  let open = true;
  return {
    visible,
    push(at: number, char: string) {
      // A mark is part of its letter's word, as a Devanagari vowel sign is.
      if (/^\p{M}$/u.test(char)) return;
      const letter = fold(char);
      if (letter === "") {
        gap = true;
        return;
      }
      visible.at.push(at);
      visible.text.push(letter);
      visible.starts.push(gap);
      visible.opens.push(open);
      gap = false;
      open = false;
    },
    gap() {
      gap = true;
    },
    boundary() {
      gap = true;
      open = true;
    },
    drop(from: number) {
      if (visible.opens.slice(from).includes(true)) open = true;
      for (const list of [visible.at, visible.text, visible.starts, visible.opens])
        list.length = Math.min(list.length, from);
      gap = true;
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
 * A control sequence at `at` of a meaning, as the engine prints one there (`signatures.ts`), a
 * space after each but the control space: its name, and where it ends, past that space. A name
 * xparse gives a command's or an environment's code, which holds spaces, is read whole.
 */
function controlSequence(meaning: string, at: number, to: number): { name: string; end: number } {
  if (meaning[at + 1] === " ") return { name: " ", end: at + 2 };
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

/** What a command whose arguments are code takes: its mandatory arguments, and optional ones after. */
interface Takes {
  take: number;
  after?: true;
}

/** A list of commands that take `take` arguments of code, and optional ones after them when `after`. */
const takes = (take: number, names: readonly string[], after?: true) =>
  names.map((name): [string, Takes] => [name, after === undefined ? { take } : { take, after }]);

/**
 * Commands whose arguments are code, not text the page shows, as a matcher reads a meaning, and how
 * many mandatory arguments each takes, braced or a single token, the optional ones before and
 * between them with them: a colour's, a counter's, a length's or a boolean's name, a package's, a
 * class's or a file's, a label or a link's target, a key list, a font's name and features, a
 * language, a condition, pgf's mathematics, and a message's text, which the log shows and the page
 * never does. `\csname` to `\endcsname` is code too, and so is each key of a key list, the text
 * before an `=`, and in an option list's brackets each value, as tikz's `[draw=white]` has it.
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

/** Where a code command's arguments (`CODE`) end, from `at`, just past the command. */
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
 * (`CODE`), what `\csname` names, a key of a key list, or a pattern's placeholder. A command, a
 * brace, a parameter and code each end a literal; a control symbol, an accent or a thin space,
 * parts words and not literals, but for `\\`, a line's end.
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
    for (let i = from; i < to; ) {
      const char = meaning[i] ?? "";
      if (char === "\\") {
        const { name, end } = controlSequence(meaning, i, to);
        i = end;
        if ([...name].length === 1 && !/^[A-Za-z]$/.test(name)) {
          if (name === "\\") read.boundary();
          else read.gap();
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
      if (char === "{" || char === "}") {
        if (char === "{") groups.push(char);
        else closeGroup("{");
        read.boundary();
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
      if (",;[]()".includes(char)) {
        if (char === "[") groups.push(char);
        else if (char === "]") closeGroup("[");
        read.gap();
        i++;
        keyFrom(i);
        continue;
      }
      const masked = char === "<" ? placeholderAt(meaning, i) : 0;
      if (masked > 0 && i + masked <= to) {
        read.boundary();
        i += masked;
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
  for (let i = 0; i + MIN_NEEDLE <= size; i++) {
    const candidates = needles.byPrefix.get(chars.slice(i, i + MIN_NEEDLE).join(""));
    if (candidates === undefined) continue;
    for (const needle of candidates) {
      const how = take(needle);
      const length = needle.chars.length;
      if (how === undefined || i + length > size || !at(i, needle)) continue;
      if (how === "whole" && !(startsAt(i) && startsAt(i + length))) continue;
      hide.fill(1, i, i + length);
      origin ??= needle.origin;
    }
  }
  return { hide, ...(origin === undefined ? {} : { origin }) };
}

/**
 * The pairs of adjacent words of a text's literals that a phrase of the document holds (the
 * literal rule, in the definition's direction), marked in `hide`, and where the first came from:
 * `{\Large Quill Invented}` holds a pair of the paragraph `Quill Invented, typesetter at Larkspur
 * Labs`, though not the paragraph.
 */
function pairsFound(visible: Visible, pairs: ReadonlyMap<string, Origin>, hide: Uint8Array) {
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
    if (first === undefined || second === undefined || first.literal !== second.literal) continue;
    const hit = pairs.get(`${first.text} ${second.text}`);
    if (hit === undefined) continue;
    hide.fill(1, first.from, second.to);
    origin ??= hit;
  }
  return origin;
}

/**
 * What of an own definition's visible text is the document's (decision 0024): each of its texts
 * the definition holds as whole words, as `take` takes them, and each pair of adjacent words of one
 * of the definition's literals that a phrase of the document holds (`pairsFound`); and where the
 * first came from.
 */
function ownHidden(
  visible: Visible,
  needles: Needles,
  take: (needle: Needle) => Take = () => "whole",
): { hide: Uint8Array; origin?: Origin } {
  const { hide, origin } = found(visible, needles, take);
  const paired = pairsFound(visible, needles.pairs, hide);
  const first = origin ?? paired;
  return { hide, ...(first === undefined ? {} : { origin: first }) };
}

/**
 * How a setting takes the document's texts, and the check a text it reads as source: an
 * identifier of ANYWHERE characters or more anywhere, and all else as whole words.
 */
const settingTake = (needle: Needle): Take =>
  needle.shape === "identifier" && needle.chars.length >= ANYWHERE ? "anywhere" : "whole";

/** A text with the characters `hide` marks among its visible ones written as their placeholders. */
function hidden(text: string, visible: Visible, hide: Uint8Array): string {
  if (!hide.includes(1)) return text;
  let out = "";
  let from = 0;
  visible.at.forEach((at, i) => {
    if (hide[i] !== 1) return;
    const whole = String.fromCodePoint(text.codePointAt(at) ?? 0);
    out += text.slice(from, at) + placeholder(whole);
    from = at + whole.length;
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
 * written as its placeholder; commands' names, braces and punctuation as they are.
 */
function maskedSetting(statement: string, colours: ReadonlySet<string>): string {
  const keep = (word: string) =>
    QUANTITY.test(word) ||
    HEX.test(word) ||
    KEYWORDS.has(word.toLowerCase()) ||
    colours.has(word.toLowerCase());
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
 * The preamble's candidate settings: the class and its options, and each statement of a setting
 * command, in order, its comments gone, each masked as a setting is (`maskedSetting`), then by the
 * document's own values, its words and phrases as whole words and its identifiers of ANYWHERE
 * characters or more anywhere (`settingTake`), and cut at the request's cap.
 */
function preambleOf(preamble: string, needles: Needles): RequestPreamble {
  const text = withoutComments(preamble);
  const colours = coloursOf(text);
  const mask = (statement: string) => {
    const masked = maskedSetting(statement.replace(/\s+/g, " ").trim(), colours);
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
   * The page's strings (`pageStrings`), whose pairs of words and identifiers mask the document's
   * own definitions and the settings as the body's do, so that a name a macro of the preamble
   * writes, which no body text names, is masked where the page shows it.
   */
  page?: PageStrings;
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

/**
 * The naming request for a document (decision 0024): each template macro and environment its body
 * calls or opens, and each the preamble calls to store the header's text, with its definition and
 * its closure's, masked, its key, the probe's verdicts and up to three call sites; and the
 * preamble's settings. `tree` is the body's, `signatures` what the engine said of the body's names
 * and the preamble's (`probeUses`), `probe` the probe's aggregates and candidates, and
 * `preamble` the main file's text before `\begin{document}`; the options give the upload's
 * sources, the header's values and the page's strings, which the import passes all of (decision
 * 0029). The request is checked against the contract's schema before it is given back, so that a
 * call site holding the document's text throws rather than leaves.
 */
export async function buildRequest(
  tree: Tree,
  signatures: EngineSignatures,
  probe: Pick<Probe, "macros" | "candidates">,
  preamble: string,
  options: RequestOptions = {},
): Promise<NamingRequest> {
  const ofPreamble = probe.candidates.filter((each) => each.where === "preamble");
  const needles = needlesOf(
    {
      tree,
      ...(options.header === undefined ? {} : { header: options.header }),
      stored: ofPreamble.map((each) => each.text),
      ...(options.page === undefined ? {} : { page: options.page }),
    },
    false,
  );
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

  // The definitions: every macro's own and its closure's; the document's own masked by its values.
  // A macro a storing call of the preamble's stored its argument in holds the person's text,
  // whoever defines it, as europecv's `\ecv@rfoot` holds what `\ecvfootnote` was given: it is data,
  // as it would be had that text named no command, and goes by its name alone.
  const storage = new Set([...setters].flatMap((name) => storedIn(macroOf(name))));
  const definitions = new Map<string, RequestDefinition>();
  const define = async (name: string) => {
    if (definitions.has(name)) return;
    const macro = macroOf(name);
    if (macro === undefined) return;
    if (macro.kind === "data" || storage.has(name)) {
      definitions.set(name, { kind: "data", name });
      return;
    }
    let text = macro.meaning;
    if (isOwn(name, owned)) {
      const visible = visibleOfMeaning(macro.meaning);
      text = hidden(macro.meaning, visible, ownHidden(visible, needles).hide);
    }
    const hash = text === macro.meaning ? macro.hash : await sha256(text);
    definitions.set(name, { kind: "definition", name, hash, text });
  };

  const macros: RequestMacro[] = [];
  for (const list of byMacro.values()) {
    const [first] = list;
    if (first === undefined) continue;
    const { of, name } = first;
    const own = macroOf(name);
    if (own === undefined) continue;
    const endName = `end${name}`;
    const end = of === "environment" ? macroOf(endName) : undefined;
    const closure = [
      ...(end === undefined ? [] : [endName]),
      ...(own.kind === "data" ? [] : own.dependencies),
      ...(end === undefined || end.kind === "data" ? [] : end.dependencies),
    ];
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
    const sites: CallSite[] = chosen(called).map((use) => {
      const dates = sources.get(use.source) ?? [];
      const site: CallSite = {
        arguments: kinds.map((_, i) => {
          const arg = use.args[i];
          if (arg === undefined || !arg.present) return null;
          return cut(
            sketch(use.source, arg.innerStart, arg.innerEnd, dates, known),
            REQUEST_CAPS.site,
          );
        }),
      };
      const content = use.content ?? [];
      const firstNode = content[0];
      const lastNode = content.at(-1);
      if (of === "environment" && firstNode !== undefined && lastNode !== undefined)
        site.body = cut(sketch(use.source, firstNode.start, lastNode.end, dates, known), 600);
      return site;
    });
    const ownDefinition = definitions.get(name);
    const endDefinition = end === undefined ? undefined : definitions.get(endName);
    const hashed = (names: readonly string[]) =>
      names.flatMap((dependency): Dependency[] => {
        const found = definitions.get(dependency);
        return found?.kind === "definition" ? [[dependency, found.hash]] : [];
      });
    // An environment's key is its `\begin` code's, its `\end` code the first of its closure
    // (`environmentKeyOf`), as item 4's keys have it; one whose `\end` code holds data, or that
    // the engine did not print, keys as a command does, data left out.
    const key =
      ownDefinition?.kind !== "definition"
        ? undefined
        : of === "environment" && endDefinition?.kind === "definition"
          ? await environmentKeyOf(
              NAMING_VERSION,
              ownDefinition.hash,
              endName,
              endDefinition.hash,
              hashed(dependencies.filter((each) => each !== endName)),
            )
          : await keyOf(NAMING_VERSION, ownDefinition.hash, hashed(dependencies));
    const capped = (macro: typeof own | undefined) =>
      macro !== undefined && macro.kind !== "data" && macro.capped;
    macros.push({
      of,
      name,
      ...(signature === undefined ? {} : { signature: maskedSignature(signature, defaultOf) }),
      ...(key === undefined ? {} : { key }),
      dependencies,
      capped: capped(own) || capped(end),
      arguments: args,
      sites,
      calls: called.length,
    });
  }

  const family = familyOf(
    classOf(withoutComments(preamble))?.name,
    new Set(macros.map((macro) => macro.name)),
  );
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: signatures.engine,
    ...(family === undefined ? {} : { family }),
    preamble: preambleOf(preamble, needles),
    macros,
    definitions: [...definitions.values()],
  });
}

// Redefinitions.

/** Where a statement's argument in `open` and `close` that starts at `at` ends, past its close. */
function closing(text: string, at: number, open: string, close: string): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return i + 1;
  }
  return -1;
}

/** Where a line's comment starts, a `%` after an even run of backslashes, or the line's end. */
function commentAt(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "%") continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) return i;
  }
  return line.length;
}

/**
 * Where a main file's `\documentclass` statement ends, its options and its class's name read: the
 * first outside a comment; or -1 when it has none.
 */
export function classEnd(text: string): number {
  let offset = 0;
  for (const line of text.split("\n")) {
    const found = /\\documentclass(?![A-Za-z@])/.exec(line.slice(0, commentAt(line)));
    if (found !== null) {
      let at = offset + found.index + found[0].length;
      const skip = () => {
        while (/\s/.test(text[at] ?? "")) at++;
      };
      skip();
      if (text[at] === "[") {
        at = closing(text, at, "[", "]");
        if (at < 0) return -1;
        skip();
      }
      if (text[at] !== "{") return -1;
      return closing(text, at, "{", "}");
    }
    offset += line.length + 1;
  }
  return -1;
}

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

/** What kind of place in a request holds a text, as a leak names it. */
export type LeakKind =
  | "own definition"
  | "tree definition"
  | "call site"
  | "signature"
  | "setting"
  | "class";

/**
 * A text of the document's that a request holds (`findLeaks`): what kind of text it is, the
 * body's, a link's, a date, a raw chunk's, the header's, a stored text or the page's; what kind of
 * place holds it, and the macro whose definition, call site or signature that is, none for a
 * setting or the class; and where, as a message says it. Never the text.
 */
export interface Leak {
  origin: Origin;
  kind: LeakKind;
  macro?: string;
  where: string;
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

/** Where a request holds a text, and how the check reads it: never the text itself. */
function textsOf(request: NamingRequest, owned: ReadonlySet<string>): Held[] {
  const texts: Held[] = [];
  for (const definition of request.definitions)
    if (definition.kind === "definition") {
      const own = isOwn(definition.name, owned);
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
 * call site, a signature's defaults, a setting or the class; in a definition of the document's
 * own, the same but a single word only the page shows, which is the template's as often as the
 * person's (and in one, any pair of adjacent words a phrase of the document holds); and in a
 * definition of the tree's, a phrase of two words or more or an identifier of the body's, the
 * header's or a stored text's, since a single word of public code is no leak, and the tree's
 * classes set their own words on the page. Nor, in a setting or the class, is a single word of the
 * body's, a stored text's or the page's that a setting keeps as it is, one of its keywords
 * (`KEYWORDS`), `english` for a language section's word, or the name of a colour the settings
 * define, which the class's code names too; a word of the header's is, since the builder masks it
 * there. A text of one word and numbers, a name set above a phone number that the parser reads as
 * one run, is looked for as that word alone too. What it reads of a definition is what the
 * builder reads (`visibleOfMeaning`): a text written into code, a colour's name or a message, it
 * does not see.
 */
export function findLeaks(request: NamingRequest, document: DocumentText): Leak[] {
  const needles = needlesOf(document, true);
  const owned = ownNames(document.sources ?? []);
  const kept = new Set(
    [...KEYWORDS, ...coloursOf(request.preamble.settings.join("\n"))].map(folded),
  );
  const settingWord = (needle: Needle): Take =>
    needle.shape === "word" && needle.origin !== "header" && kept.has(needle.chars.join(""))
      ? undefined
      : settingTake(needle);
  const ownTake = (needle: Needle): Take =>
    needle.shape === "word" && needle.origin === "page" ? undefined : "whole";
  const treeTake = (needle: Needle): Take =>
    needle.shape === "word" || needle.origin === "page" ? undefined : "whole";
  const leaks: Leak[] = [];
  for (const { kind, macro, where, text, reads } of textsOf(request, owned)) {
    let origin: Origin | undefined;
    if (reads === "source") origin = found(visibleOfSource(text), needles, settingTake).origin;
    else if (reads === "setting")
      origin = found(visibleOfSource(text), needles, settingWord).origin;
    else if (reads === "own") origin = ownHidden(visibleOfMeaning(text), needles, ownTake).origin;
    else origin = found(visibleOfMeaning(text), needles, treeTake).origin;
    if (origin !== undefined)
      leaks.push({ origin, kind, ...(macro === undefined ? {} : { macro }), where });
  }
  return leaks;
}

/**
 * Throw when a request holds any of a document's text, as `findLeaks` finds it: the message says
 * what kind of text is where, never the text.
 */
export function assertNoText(request: NamingRequest, document: DocumentText): void {
  const [leak] = findLeaks(request, document);
  if (leak !== undefined)
    throw new Error(
      `The naming request holds the document's text (${leak.origin}) in ${leak.where}.`,
    );
}
