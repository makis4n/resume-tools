/**
 * The import's report and its success bar (milestone 3 item 13, plan section 6.2, decision 0039):
 * what share of the resume's words came out editable, whether that passes the bar, what is locked
 * and what was left out, in plain words that never show a macro's name or a line of source.
 *
 * **The count.** The words are the reference's: its glyph stream read as the aligner reads a
 * field's glyphs (`pageWords`), each glyph's text as the page names it, a ligature its letters, an
 * accent over a letter composed with it, a TeX spelling such as `--` the character it sets; a
 * space wherever the next glyph starts further on than the glyph before it ends, by more than a
 * tenth of its size, or on another line, but after the hyphen TeX adds where it breaks a word at a
 * line's end; a word a run of letters and digits, as the assembly counts a field's (`wordsIn`), so
 * punctuation parts words as a space does. Each word is set by
 * what sets most of its glyphs, as the assembly read the probe's runs (`AssemblyChecks.owners`):
 * an editable field, typeset, which the page opens in place, or set raw, which the side panel
 * alone edits; a locked part, with why; or the template's own text, a label, a separator or a
 * page's number, which is no word of the resume's; but a running header or footer a locked part of
 * the source sets is that part's whole on every page, what its call passes among it, a date or a
 * page's number (`ownRunningLines`). The body's words are all the resume's, and the
 * editable rate the share of them editable in place, as plan section 6.2 has the bar: the side
 * panel's are counted apart.
 *
 * **The bar.** An import succeeds when the regenerated document set the reference's glyph stream,
 * its first check holding, and at least `SUCCESS_RATE` of the body's words are editable; anything
 * else is partial, and the person continues with it as it is or stops (`outcomeOf`).
 *
 * Node runs this file as it is, from the corpus runners, so it imports nothing but types: every
 * value it needs is its own.
 */

import type { AssemblyChecks, GlyphOwner, LockedPart, LockReason } from "./assemble";
import type { Intake } from "./intake";
import type { GlyphStream, Reference, ReferenceGlyph } from "./reference";
import type { ImportReport } from "./run";

/**
 * What the first pass's naming step came to (decision 0038), which the report still reads from an
 * assembly of the corpus's runner: how many of the request's macros the service's cache answered,
 * how many it asked its model, how many keys were left unfiled because their answers disagree, and
 * how many macros it left with no answer; or, when no answer came at all, why. A `.tex` import of
 * the second pass names nothing (decision 0049), and the naming step goes with item 17.
 */
export type NamingOutcome =
  | { hits: number; asked: number; conflicts: number; missing: number }
  | { failed: string };

/**
 * The share of the body's words that must be editable for an import to succeed, with its first
 * check holding: plan section 6.2's 90%.
 */
export const SUCCESS_RATE = 0.9;

/** How many of a locked part's first words the report names it by. */
export const FIRST_WORDS = 8;

/** What an import came to: succeeded at the bar, or partial below it or with its page moved. */
export type ReportOutcome = "succeeded" | "partial";

/** A locked part as the report names it: by its first words as the page shows them, and why. */
export interface LockedShown {
  /** Its first words as the page shows them, at most `FIRST_WORDS`, with an ellipsis after. */
  words: string;
  /** How many of the page's words it sets. */
  count: number;
  reason: LockReason;
  /** Why, in plain words (`LOCK_WHY`). */
  why: string;
  /**
   * The locked section it is, by id, where it is one, whose row the side panel names by `words`
   * (decision 0041).
   */
  section?: string;
}

/** Something the import left out, or kept otherwise than the upload had it, in plain words. */
export interface DroppedShown {
  kind: "images" | "bibliography" | "control" | "file";
  text: string;
}

/** The import's report. */
export interface Report {
  outcome: ReportOutcome;
  /** The body's words' editable share, from 0 to 1. */
  rate: number;
  /** Whether the regenerated document set the reference's glyph stream: the first check held. */
  matched: boolean;
  words: {
    /** In fields the page opens, editable in place, which the rate counts. */
    editable: number;
    /** In fields set raw, which the side panel alone edits, where the page cannot mark them. */
    panel: number;
    /** Locked, in all and by reason. */
    locked: number;
    byReason: Partial<Record<LockReason, number>>;
    /** The body's: the editable in place, the side panel's and the locked ones. */
    body: number;
    /** The template's own text, which is no word of the resume's. */
    template: number;
  };
  /** Each locked part that sets a word on the page, in the page's order. */
  locked: LockedShown[];
  /** What the import left out: images, a bibliography, a control, a file. */
  dropped: DroppedShown[];
  /** What else the person should know, a sentence each. */
  notes: string[];
}

/** What the report reads of an import beside its assembly and its reference: the intake's part. */
export interface ReportInputs {
  /** The images the intake stood in for and dropped (`Intake.images`). */
  images?: Intake["images"];
  /** What the intake and the XeTeX rewrite said, plain English naming files at most. */
  warnings?: readonly string[];
  /** How the naming step went; a failure is why every macro stayed as the probe left it. */
  naming?: NamingOutcome;
}

/**
 * Whether an import succeeds (plan section 6.2, decision 0039): its regenerated document set the
 * reference's glyph stream, and at least `SUCCESS_RATE` of its body's words are editable.
 */
export function outcomeOf(rate: number, matched: boolean): ReportOutcome {
  return matched && rate >= SUCCESS_RATE ? "succeeded" : "partial";
}

/**
 * The report of an import (decision 0039): its words read from the reference's glyph stream and
 * set down to what sets each (`AssemblyChecks.owners`), its rate and outcome, its locked parts by
 * their first words, and what was left out. `assembled` is what `validate` returns, or what the
 * store keeps of it (`ImportReport`: the checks, and the locked parts as `locked`); `inputs` the
 * intake's images and warnings and how the naming went. The assembly's document, where it comes,
 * says which hyphens a line ends with are the resume's own (`readPage`). An assembly made before
 * the owners were read, whose words cannot be set down on the page, is counted as the assembly
 * counted its source's words, and names no part.
 */
export function reportOf(
  assembled: {
    checks: AssemblyChecks;
    extras: readonly LockedPart[];
    document?: { resume: unknown };
  },
  reference: Pick<Reference, "pages" | "bibliographyLeftOut" | "images">,
  inputs: ReportInputs = {},
): Report {
  const { checks } = assembled;
  const matched = checks.outcome === "assembled";
  const counted = checks.owners === undefined ? undefined : countWords(assembled, reference);
  const words = counted?.words ?? sourceWords(checks);
  const rate = words.body === 0 ? 0 : words.editable / words.body;
  return {
    outcome: outcomeOf(rate, matched),
    rate,
    matched,
    words,
    locked: counted?.locked ?? [],
    dropped: droppedOf(checks, reference, inputs),
    notes: [
      ...notesOf(checks, inputs),
      // The side panel's words, which the rate leaves out, said apart (plan section 6.2).
      ...(words.panel === 0
        ? []
        : [
            `${words.panel === 1 ? "One more word is" : `${words.panel} more words are`} editable in the side panel, where the page cannot mark ${words.panel === 1 ? "it" : "them"}.`,
          ]),
    ],
  };
}

/**
 * The report of an import that came through (`Imported`): its report's inputs, as the store keeps
 * them (`ImportReport`, decision 0038), and its document.
 */
export function reportOfImport(imported: {
  report: Pick<ImportReport, "checks" | "locked" | "reference" | "images" | "warnings">;
  document: { resume: unknown };
}): Report {
  const { report } = imported;
  return reportOf(
    { checks: report.checks, extras: report.locked, document: imported.document },
    report.reference,
    { images: report.images, warnings: report.warnings },
  );
}

/**
 * Whether a resume writes two halves of a word a hyphen joins, `full` and `stack` as `full-stack`,
 * in its text or in what it keeps as the upload wrote it, whatever their case: the hyphen a line
 * ends with between them is then the resume's own, which parts two words, and not one TeX added.
 */
function writesHyphen(document: { resume: unknown }): (before: string, after: string) => boolean {
  const text = JSON.stringify(document.resume).toLowerCase();
  return (before, after) => text.includes(`${before}-${after}`.toLowerCase());
}

// The page's words.

/** A glyph as the report reads it: what the reference keeps of it. */
type Glyph = Pick<ReferenceGlyph, "text" | "h" | "v" | "width" | "size">;

/** A word of the page: its page, from 0, and its glyphs' places among the page's glyphs. */
export interface PageWord {
  page: number;
  glyphs: number[];
}

/** A page as the report reads it: each glyph's text as it counts, as it shows, and the spaces. */
export interface ReadPage {
  /**
   * Each glyph's text as the words are read from it: an accent over a letter folded into the
   * letter, and none left for the accent; a space for a glyph the page cannot name.
   */
  texts: string[];
  /** Whether a space stands before each glyph, as between words or at a line's start. */
  spaced: boolean[];
  words: PageWord[];
}

/** How far past the glyph before it a glyph must start to stand after a space, in its size. */
const SPACE = 0.1;

/** How far up or down a glyph must be from the one before it to stand on another line, in size. */
const LINE = 0.5;

/** How far back a glyph may start before the one before it on its line, in size. */
const BACK = 1;

/**
 * The spacing accents TeX's `\accent` sets over a letter, as the page names their glyphs (the
 * Adobe Glyph List's characters, and `^` and `~`, which the page reads OT1's circumflex and tilde
 * as), and the combining mark each is over a letter: `src/tex/glyphs.ts`'s `ACCENTS`, by text.
 */
const ACCENT_MARKS: ReadonlyMap<string, string> = new Map([
  ["`", "\u{300}"],
  ["\u{b4}", "\u{301}"],
  ["\u{2c6}", "\u{302}"],
  ["^", "\u{302}"],
  ["\u{2dc}", "\u{303}"],
  ["~", "\u{303}"],
  ["\u{af}", "\u{304}"],
  ["\u{2d8}", "\u{306}"],
  ["\u{2d9}", "\u{307}"],
  ["\u{a8}", "\u{308}"],
  ["\u{2da}", "\u{30a}"],
  ["\u{2dd}", "\u{30b}"],
  ["\u{2c7}", "\u{30c}"],
  ["\u{b8}", "\u{327}"],
  ["\u{2db}", "\u{328}"],
]);

/** A letter, which an accent before it may go over. */
const LETTER = /^\p{L}$/u;

/** A text that ends in a letter, and one that starts with a small letter, about a broken word. */
const LETTER_AT_END = /\p{L}$/u;
const SMALL_AT_START = /^\p{Ll}/u;

/** What a word is made of: letters and digits, and the marks that go with them. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

/** What a word starts with: a letter or a digit, as `wordsIn` counts a field's words. */
const WORD_START = /[\p{L}\p{N}]/u;

/**
 * Whether a space stands between two glyphs of a page: the second on another line, more than half
 * its size up or down; back from the first by more than its size, as at a column's top; or
 * starting further on than the first ends by more than a tenth of its size, which a kern between
 * two letters never is and the space between two words, at its tightest, is. A glyph of a stream
 * read before widths were kept is taken to be half its size wide.
 */
function spaceBetween(before: Glyph, after: Glyph): boolean {
  const size = Math.max(before.size, after.size, 1);
  if (Math.abs(after.v - before.v) > LINE * size) return true;
  if (after.h < before.h - BACK * size) return true;
  const end = before.h + (before.width ?? size / 2);
  return after.h - end > SPACE * size;
}

/**
 * A page's glyphs read into words, as the aligner reads a field's (`alignField`): each glyph's
 * text as the page names it, a ligature's its letters; a spacing accent directly before a letter
 * that starts over it, from twice the accent's width before it to the end of its advance, folded
 * into the letter, as `collectFields` composes the two; spaces where `spaceBetween` finds them; a
 * hyphen that ends a line between a letter and a small letter that starts the next read as the
 * break TeX added in a word, which goes on past it, as the aligner reads one TeX inserted, unless
 * `written` says the resume writes the two halves with a hyphen of its own; and a word each run of
 * letters and digits with no space or other character in it, its glyphs those it takes a
 * character of. A glyph the page cannot name reads as a space, and parts words.
 */
export function readPage(
  glyphs: readonly Glyph[],
  written?: (before: string, after: string) => boolean,
): ReadPage {
  // A glyph the page cannot name, as an icon, reads as a space: it parts words, and shows nothing.
  const texts = glyphs.map((glyph) => glyph.text ?? " ");
  const spaced = glyphs.map((glyph, i) => {
    const before = glyphs[i - 1];
    return before === undefined || spaceBetween(before, glyph);
  });
  for (let i = 0; i + 1 < glyphs.length; i++) {
    const mark = ACCENT_MARKS.get(texts[i] ?? "");
    const accent = glyphs[i] as Glyph;
    const letter = glyphs[i + 1] as Glyph;
    const width = accent.width ?? accent.size / 2;
    if (
      mark !== undefined &&
      LETTER.test(texts[i + 1] ?? "") &&
      Math.abs(letter.v - accent.v) <= LINE * Math.max(accent.size, letter.size) &&
      letter.h >= accent.h - 2 * width &&
      letter.h < accent.h + width
    ) {
      texts[i + 1] = `${texts[i + 1]}${mark}`.normalize("NFC");
      texts[i] = "";
      spaced[i + 1] = spaced[i] ?? true;
    }
  }
  // A hyphen that ends a line between a letter and a small letter that starts the next is one TeX
  // added where it broke a word, as the aligner reads one (`inserted`): the word goes on past it;
  // but for one the resume writes between the two halves itself (`written`).
  for (let i = 1; i + 1 < glyphs.length; i++) {
    const hyphen = glyphs[i] as Glyph;
    const next = glyphs[i + 1] as Glyph;
    if (
      texts[i] !== "-" ||
      spaced[i] ||
      Math.abs(next.v - hyphen.v) <= LINE * Math.max(hyphen.size, next.size) ||
      !LETTER_AT_END.test(texts[i - 1] ?? "") ||
      !SMALL_AT_START.test(texts[i + 1] ?? "")
    )
      continue;
    if (written?.(lettersBefore(texts, spaced, i), lettersFrom(texts, spaced, i + 1))) continue;
    texts[i] = "";
    spaced[i + 1] = false;
  }
  const words: PageWord[] = [];
  let word: number[] = [];
  const end = () => {
    if (word.length > 0) words.push({ page: 0, glyphs: word });
    word = [];
  };
  texts.forEach((text, i) => {
    if (spaced[i]) end();
    for (const character of text) {
      if (!WORD_CHARACTER.test(character) || (word.length === 0 && !WORD_START.test(character))) {
        end();
        continue;
      }
      if (word.at(-1) !== i) word.push(i);
    }
  });
  end();
  return { texts, spaced, words };
}

/** The letters a word holds right before glyph `i`, back to where it starts on its line. */
function lettersBefore(texts: readonly string[], spaced: readonly boolean[], i: number): string {
  let before = "";
  for (let k = i - 1; k >= 0 && /^\p{L}+$/u.test(texts[k] ?? ""); k--) {
    before = `${texts[k]}${before}`;
    if (spaced[k]) break;
  }
  return before;
}

/** The letters a word holds from glyph `i` on, as far as it goes before a space. */
function lettersFrom(texts: readonly string[], spaced: readonly boolean[], i: number): string {
  let after = "";
  for (let k = i; k < texts.length && /^\p{L}+$/u.test(texts[k] ?? ""); k++) {
    if (k > i && spaced[k]) break;
    after += texts[k];
  }
  return after;
}

/**
 * Every page of a glyph stream read into words (`readPage`), its glyphs alone; `written` says
 * which hyphens a line ends with are the resume's own. A word TeX broke with a hyphen at a page's
 * end, a letter before it and a small letter starting the next page, goes on there, as on a line's
 * end (`readPage`): it is one word, counted on the page it begins on, with its glyphs there, and
 * the next page's first word is no word of its own.
 */
export function pageWords(
  stream: Pick<GlyphStream, "pages">,
  written?: (before: string, after: string) => boolean,
): ReadPage[] {
  const pages = stream.pages.map((page, number) => {
    const glyphs = page.items.flatMap((item) => (item.kind === "glyph" ? [item] : []));
    const read = readPage(glyphs, written);
    for (const word of read.words) word.page = number;
    return read;
  });
  pages.forEach((read, number) => {
    const next = pages[number + 1];
    const end = read.texts.length - 1;
    if (
      next === undefined ||
      end < 1 ||
      read.texts[end] !== "-" ||
      read.spaced[end] ||
      next.words[0]?.glyphs[0] !== 0 ||
      !LETTER_AT_END.test(read.texts[end - 1] ?? "") ||
      !SMALL_AT_START.test(next.texts[0] ?? "")
    )
      return;
    if (
      written?.(
        lettersBefore(read.texts, read.spaced, end),
        lettersFrom(next.texts, next.spaced, 0),
      )
    )
      return;
    read.texts[end] = "";
    next.words.shift();
  });
  return pages;
}

/**
 * TeX's spellings of what a glyph sets, which the page names some glyphs by so that the aligner
 * reads them against a field's source, as the page shows them: dashes, quotes and the inverted
 * marks.
 */
const SHOWN_AS: ReadonlyMap<string, string> = new Map([
  ["---", "\u{2014}"],
  ["--", "\u{2013}"],
  ["``", "\u{201c}"],
  ["''", "\u{201d}"],
  ["!`", "\u{a1}"],
  ["?`", "\u{bf}"],
]);

/**
 * A text as the report shows it: one line, its controls and the private use area's characters
 * out, where an icon font's glyphs are, and no backslash or brace, so that nothing it shows reads
 * as source, whatever the page set.
 */
export function shown(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Co}\\{}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text a set of a page's glyphs shows, in the page's order, up to the end of its
 * `FIRST_WORDS`th word, with an ellipsis where more words follow: spaces where the page has them,
 * and between glyphs that are not side by side.
 */
export function firstWords(read: ReadPage, glyphs: readonly number[]): string {
  let text = "";
  let previous: number | undefined;
  let words = 0;
  let inWord = false;
  // Where the last word counted ends in the text, where the cut goes when one more follows.
  let ended = 0;
  for (const at of glyphs) {
    const own = read.texts[at] ?? "";
    const spaced = previous === undefined || at !== previous + 1 || read.spaced[at] === true;
    if (spaced && text !== "") text += " ";
    if (spaced) inWord = false;
    previous = at;
    for (const character of SHOWN_AS.get(own) ?? own) {
      const starts = WORD_START.test(character) && !inWord;
      if (starts && words === FIRST_WORDS) return `${shown(text.slice(0, ended))}\u{2026}`;
      if (starts) words++;
      inWord = WORD_CHARACTER.test(character) && (inWord || WORD_START.test(character));
      text += character;
      if (inWord) ended = text.length;
    }
  }
  return shown(text);
}

/** An owner as the words are counted by: a field's id, a part's place, kept, or the template. */
type OwnerKey = string;

const ownerKey = (owner: Omit<GlyphOwner, "page" | "from" | "to">): OwnerKey =>
  owner.field !== undefined
    ? `f:${owner.field}`
    : owner.part !== undefined
      ? `p:${owner.part}`
      : owner.kept !== undefined
        ? `k:${owner.kept}`
        : "t";

/** A locked owner: a part, or what the document keeps that no part counts. */
const lockedKey = (key: OwnerKey) => key.startsWith("p:") || key.startsWith("k:");

/**
 * Gives a running line's glyphs to the locked part of the source that sets it (item 13's hand
 * count, decision 0039): a header or a footer the template sets on every page, which the probe
 * reads where it first comes and no further, leaving its copies on later pages, and what the call
 * passes it that no text of the source spells, a date or a page's number, to the template's text.
 *
 * A running line is a stretch of a page's glyphs one after the other on one line that another page
 * sets at the same height, at least half the longer's glyphs the same character at the same place:
 * the copies of one line, the page's number in it changing from page to page. Where every glyph
 * of a running line's copies that has an owner has one and the same locked one, that part sets the
 * whole line on every page, as one call sets a running footer; else each copy's glyph the template
 * has takes the locked owner a copy's same glyph at the same place has, and nothing more. A line
 * none of the source sets stays the template's: its own running line is its own. A field's glyphs
 * are never given on: a field the template sets on every page is locked (`twice`) by the probe.
 */
export function ownRunningLines(pages: readonly (readonly Glyph[])[], owners: OwnerKey[][]): void {
  /** Each page's lines: stretches of its glyphs one after the other, each on one line. */
  const lines: { page: number; from: number; to: number; v: number; size: number }[] = [];
  pages.forEach((glyphs, page) => {
    let from = 0;
    for (let at = 1; at <= glyphs.length; at++) {
      const first = glyphs[from] as Glyph;
      const each = glyphs[at];
      if (
        each !== undefined &&
        Math.abs(each.v - first.v) <= LINE * Math.max(each.size, first.size, 1)
      )
        continue;
      if (at - from >= 2) lines.push({ page, from, to: at, v: first.v, size: first.size });
      from = at;
    }
  });
  /** Where each glyph of line `b` the same as one of line `a` at its place is, by `a`'s glyph. */
  const same = (a: (typeof lines)[number], b: (typeof lines)[number]) => {
    const near = SPACE * Math.max(a.size, b.size, 1);
    const pairs = new Map<number, number>();
    const theirs = pages[b.page] ?? [];
    for (let at = a.from; at < a.to; at++) {
      const glyph = pages[a.page]?.[at] as Glyph;
      for (let other = b.from; other < b.to; other++) {
        const each = theirs[other] as Glyph;
        if (each.text === glyph.text && Math.abs(each.h - glyph.h) <= near) {
          pairs.set(at, other);
          break;
        }
      }
    }
    return pairs;
  };
  // The copies of each running line, joined across the pages, and their glyphs' pairs.
  const group = lines.map((_, i) => i);
  const root = (i: number): number => {
    while (group[i] !== i) i = group[i] as number;
    return i;
  };
  const pairs: { a: number; b: number; glyphs: Map<number, number> }[] = [];
  lines.forEach((a, i) => {
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j] as (typeof lines)[number];
      if (b.page === a.page || Math.abs(b.v - a.v) > SPACE * Math.max(a.size, b.size, 1)) continue;
      const glyphs = same(a, b);
      if (2 * glyphs.size < Math.max(a.to - a.from, b.to - b.from)) continue;
      pairs.push({ a: i, b: j, glyphs });
      group[root(j)] = root(i);
    }
  });
  const groups = new Map<number, number[]>();
  lines.forEach((_, i) => {
    if (pairs.some((pair) => pair.a === i || pair.b === i))
      groups.set(root(i), [...(groups.get(root(i)) ?? []), i]);
  });
  for (const copies of groups.values()) {
    const keys = new Set<OwnerKey>();
    for (const i of copies) {
      const { page, from, to } = lines[i] as (typeof lines)[number];
      for (let at = from; at < to; at++) {
        const key = owners[page]?.[at] ?? "t";
        if (key !== "t") keys.add(key);
      }
    }
    const [only] = keys;
    if (keys.size === 1 && only !== undefined && lockedKey(only)) {
      for (const i of copies) {
        const { page, from, to } = lines[i] as (typeof lines)[number];
        const row = owners[page] ?? [];
        for (let at = from; at < to; at++) if (row[at] === "t") row[at] = only;
      }
      continue;
    }
    // Several owners: each glyph the template has takes a copy's same glyph's locked owner.
    for (const pair of pairs) {
      if (!copies.includes(pair.a)) continue;
      const a = lines[pair.a] as (typeof lines)[number];
      const b = lines[pair.b] as (typeof lines)[number];
      for (const [at, other] of pair.glyphs) {
        const mine = owners[a.page] ?? [];
        const theirs = owners[b.page] ?? [];
        const key = mine[at] ?? "t";
        const their = theirs[other] ?? "t";
        if (key === "t" && lockedKey(their)) mine[at] = their;
        else if (their === "t" && lockedKey(key)) theirs[other] = key;
      }
    }
  }
}

/**
 * The page's words, each set down to what sets most of its glyphs (`AssemblyChecks.owners`), the
 * first of them where two set as many: counted editable in place, editable in the side panel,
 * locked by reason, or the template's; and the locked parts that set any, in the page's order, each
 * by its first words. A running line a locked part sets is its on every page (`ownRunningLines`).
 * What the document keeps that no part counts is shown as a part of its own for each run of it.
 */
function countWords(
  assembled: {
    checks: AssemblyChecks;
    extras: readonly LockedPart[];
    document?: { resume: unknown };
  },
  reference: Pick<Reference, "pages">,
): { words: Report["words"]; locked: LockedShown[] } {
  const { checks, extras, document } = assembled;
  const pages = pageWords(reference, document === undefined ? undefined : writesHyphen(document));
  // The owner of each glyph, by its page and its place among the page's glyphs.
  const owners = pages.map((read) => new Array<OwnerKey>(read.texts.length).fill("t"));
  for (const run of checks.owners ?? []) {
    const row = owners[run.page];
    if (row === undefined) continue;
    const key = ownerKey(run);
    for (let at = Math.max(0, run.from); at < Math.min(run.to, row.length); at++) row[at] = key;
  }
  ownRunningLines(
    reference.pages.map((page) =>
      page.items.flatMap((item) => (item.kind === "glyph" ? [item] : [])),
    ),
    owners,
  );
  const modes = new Map(checks.all.map((field) => [field.field, field]));
  const words: Report["words"] = {
    editable: 0,
    panel: 0,
    locked: 0,
    byReason: {},
    body: 0,
    template: 0,
  };
  /**
   * Each locked part, in the order the page first shows it: its owner, its words, and where on the
   * page it first shows them, from its first word's first glyph to its last word's last there.
   */
  const parts = new Map<
    OwnerKey,
    { owner: OwnerKey; reason: LockReason; count: number; page: number; from: number; to: number }
  >();
  /** The key of the run of words kept with no part that the last word was in, if it was. */
  let keptRun: OwnerKey | undefined;
  let runs = 0;
  pages.forEach((read, page) => {
    const row = owners[page] ?? [];
    for (const word of read.words) {
      const tally = new Map<OwnerKey, number>();
      for (const at of word.glyphs) {
        const key = row[at] ?? "t";
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      let key: OwnerKey = "t";
      let most = 0;
      for (const [each, n] of tally)
        if (n > most) {
          key = each;
          most = n;
        }
      if (key === "t") {
        words.template++;
        keptRun = undefined;
        continue;
      }
      words.body++;
      if (key.startsWith("f:")) {
        if (modes.get(key.slice(2))?.mode === "raw") words.panel++;
        else words.editable++;
        keptRun = undefined;
        continue;
      }
      const part = key.startsWith("p:") ? extras[Number(key.slice(2))] : undefined;
      const reason: LockReason =
        part?.reason ?? (key.startsWith("k:") ? (key.slice(2) as LockReason) : "unmapped");
      words.locked++;
      words.byReason[reason] = (words.byReason[reason] ?? 0) + 1;
      // Words kept with no part are a part of their own for each run of them on the page.
      let named = key;
      if (key.startsWith("k:")) {
        if (keptRun === undefined || !keptRun.startsWith(key)) keptRun = `${key}#${runs++}`;
        named = keptRun;
      } else keptRun = undefined;
      const first = word.glyphs[0] ?? 0;
      const last = (word.glyphs.at(-1) ?? first) + 1;
      const entry = parts.get(named) ?? {
        owner: key,
        reason,
        count: 0,
        page,
        from: first,
        to: last,
      };
      entry.count++;
      if (entry.page === page) entry.to = Math.max(entry.to, last);
      parts.set(named, entry);
    }
  });
  const locked = [...parts.values()].map((part): LockedShown => {
    const read = pages[part.page];
    const row = owners[part.page] ?? [];
    // Every glyph of the part's where it first shows, its punctuation among them, as on the page.
    const glyphs: number[] = [];
    for (let at = part.from; at < part.to; at++) if (row[at] === part.owner) glyphs.push(at);
    // A locked section is a part of the section kind kept under no key of extras, as a section's
    // `before` and `after` are.
    const kept = part.owner.startsWith("p:") ? extras[Number(part.owner.slice(2))] : undefined;
    const section = kept?.kind === "section" && kept.key === undefined ? kept.node : undefined;
    return {
      words: read === undefined ? "" : firstWords(read, glyphs),
      count: part.count,
      reason: part.reason,
      why: LOCK_WHY[part.reason],
      ...(section === undefined ? {} : { section }),
    };
  });
  return { words, locked };
}

/**
 * The words as the assembly counted them in the source, for an assembly made before its owners
 * were read: its typeset fields', its raw fields' and its locked parts', the template's none.
 */
function sourceWords(checks: AssemblyChecks): Report["words"] {
  const byReason = { ...checks.words.locked };
  const locked = Object.values(byReason).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const panel = checks.all
    .filter((field) => field.mode === "raw")
    .reduce((sum, field) => sum + field.words, 0);
  const editable = checks.words.editable;
  return { editable, panel, locked, byReason, body: editable + panel + locked, template: 0 };
}

// What the report says.

/**
 * Why a part is locked, in plain words, never a command's name: the probe's reasons (decision
 * 0022), the assembly's (decision 0026) and the harness's.
 */
export const LOCK_WHY: Readonly<Record<LockReason, string>> = {
  raw: "it holds formatting this editor cannot read",
  breaks: "marking it for editing stops the template",
  vanished: "the template uses it where the page does not show it",
  twice: "the template sets it in two places",
  moved: "marking it for editing moves the page",
  misaligned: "the template changes how it is spelled on the page",
  case: "the template changes its letters' case in a way this editor cannot follow",
  split: "it runs across a page's end",
  untested: "the checks ran out of time before trying it",
  date: "its dates are written in a way this editor does not write",
  shape: "it is laid out in a way no field of this editor can hold",
  unmapped: "this editor does not know what part of a resume it is",
  differs: "set again by this editor, it does not come out as your original",
  text: "the template stops on some text typed there",
  fields: "this editor could not find it on the page",
  alignment: "the page does not show it as it is written",
};

/** The style controls as the report names them. */
const CONTROL_NAMES: Readonly<Record<string, string>> = {
  pageSize: "Page size",
  margins: "Margins",
  fontSize: "Font size",
  font: "Font",
  accent: "Accent colour",
  density: "Density",
};

/**
 * Why a control is not offered, in plain words, from the checks' reason (`DROPPED` and
 * `UNCHECKED` in `validate.ts`, read by how each begins, as `dropKind` reads them for the corpus's
 * table), never the reason's own words, which may name a value or quote TeX's log.
 */
function dropWords(why: string): string {
  if (why === "unchecked") return "the checks stopped before they could try it";
  if (why === "moves the original's page at the document's own value")
    return "it moves your original's page as it stands";
  if (why.startsWith("stops the compile at ")) return "one of its values stops the template";
  if (why === "sets the same page at every value") return "it changes nothing on the page";
  if (why.startsWith("sets another page than it asks at "))
    return "one of its values sets another page than it asks for";
  if (why === "the harness finds it does not work") return "it does not work in the checks";
  return "the checks could not prove it";
}

/** The kinds of unit as the report names them, plural. */
const UNIT_NAMES: Readonly<Record<string, string>> = {
  entry: "entries",
  bullet: "bullets",
  item: "list items",
  labelledItem: "labelled items",
  link: "links",
  "section.entries": "sections of entries",
  "section.list": "list sections",
  "section.labelled": "sections of labelled items",
  "section.paragraph": "paragraph sections",
};

/** Names, a comma between them and an "and" before the last. */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** `n` things, as the report counts them: "1 image", "2 images". */
const counted = (n: number, thing: string) => `${n} ${thing}${n === 1 ? "" : "s"}`;

/**
 * What the import left out, by kind (decision 0039): images, as the document names them, the
 * stand-ins' and the dropped; a bibliography the engine cannot build; each control the checks did
 * not prove, with why; and each file the intake or the XeTeX rewrite set aside, in their words.
 */
function droppedOf(
  checks: AssemblyChecks,
  reference: Pick<Reference, "bibliographyLeftOut" | "images">,
  inputs: ReportInputs,
): DroppedShown[] {
  const dropped: DroppedShown[] = [];
  const blank = [...(inputs.images?.replaced ?? []), ...reference.images].map((each) =>
    shown(each.name),
  );
  const out = (inputs.images?.dropped ?? []).map((each) => shown(each.name));
  if (blank.length > 0)
    dropped.push({
      kind: "images",
      text: `${counted(blank.length, "image")}, shown as blank space of ${blank.length === 1 ? "its" : "their"} size, since this editor's PDF carries none: ${listed([...new Set(blank)])}.`,
    });
  if (out.length > 0)
    dropped.push({
      kind: "images",
      text: `${counted(out.length, "image")} of the upload left out: ${listed([...new Set(out)])}.`,
    });
  if (reference.bibliographyLeftOut)
    dropped.push({
      kind: "bibliography",
      text: "The bibliography, which this editor cannot build, and which the upload holds no built copy of.",
    });
  for (const { control, why } of checks.controls.dropped) {
    const name = CONTROL_NAMES[control];
    if (name !== undefined)
      dropped.push({ kind: "control", text: `${name}: not offered, since ${dropWords(why)}.` });
  }
  for (const warning of inputs.warnings ?? [])
    if (/\bleft out\b/.test(warning)) dropped.push({ kind: "file", text: shown(warning) });
  return dropped;
}

/**
 * What else the report says: that no answer came for the template, which left everything as the
 * probe found it, in the naming client's words; that a font the page cannot draw was set in its
 * successor; and the kinds of unit the template can neither add nor remove.
 */
function notesOf(checks: AssemblyChecks, inputs: ReportInputs): string[] {
  const notes: string[] = [];
  const naming = inputs.naming;
  if (naming !== undefined && "failed" in naming)
    notes.push(
      `No answer came for the template, so its parts stay as your original sets them: ${shown(naming.failed)}`,
    );
  if ((checks.latinModern ?? []).length > 0)
    notes.push(
      "Its Computer Modern fonts are set in Latin Modern, their successor, which the page can draw.",
    );
  const fixed = (checks.decisions.fixed ?? []).flatMap((kind) => UNIT_NAMES[kind] ?? []);
  if (fixed.length > 0)
    notes.push(`The template takes no more and no fewer ${listed(fixed)} than your original has.`);
  return notes;
}

/** A rate as the report shows it: whole per cent, down, so that 89.9% never reads as the bar. */
export const percent = (rate: number) => `${Math.floor(rate * 100 + 1e-9)}%`;

/**
 * The report's first line: the rate, and for a partial import, why it is partial, the bar or the
 * page.
 */
export function summaryOf(report: Report): string {
  const share = `${percent(report.rate)} of your resume's words are editable on the page`;
  if (report.outcome === "succeeded") return `Imported: ${share}.`;
  if (!report.matched)
    return `Imported in part: ${share}, but the page this editor sets differs from your original's.`;
  return `Imported in part: ${share}, under the ${percent(SUCCESS_RATE)} this editor aims for.`;
}
