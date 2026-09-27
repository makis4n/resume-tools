/**
 * Fields on a typeset page.
 *
 * The generated LaTeX wraps every render of an editable field in two markers, written
 * with `\special` as `rt:b:<id>` and `rt:e:<id>`. They pass through the engine untouched
 * and come out in the DVI at the positions where the field starts and ends. The first
 * copy of a field on the page is the field: every glyph that sits between its markers in
 * stream order belongs to it, and aligning those glyphs with the field's source text
 * gives each glyph its character offset. A glyph is a TeX font's character, one page item, or one
 * glyph of a run XeTeX set in a native font, which is one item for the whole run (decision 0014).
 */

import type { DviPage, PageItem } from "./dvi";
import { accented } from "./glyphs";

export interface FieldGlyph {
  /** Index of the glyph in the page's item list, or of the native run it is a glyph of. */
  item: number;
  /** The glyph's index in its native run's `glyphs`, when `item` is a native run. */
  glyph?: number;
  /**
   * The other page items that draw this character: the accent TeX's `\accent` set over the
   * letter `item` draws, which reads with it as one accented letter (`collectFields`).
   */
  items?: number[];
  /** The text this glyph stands for, e.g. "fi" for a ligature; undefined when unknown. */
  text: string | undefined;
  /**
   * What else the glyph stands for, when its font gives it several characters, as Source Sans
   * sets U+2019 and U+02BC with one glyph (decision 0014): a native font's glyph only. The aligner
   * takes any of them, and `text`, as the glyph's spelling.
   */
  alternatives?: readonly string[];
  /** Offset of the glyph's first character in the field's source text, once aligned. */
  offset: number;
  /** True for a hyphen TeX added at a line break, which has no source character. */
  inserted?: boolean;
  /**
   * True for glyph 0 of a native run, the font's `.notdef`, which XeTeX sets for a character its
   * font lacks: the page reads it as that character left out, as the generator leaves out one the
   * package's fonts lack (decision 0014), so it has no text, draws nothing, and is not unmatched.
   */
  dropped?: boolean;
}

export interface Field {
  id: string;
  glyphs: FieldGlyph[];
}

export const MARKER_BEGIN = "rt:b:";
export const MARKER_END = "rt:e:";

/**
 * What means nothing on a page, or what TeX would refuse: controls, format characters such as
 * zero-width joiners and U+FEFF, lone surrogates, which UTF-8 cannot encode, and the line and
 * paragraph separators. The generator leaves them out of the LaTeX and the aligner skips them in
 * a field's text, so the two agree on what sets no glyph.
 */
export const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/**
 * Text a page item stands for, or undefined for items that are not glyphs: for a native run, the
 * text of its glyph at index `glyph`, since each glyph of a run is a glyph of its own.
 */
export interface GlyphTextOf {
  (item: PageItem, glyph?: number): string | undefined;
  /**
   * The combining mark a glyph stands for when it is a spacing accent (its glyph name is in
   * `ACCENTS`), and undefined for any other item. Without it, no accent is paired with its letter.
   */
  accent?: (item: PageItem) => string | undefined;
  /**
   * What else a native run's glyph at index `glyph` stands for, past the text the call gives,
   * when its font gives it several characters; undefined or empty when it gives one.
   */
  alternatives?: (item: PageItem, glyph?: number) => readonly string[] | undefined;
}

/** A text of one letter, which an accent before it may go over. */
const LETTER = /^\p{L}$/u;

/**
 * Collect the glyphs of every marked field on a page, in stream order.
 *
 * The generator marks every render of a field, and the first copy in the page's stream order is
 * the field, the one the user edits. A render that never reaches the page, such as one in a PDF
 * string or one `\settowidth` only measures, leaves no markers, so a field whose first render is
 * one of those is found at the copy the page shows. A later begin marker for a field already
 * found opens a copy whose glyphs go to no field, so a link a header sets through both
 * `{{contacts}}` and `{{links}}` is found once, with the first copy's glyphs; the copy is opened
 * all the same, so that its end marker closes it and the nesting stays right.
 *
 * Markers are read case-insensitively and their ids lowercased. A template may set a field in
 * `\MakeUppercase`, which uppercases the markers' text along with the field's, and ids are
 * lowercase (decision 0006), so the id survives. Item 9 must read the paragraph special's id the
 * same way; its values are never uppercased, because `\rt@par` is protected and writes them when
 * it runs, after the case change.
 *
 * TeX's `\accent`, which OT1 sets every accented letter with and T1 the letters it has no glyph
 * for, puts the accent in the DVI first and the letter after it, as two glyphs. It centres the
 * accent over the letter (tex.web's `make_accent`): the accent moves right by half the letter's
 * width less its own, plus a little in a slanted font, and the letter goes back to where the
 * accent began. So a letter narrower than the accent starts after it, and a wider one before it,
 * by less than twice the accent's width for every accent and letter of every T1 and OT1 font the
 * page can draw (a dot over a W is the most, 1.83 widths in Avant Garde's oblique). A spacing
 * accent (`textOf.accent`) directly followed in the same field by a glyph whose text is a letter
 * and that starts within that span, from twice the accent's width before it to the end of its
 * advance, becomes one glyph whose text is the two composed (NFC), `é` for `\'e` and `í` for
 * `\'\i` (`accented`): the letter's item, with the accent's in `items`, so that a click on either
 * lands on the character. The position matters: OT1 sets `\textasciitilde` and `\textasciicircum`
 * as the same accent glyphs standing alone, and a letter after one of them starts where it ends,
 * so `~mara` still reads as typed; and the first letter of the next line, back at the left margin,
 * starts far before an accent that ended a line, unless the line held almost nothing else. An
 * accent with no letter over which it stands stays a glyph of its own. The accent may sit higher
 * or lower than the letter, in the box TeX shifts for a letter taller or shorter than the
 * x-height, so the test does not look at v. It needs the fonts' widths, so the page and the
 * validation harness both parse the DVI with them.
 *
 * A native run's glyphs are collected one by one, each with its index in the run and the text
 * `textOf` gives it, and what else it stands for (`textOf.alternatives`), so that each is aligned
 * with the text as a TeX font's glyph is. Native fonts set accented letters whole, so none of their
 * glyphs is paired with another. A run's glyph 0, the font's `.notdef`, is collected as a character
 * left out (`FieldGlyph.dropped`).
 */
export function collectFields(page: DviPage, textOf: GlyphTextOf): Map<string, Field> {
  const fields = new Map<string, Field>();
  // The copies open where the walk stands, the innermost last. A later copy of a field already
  // found has no field, so what it sets goes nowhere.
  const open: { id: string; field: Field | undefined }[] = [];
  // The combining mark of the accent each field's last glyph is, while it waits for a letter.
  const accents = new Map<Field, string>();
  page.items.forEach((item, index) => {
    if (item.kind === "special") {
      const begun = markerId(item.text, MARKER_BEGIN);
      const ended = begun === undefined ? markerId(item.text, MARKER_END) : undefined;
      if (begun !== undefined) {
        const field: Field | undefined = fields.has(begun) ? undefined : { id: begun, glyphs: [] };
        if (field) fields.set(begun, field);
        open.push({ id: begun, field });
      } else if (ended !== undefined) {
        for (let at = open.length - 1; at >= 0; at--) {
          if (open[at]?.id === ended) {
            open.splice(at, 1);
            break;
          }
        }
      }
      return;
    }
    if (item.kind !== "glyph" && item.kind !== "native") return;
    const field = open.at(-1)?.field;
    if (!field) return;
    if (item.kind === "native") {
      accents.delete(field);
      item.glyphs.forEach(({ id }, glyph) => {
        if (id === 0) {
          field.glyphs.push({ item: index, glyph, text: undefined, offset: -1, dropped: true });
          return;
        }
        const text = textOf(item, glyph);
        const alternatives = textOf.alternatives?.(item, glyph);
        field.glyphs.push({
          item: index,
          glyph,
          text,
          ...(alternatives?.length ? { alternatives } : {}),
          offset: -1,
        });
      });
      return;
    }
    const text = textOf(item);
    const mark = accents.get(field);
    accents.delete(field);
    const accent = field.glyphs.at(-1);
    const over = accent && page.items[accent.item];
    const under =
      over?.kind === "glyph" &&
      item.kind === "glyph" &&
      item.h >= over.h - 2 * over.width &&
      item.h < over.h + over.width;
    if (mark !== undefined && accent && under && text !== undefined && LETTER.test(text)) {
      const letter = { item: index, text: accented(text, mark), offset: -1 };
      field.glyphs[field.glyphs.length - 1] = { ...letter, items: [accent.item] };
      return;
    }
    field.glyphs.push({ item: index, text, offset: -1 });
    const own = textOf.accent?.(item);
    if (own !== undefined) accents.set(field, own);
  });
  return fields;
}

/**
 * The id a begin or end marker names, lowercased; undefined for any other special. `marker` is
 * `MARKER_BEGIN` or `MARKER_END`, and the marker is read whatever its case.
 */
export function markerId(text: string, marker: string): string | undefined {
  if (text.slice(0, marker.length).toLowerCase() !== marker) return undefined;
  return text.slice(marker.length).toLowerCase();
}

/**
 * The case a page sets a field in where it is not the text's own: capitals, as a class sets a title
 * through `\MakeUppercase`; small letters, through `\MakeLowercase`; or both, as a class that
 * capitalises each word's first letter sets it, which no one case shows (decision 0021).
 */
export type Fold = "upper" | "lower" | "mixed";

/** A case the aligner folds a text to, a character at a time (`alignField`). */
type Case = "upper" | "lower";

/** What aligning a field's glyphs with its text found. */
export interface Alignment {
  /** Glyphs that could not be matched to a character of the text. */
  unmatched: number;
  /**
   * Where the walk stands when the glyphs run out: the index in the text just past the last
   * glyph it matched. What the text holds from here on is what the page does not show, so the
   * validation harness checks that none of it would set a glyph, which finds a field a template
   * cuts short, as truncate.sty does, where every glyph the page shows still matches.
   */
  covered: number;
  /**
   * The case the page sets the field in, when some of its glyphs matched their characters only
   * once the text was folded (`alignField`): `upper` when no glyph has a small letter, as
   * `\MakeUppercase` leaves a title, a letter with no capital of its own counting as none, as ß,
   * whose capitals are SS and which a primitive `\uppercase` leaves among capitals; `lower` when
   * none has a capital; and `mixed` when they have both, as a class that capitalises each word's
   * first letter sets them. The overlay shows the field in the first two, and as typed in the
   * third (decision 0021). Undefined when every glyph matched as it stands.
   */
  folded?: Fold;
}

/**
 * Where a glyph matches the text: from `at` to `end`, with the glyphs after it that the same
 * character takes (`glyphs`, one for most, counting a hyphen TeX inserted among them, which
 * `inserted` lists by index), and whether it matched only once the text was folded (`folded`).
 */
interface Match {
  at: number;
  end: number;
  glyphs: number;
  inserted?: readonly number[];
  folded?: boolean;
}

/**
 * Give each glyph its character offset in the field's source text.
 *
 * TeX drops spaces (they become moves, not glyphs), turns some character pairs into
 * one ligature glyph, and may add a hyphen at a line break; and a field's text holds
 * characters that set no glyph at all, which the generator or TeX left out. The
 * alignment walks the text and the glyphs together. Before each glyph it skips
 * whitespace and the invisible characters. A glyph matches any spelling of its text or
 * of what else it stands for (`FieldGlyph.alternatives`), or an accented letter whose base
 * one is, set without its accents (`accentedAt`); and failing both, the text in capitals, or
 * then in small letters, as a template that sets a field through `\MakeUppercase` or
 * `\MakeLowercase` shows it (`Folding`, decision 0021): a glyph É matches é, and two glyphs S
 * the one ß whose capitals they are, each with ß's offset, as does a hyphen TeX inserted between
 * them. A glyph tries folding at a place only once its spellings as they stand fail there, and
 * at most once. A glyph that does not match there is tried past each character that may set no
 * glyph where it stands, such as an emoji or a letter of a script the fonts lack; an unmatched
 * hyphen is a break TeX inserted, which is U+002D's glyph, the font's `\hyphenchar`, so a glyph
 * that stands for U+2010 or U+2011 and not for it is not one; and a glyph a few code units on
 * resynchronises the walk, as it stands or folded. A native font's `.notdef`
 * (`FieldGlyph.dropped`) stands where the walk is and matches nothing. Returns the number of
 * glyphs that could not be matched, how much of the text the glyphs account for, and the case
 * the page sets the field in when it folded it (`Alignment.folded`).
 *
 * A run of such characters is read once, however many glyphs fail to match in it: a
 * glyph whose spellings all begin with printable ASCII matches no character of the run as it
 * stands, so it can match only at the run's end, or at a letter whose base, capital or small
 * letter begins with printable ASCII, as é's base is e and ß's capitals are SS, and of those the
 * walk tries the first; only a glyph with a spelling outside ASCII, such as an en dash, walks
 * the run a character at a time. Folding adds no more than a bound to each place a glyph tries:
 * each character's folded form is read once for the field, and the glyphs that spell one
 * character's form between them stop with it, so a place costs at most as many glyphs as that form
 * has code units, and the hyphens between them, whatever the glyphs after them.
 */
export function alignField(field: Field, text: string): Alignment {
  const { glyphs } = field;
  const folding = new Folding(text, glyphs);
  let pos = 0;
  let unmatched = 0;
  // Whether a glyph matched only once the text was folded to a case.
  let folded = false;
  // The end of the run of characters that may set no glyph from `pos` on: the first index at or
  // after it whose character is printable ASCII, or the text's end. Every character before it
  // sets no glyph, so it holds until `pos` passes it and is recomputed only then.
  let runEnd = -1;
  // The first index at or after `pos`, and before `runEnd`, whose letter a spelling in printable
  // ASCII may match (`basedOnGlyph`), or `runEnd` when there is none; recomputed, as `runEnd` is,
  // only when `pos` passes it, so each character is looked at once.
  let based = -1;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i] as FieldGlyph;
    while (pos < text.length && SKIPPED.test(charAt(text, pos))) pos += charAt(text, pos).length;
    if (glyph.dropped) {
      // A character the font lacks, which the next glyph skips as one that may set no glyph.
      glyph.offset = pos;
      continue;
    }
    const g = glyph.text;
    if (g === undefined) {
      glyph.offset = pos;
      unmatched++;
      continue;
    }
    const candidates = spellingsOfGlyph(glyph);
    const matchAt = (at: number): Match | undefined => {
      const exact =
        candidates.find((c) => text.startsWith(c, at)) ?? accentedAt(text, at, candidates);
      return exact === undefined
        ? folding.matchAt(i, at)
        : { at, end: at + exact.length, glyphs: 1 };
    };
    // The spellings are tried where the walk stands first, so "–" still matches the "--"
    // glyph, and only then past the characters that may set no glyph.
    let match: Match | undefined = matchAt(pos);
    if (match === undefined) {
      if (runEnd < pos) runEnd = endOfRun(text, pos);
      if (candidates.every(beginsWithGlyph)) {
        // No character of the run is a spelling's first as it stands, so only its end can match,
        // or a letter of it decomposed or folded, of which the first is tried.
        if (based < pos) based = firstBased(text, pos, runEnd);
        if (based > pos && based < runEnd) match = matchAt(based);
        match ??= matchAt(runEnd);
      } else {
        // A spelling outside ASCII, such as "–" or "’", may match anywhere in the run, which
        // is walked a code point at a time.
        let at = pos;
        while (match === undefined && at < runEnd) {
          at += charAt(text, at).length;
          match = matchAt(at);
        }
      }
    }
    if (match === undefined && g === "-") {
      // A hyphen TeX inserted at a line break: it belongs to the character before it. A native
      // glyph that stands for U+2010 or U+2011 as well reads as U+002D first; one that does not
      // stand for U+002D is not the font's \hyphenchar, and reads as one of the others.
      glyph.offset = Math.max(0, pos - 1);
      glyph.inserted = true;
      continue;
    }
    // Try to resynchronise a little further on, on the glyph's own texts; otherwise count it as
    // unmatched.
    const own = glyph.alternatives === undefined ? [g] : [g, ...glyph.alternatives];
    for (let k = 1; match === undefined && k <= 3; k++) {
      const at = pos + k;
      const found = own.find((each) => text.startsWith(each, at));
      match =
        found === undefined ? folding.matchAt(i, at) : { at, end: at + found.length, glyphs: 1 };
    }
    if (match === undefined) {
      glyph.offset = pos;
      unmatched++;
      continue;
    }
    // A letter whose capitals are several takes as many glyphs, each at the letter's offset, and a
    // hyphen TeX inserted among them is the letter's too.
    for (let k = 0; k < match.glyphs; k++) (glyphs[i + k] as FieldGlyph).offset = match.at;
    for (const k of match.inserted ?? []) (glyphs[k] as FieldGlyph).inserted = true;
    folded ||= match.folded === true;
    pos = match.end;
    i += match.glyphs - 1;
  }
  return { unmatched, covered: pos, folded: folded ? caseOfGlyphs(glyphs) : undefined };
}

/** Every spelling a glyph may have in a field's text: its text's, and what else it stands for. */
function spellingsOfGlyph(glyph: FieldGlyph): readonly string[] {
  const g = glyph.text;
  if (g === undefined) return [];
  if (glyph.alternatives === undefined) return spellingsOf(g);
  return [...new Set([g, ...glyph.alternatives].flatMap(spellingsOf))];
}

/** A character of a field's text in a case, as `Folding` reads it. */
interface Form {
  /** The character in the case, as `toUpperCase` or `toLowerCase` folds it alone, decomposed. */
  form: string;
  /** Whether the case changes the character: it does not change one already in it, or with none. */
  changed: boolean;
  /** The character's length in the text, in code units: two for a surrogate pair, else one. */
  length: number;
}

/**
 * A field's text folded to capitals and to small letters for `alignField` (decision 0021), a
 * character at a time, as `toUpperCase` and `toLowerCase` fold it, both sides compared decomposed
 * (NFD). What folding needs is read once for the field, however many glyphs try it: each
 * character's form in each case (`Form`), and each glyph's spellings, decomposed, with ς taken for
 * σ in small letters, since Σ is ς at a word's end, which a character alone does not say. It keeps,
 * for each place in the text, the glyph that last tried folding there, so that no glyph tries a
 * place twice: the walk may come back to one, as to a run's end that is where it stands, and
 * folding failed there the first time.
 */
class Folding {
  private readonly text: string;
  private readonly glyphs: readonly FieldGlyph[];
  private readonly forms: Record<Case, (Form | undefined)[] | undefined> = {
    upper: undefined,
    lower: undefined,
  };
  /**
   * The spellings `spelled` has read in each case: by a glyph's text, which most glyphs of a field
   * share, and by its index for a glyph that stands for other characters as well, which is rare.
   */
  private readonly spellings: Record<Case, Map<string | number, readonly string[]>> = {
    upper: new Map(),
    lower: new Map(),
  };
  /** One more than the index of the glyph that last tried folding at each place of the text. */
  private tried: Int32Array | undefined;

  constructor(text: string, glyphs: readonly FieldGlyph[]) {
    this.text = text;
    this.glyphs = glyphs;
  }

  /**
   * Where the glyphs from `first` on match the text at `at` in capitals, or failing that in small
   * letters (`foldedAt`); undefined as well where glyph `first` tried folding before, since it
   * failed there.
   */
  matchAt(first: number, at: number): Match | undefined {
    if (at >= this.text.length) return undefined;
    this.tried ??= new Int32Array(this.text.length);
    if (this.tried[at] === first + 1) return undefined;
    this.tried[at] = first + 1;
    return this.foldedAt(first, at, "upper") ?? this.foldedAt(first, at, "lower");
  }

  /**
   * Where the glyphs from `first` on match the text at `at` once it is folded to `fold`: a glyph
   * for each character, as É for é; one for several, as a ligature is, `fl` for fL in small
   * letters; a letter set without the accents its folded form has, as ǰ's capital is J and a
   * caron, and İ's small letter i and a dot; or several glyphs for the one character at `at`, as a
   * letter's capitals may be (`chain`). Only where the fold changes a character the glyph spells,
   * since a text already in the case matched as it stands, or not at all; and a glyph that ends
   * inside a character after the first ends there only before accents, since the glyphs after it
   * would go on with that character from inside another's.
   */
  private foldedAt(first: number, at: number, fold: Case): Match | undefined {
    const { text } = this;
    for (const spelled of this.spelled(first, fold)) {
      // The characters the spelling takes whole, from `at` to `next`, and the one it stops inside
      // when it does, whose form it takes `into` code units of.
      let next = at;
      let used = 0;
      let changed = false;
      let inside: Form | undefined;
      while (used < spelled.length && next < text.length) {
        const char = this.formAt(next, fold);
        changed ||= char.changed;
        if (!spelled.startsWith(char.form, used)) {
          if (char.form.startsWith(spelled.slice(used))) inside = char;
          break;
        }
        used += char.form.length;
        next += char.length;
      }
      if (!changed) continue;
      if (inside === undefined) {
        if (used === spelled.length) return { at, end: next, glyphs: 1, folded: true };
        continue;
      }
      const into = spelled.length - used;
      const chained =
        next === at
          ? this.chain(first, at, inside, into, fold)
          : ACCENTS.test(inside.form.slice(into))
            ? { at, end: next + inside.length, glyphs: 1, folded: true }
            : undefined;
      if (chained !== undefined) return chained;
    }
    return undefined;
  }

  /**
   * The glyphs from `first` on spelling the one character at `at` between them, as two glyphs S
   * spell ß's capitals SS, and F and I the ligature ﬁ's, glyph `first` having spelled `into` code
   * units of its form (`inside`): each glyph after it takes the form up where the one before
   * stopped, and a hyphen TeX inserted between two of them, as it breaks MASSE between the S, is
   * skipped as inserted. The chain ends with the character: a glyph that would go past it, into the
   * next character, does not go on with it, so no chain is longer than one character's form. It
   * is all or nothing, but for accents of the form it leaves out at its end, as a letter set
   * without its accent leaves them out; and every glyph of it takes the character's offset.
   */
  private chain(
    first: number,
    at: number,
    inside: Form,
    into: number,
    fold: Case,
  ): Match | undefined {
    const { glyphs } = this;
    const { form } = inside;
    const end = at + inside.length;
    const inserted: number[] = [];
    let done = into;
    let taken: Match = { at, end, glyphs: 1, folded: true };
    let stop = ACCENTS.test(form.slice(done)) ? taken : undefined;
    // The spelling of glyph `j` that goes on with the form from where the chain stands, if any.
    const goesOn = (j: number) => this.spelled(j, fold).find((each) => form.startsWith(each, done));
    while (done < form.length) {
      let j = first + taken.glyphs;
      let spelled = goesOn(j);
      if (spelled === undefined && glyphs[j]?.text === "-") {
        spelled = goesOn(j + 1);
        if (spelled !== undefined) {
          inserted.push(j);
          j += 1;
        }
      }
      if (spelled === undefined) break;
      done += spelled.length;
      taken = { at, end, glyphs: j - first + 1, folded: true };
      if (inserted.length > 0) taken.inserted = [...inserted];
      if (done === form.length) return taken;
      stop = ACCENTS.test(form.slice(done)) ? taken : undefined;
    }
    return stop;
  }

  /** The character at `at` in `fold` (`Form`), read once for the field. */
  private formAt(at: number, fold: Case): Form {
    let forms = this.forms[fold];
    if (forms === undefined) {
      forms = new Array<Form | undefined>(this.text.length);
      this.forms[fold] = forms;
    }
    let read = forms[at];
    if (read === undefined) {
      const char = charAt(this.text, at);
      const cased = caseOf(char, fold);
      read = { form: cased.normalize("NFD"), changed: cased !== char, length: char.length };
      forms[at] = read;
    }
    return read;
  }

  /**
   * Glyph `j`'s spellings in `fold` (`spellingsOfGlyph`), decomposed, with ς taken for σ in small
   * letters, read once for the field for each text; none for a glyph left out or past the last.
   */
  private spelled(j: number, fold: Case): readonly string[] {
    const glyph = this.glyphs[j];
    if (glyph === undefined || glyph.dropped || glyph.text === undefined) return [];
    const key = glyph.alternatives === undefined ? glyph.text : j;
    const known = this.spellings[fold].get(key);
    if (known !== undefined) return known;
    const spellings = spellingsOfGlyph(glyph).map((spelling) =>
      (fold === "lower" ? spelling.replaceAll("\u{3c2}", "\u{3c3}") : spelling).normalize("NFD"),
    );
    const read = [...new Set(spellings)].filter((spelling) => spelling !== "");
    this.spellings[fold].set(key, read);
    return read;
  }
}

/** A character in capitals or small letters, as `alignField` folds a text a character at a time. */
const caseOf = (char: string, fold: Case) =>
  fold === "upper" ? char.toUpperCase() : char.toLowerCase();

/**
 * The case of a field's glyphs, once some matched only folded: capitals when none of them has a
 * small letter, small letters when none has a capital, and mixed when they have both. A letter
 * whose capital is not one character, as ß's is SS, counts as no small letter: a primitive
 * `\uppercase`, as XeTeX may set a title through, leaves it among capitals.
 */
function caseOfGlyphs(glyphs: readonly FieldGlyph[]): Fold {
  let capital = false;
  let small = false;
  for (const { text } of glyphs) {
    if (text === undefined) continue;
    capital ||= text !== text.toLowerCase();
    small ||= hasSmallLetter(text);
  }
  if (!small) return "upper";
  return capital ? "mixed" : "lower";
}

/** Whether a text holds a small letter whose capital is one character, as a's is and ß's is not. */
function hasSmallLetter(text: string): boolean {
  for (const char of text) {
    const capital = char.toUpperCase();
    if (capital !== char && [...capital].length === 1) return true;
  }
  return false;
}

/**
 * The accented letter at `at` whose canonical decomposition is one of `spellings` and accents
 * after it, when there is one: a letter set without the accents its font lacks, as the generator
 * sets ǎ as a where a XeTeX template's fonts have neither ǎ nor the caron, and pdfTeX's LaTeX the
 * base of a letter it has no definition for (`escape.ts`).
 */
function accentedAt(text: string, at: number, spellings: readonly string[]): string | undefined {
  const char = charAt(text, at);
  if (char.length === 0 || char < "\u{80}") return undefined;
  const decomposed = char.normalize("NFD");
  const base = spellings.find((spelling) => spelling !== "" && decomposed.startsWith(spelling));
  if (base === undefined || base.length === decomposed.length) return undefined;
  return ACCENTS.test(decomposed.slice(base.length)) ? char : undefined;
}

/** Combining marks and nothing else, as an accented letter's decomposition holds after its base. */
const ACCENTS = /^\p{M}+$/u;

/** Give each glyph its character offset, as `alignField` does, and count those it cannot place. */
export function alignGlyphs(field: Field, text: string): number {
  return alignField(field, text).unmatched;
}

/** What the walk skips before every glyph: whitespace, which TeX sets as glue, and INVISIBLE. */
const SKIPPED = new RegExp(`\\s|${INVISIBLE.source}`, "u");

/** The code point at `at`, as a string of one or two code units. */
const charAt = (text: string, at: number) => String.fromCodePoint(text.codePointAt(at) ?? 0);

/**
 * Whether a character may set no glyph where it stands: what the walk skips, and anything
 * outside ASCII, which pdfTeX drops when LaTeX has no definition for it or the encoding no glyph.
 */
const setsNoGlyph = (char: string) => (char.codePointAt(0) ?? 0) > 0x7f || SKIPPED.test(char);

/** Whether a spelling begins with a character that sets a glyph: printable ASCII. */
const beginsWithGlyph = (spelling: string) => !setsNoGlyph(charAt(spelling, 0));

/** The first index at or after `from` whose character sets a glyph, or the text's end. */
function endOfRun(text: string, from: number): number {
  let at = from;
  while (at < text.length && setsNoGlyph(charAt(text, at))) at += charAt(text, at).length;
  return at;
}

/**
 * Whether a spelling that begins with printable ASCII may match a character that does not: one
 * whose base, capital or small letter does, decomposed, as é's base is e, ı's capital I and ß's
 * capitals SS.
 */
function basedOnGlyph(char: string): boolean {
  if (beginsWithGlyph(char.normalize("NFD"))) return true;
  const upper = caseOf(char, "upper");
  const lower = caseOf(char, "lower");
  return (
    (upper !== char && beginsWithGlyph(upper.normalize("NFD"))) ||
    (lower !== char && beginsWithGlyph(lower.normalize("NFD")))
  );
}

/** The first index from `from` to `to` whose character is `basedOnGlyph`, or `to`. */
function firstBased(text: string, from: number, to: number): number {
  let at = from;
  while (at < to && !basedOnGlyph(charAt(text, at))) at += charAt(text, at).length;
  return Math.min(at, to);
}

/**
 * The spellings a glyph's text may have in a field's text: a ligature's alternatives, or the text
 * itself and, for a composed letter such as the `é` an accent and its letter make, the letter
 * decomposed, as a model holds a letter typed with a combining mark.
 */
function spellingsOf(text: string): readonly string[] {
  const alternatives = LIGATURE_ALTERNATIVES.get(text);
  if (alternatives) return alternatives;
  const decomposed = text.normalize("NFD");
  return decomposed === text ? [text] : [text, decomposed];
}

/**
 * Source spellings that produce a given glyph, the plain form first. A map, since it is looked up
 * by a glyph's text, which may be any word a glyph name spells, `constructor` among them.
 *
 * The first entries are a TeX font's ligatures and quotes, named as Computer Modern names them,
 * and the characters T1 and TS1 set from more than one. The rest are the characters XeTeX's
 * `tex-text` mapping (`tex-text.map`), which a XeTeX template's text fonts take (decision 0014),
 * makes of what a text spells as TeX would, the low double quote among the first: a native font's
 * glyph reads as the character its character map gives it, `–` for the `--` it was set from.
 */
const LIGATURE_ALTERNATIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ["--", ["--", "–"]],
  ["---", ["---", "—"]],
  ["``", ["``", "“", '"']],
  ["''", ["''", "”", '"']],
  ["'", ["'", "’"]],
  ["`", ["`", "‘"]],
  // T1's fonts set two commas as one glyph, the low double quote, which they name quotedblbase.
  ["\u{201e}", ["\u{201e}", ",,"]],
  // T1 sets Đ (`\DJ`) with the glyph it sets Ð (`\DH`) with, at 208, which its fonts name Eth.
  ["\u{d0}", ["\u{d0}", "\u{110}"]],
  // LaTeX's UTF-8 input sets TS1's angle brackets from three code points each (ts1enc.dfu): the
  // mathematical ones, the CJK ones, and the deprecated ones, which NFC makes the CJK ones.
  ["\u{27e8}", ["\u{27e8}", "\u{3008}", "\u{2329}"]],
  ["\u{27e9}", ["\u{27e9}", "\u{3009}", "\u{232a}"]],
  // What XeTeX's tex-text mapping sets for what a text spells as TeX would; its low double quote
  // is T1's, above.
  ["–", ["–", "--"]],
  ["—", ["—", "---"]],
  ["’", ["’", "'"]],
  ["‘", ["‘", "`"]],
  ["”", ["”", "''", '"']],
  ["“", ["“", "``"]],
  ["¡", ["¡", "!`"]],
  ["¿", ["¿", "?`"]],
  ["«", ["«", "<<"]],
  ["»", ["»", ">>"]],
]);
