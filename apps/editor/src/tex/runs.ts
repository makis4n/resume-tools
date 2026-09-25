/**
 * Where the generator breaks a run of characters with no space in it, and the overlay's line
 * breaker with it (decision 0007).
 *
 * TeX sets a run of characters with nothing to break it as one word, and XeTeX builds one node of
 * such a run in a native font: a run of about 1,100 characters, a pasted address in a bullet, say,
 * overflows the WebAssembly engine's stack, and the compile stops ("This can't happen"), or the
 * engine throws, where pdfTeX sets the run as a line too long for the page. So the generator
 * writes a break opportunity that sets nothing, `\allowbreak`, after every `UNBROKEN_RUN`
 * characters of a run, well under where the engine fails, and TeX sets the run in pieces it may
 * break a line between; and the overlay breaks where TeX may, so its rows stay TeX's lines.
 */

import { INVISIBLE } from "./fields";

/**
 * The most characters the generator lets a run with no space in it hold before it writes a break
 * opportunity: a fifth of the length at which XeTeX's engine first failed on one, and longer than
 * any word a resume holds but an address.
 */
export const UNBROKEN_RUN = 200;

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

/**
 * Where a text needs a break opportunity: the UTF-16 offset of each character before which one
 * goes, that is, after every `UNBROKEN_RUN` characters of a run with no space in it. A character
 * that goes with the one before it (`JOINS`) and one the generator leaves out are not counted, and
 * no break goes before them. `carried` is how many characters of a run the text continues, as a
 * run of rich text continues the one before it; the count the text leaves is what a text after it
 * continues.
 */
export function runBreaks(text: string, carried = 0): { breaks: number[]; carried: number } {
  const breaks: number[] = [];
  let count = carried;
  let at = 0;
  for (const ch of text) {
    if (SPACE.test(ch)) count = 0;
    else if (!LEFT_OUT.test(ch) && !JOINS.test(ch)) {
      if (count === UNBROKEN_RUN) {
        breaks.push(at);
        count = 0;
      }
      count++;
    }
    at += ch.length;
  }
  return { breaks, carried: count };
}
