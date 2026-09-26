/**
 * Where the generator breaks a run of characters with no space in it, and the overlay's line
 * breaker with it (decision 0007).
 *
 * TeX sets a run of characters with nothing to break it as one word, and XeTeX builds one node of
 * such a run in a native font: a run of about 1,100 characters, a pasted address in a bullet, say,
 * overflows the WebAssembly engine's stack, and the compile stops ("This can't happen"), or the
 * engine throws, where pdfTeX sets the run as a line too long for the page; a run of 200 letters
 * that carry five accents each sets nothing at all. So the generator writes a break opportunity
 * that sets nothing, `\allowbreak`, wherever a run would pass `UNBROKEN_RUN` characters that set
 * a glyph, accents included, well under where the engine fails, and TeX sets the run in pieces it
 * may break a line between; and the overlay breaks where TeX may, so its rows stay TeX's lines.
 */

import { INVISIBLE } from "./fields";

/**
 * The most characters that set a glyph, accents included, the generator lets a run with no space
 * in it hold before it writes a break opportunity: a fifth of the length at which XeTeX's engine
 * first failed on one, and longer than any word a resume holds but an address.
 */
export const UNBROKEN_RUN = 200;

/**
 * The most characters that go with the one before them (`JOINS`) a letter keeps, as Unicode's
 * Stream-Safe Text Format allows (UAX #15): the generator leaves out the rest, since a break never
 * comes between a letter and its accents, and a letter with a thousand of them stops XeTeX.
 */
export const MAX_MARKS = 30;

/**
 * What begins a run again: what the generator writes as a space or as a no-break space, the line
 * breaks and every space separator, since TeX ends a word at either.
 */
const SPACE = /^[\t\n\r\u2028\u2029\p{Zs}]$/u;

/** What sets nothing and so counts for nothing: the characters the generator leaves out. */
const LEFT_OUT = new RegExp(`^(?:${INVISIBLE.source})$`, "u");

/**
 * What goes with the character before it, so that no break comes between the two: a combining
 * mark, and a Hangul vowel or final consonant, which composing joins to the jamo before it in one
 * syllable. So each piece of a text is composed as it is in the whole (`escapeText`).
 */
const JOINS = /^[\p{M}\u1160-\u11FF\uD7B0-\uD7FF]$/u;

/** Where a text's runs with no space are broken, and what of them is left out. */
export interface RunBreaks {
  /** The UTF-16 offset of each character a break opportunity goes before, in order. */
  breaks: number[];
  /**
   * The UTF-16 offset of each character past `MAX_MARKS` that goes with the one before it, which
   * the generator leaves out, and the overlay with it, in order.
   */
  surplus: number[];
}

/**
 * Where a text needs a break opportunity, and what it leaves out. A run with no space in it is
 * cut before a letter where the run's characters that set a glyph, since the last cut, would pass
 * `UNBROKEN_RUN` with the letter and those that go with it (`JOINS`), at most `MAX_MARKS` of them,
 * the rest being left out (`surplus`); a character the generator leaves out counts for nothing, and
 * no cut comes before it or before one that goes with the letter before it. A run of rich text
 * goes on from one run into the next, so rich text is read as its runs' texts joined.
 */
export function runBreaks(text: string): RunBreaks {
  const chars: { ch: string; at: number }[] = [];
  let offset = 0;
  for (const ch of text) {
    chars.push({ ch, at: offset });
    offset += ch.length;
  }
  const breaks: number[] = [];
  const surplus: number[] = [];
  // The characters that set a glyph since the last cut or space, and the ones that go with the
  // last letter kept so far.
  let count = 0;
  let marks = 0;
  chars.forEach(({ ch, at }, i) => {
    if (LEFT_OUT.test(ch)) return;
    if (SPACE.test(ch)) {
      count = 0;
      marks = 0;
    } else if (JOINS.test(ch)) {
      if (marks === MAX_MARKS) surplus.push(at);
      else {
        marks++;
        count++;
      }
    } else {
      // The letter and what goes with it, which no cut parts.
      let size = 1;
      for (let j = i + 1, kept = 0; j < chars.length && kept < MAX_MARKS; j++) {
        const next = chars[j]?.ch ?? "";
        if (LEFT_OUT.test(next)) continue;
        if (!JOINS.test(next)) break;
        kept++;
        size++;
      }
      if (count > 0 && count + size > UNBROKEN_RUN) {
        breaks.push(at);
        count = 0;
      }
      count++;
      marks = 0;
    }
  });
  return { breaks, surplus };
}

/**
 * The part of `cut` that falls in the characters from `from` to `to` of the text it was made for,
 * as offsets into those characters: a break at `from` is one before them, and one at `to` is the
 * next part's.
 */
export function runBreaksWithin(cut: RunBreaks, from: number, to: number): RunBreaks {
  const within = (offsets: readonly number[]) =>
    offsets.filter((at) => at >= from && at < to).map((at) => at - from);
  return { breaks: within(cut.breaks), surplus: within(cut.surplus) };
}
