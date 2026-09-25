/**
 * The TeX fonts of a text font's family, by name: the font a variant of it, bold or italic, is set
 * in, and the companion that sets its symbols, as the naming schemes of the families templates set
 * text in spell them.
 *
 * The page names only the fonts it sets glyphs in, and a rich field's editor needs the others too
 * (item 10): the upright font outside a field set wholly in italic, whose slant decides LaTeX's
 * italic corrections, the bold font of a run that is only a space, and each variant's own symbols
 * (`€`, `°`), which LaTeX takes from the TS1 font of the variant's weight and shape. Where the page
 * sets no glyph of a font, the paragraph special does not name it either, so its name is made from
 * the names the page gives, and the tree says whether such a font exists (`FontLibrary.load`).
 *
 * Three schemes are read, each variant named at the cut its family's font definition file picks
 * for the size the page sets the field at, as LaTeX picks it when `\bfseries` or `\itshape` asks
 * for the font: the source's own cut is right only at the sizes they share, and Latin Modern cuts
 * its bold italic only at 10, so a field set in bold italic alone says nothing of the others'.
 * Latin Modern's names are `<encoding>-lm<variant><cut>`: `ec-lmr9`, `ec-lmbx9`, `ec-lmri9` and
 * `ec-lmbxi10` for its roman, cut at `t1lmr.fd`'s ranges, and `ec-lmss9`, `ec-lmssbx10`,
 * `ec-lmsso9` and `ec-lmssbo10` for its sans, at `t1lmss.fd`'s, with `ts1-` for their symbols.
 * Karl Berry's fontname scheme, which psnfss's PostScript families follow in T1, has one scalable
 * cut: a family's three letters, a weight (`r`, `b`), `i` or `o` for italic or oblique, and `8t`,
 * with `8c` for its symbols, as `pplr8t`, `pplbi8t`, `phvro8t` and `pplr8c`. And Computer
 * Modern's, `cmr9`, `cmbx9`, `cmti9` and `cmbxti10`, lists sizes in `ot1cmr.fd`, and LaTeX sets
 * a size it does not list at the nearest it does. A variant is always named as a text font, never
 * as a companion, whichever the name it is made from is. Any other name gives nothing, and the
 * editor measures with the fonts it has.
 */

/** Which of a family's fonts a rich run is set in, as bold and italic choose it (`rich.ts`). */
export type FontVariant = "regular" | "bold" | "italic" | "boldItalic";

/**
 * A variant's cuts as a font definition file gives them in ranges, `<lower-upper>`: each cut and
 * the size its range ends before, in order from the smallest, so that a size takes the first whose
 * end is above it, as LaTeX's `\check@range` does, the lower bound in and the upper one out. The
 * last range goes on for ever.
 */
type Ranges = readonly (readonly [end: number, cut: string])[];

/** One cut for every size. */
const ONLY_10: Ranges = [[Number.POSITIVE_INFINITY, "10"]];

/** `t1lmss.fd`'s upright and oblique sans. */
const LM_SANS: Ranges = [
  [8.5, "8"],
  [9.5, "9"],
  [11, "10"],
  [15.5, "12"],
  [Number.POSITIVE_INFINITY, "17"],
];

/** Latin Modern's roman (`t1lmr.fd`) and sans (`t1lmss.fd`): each variant's letters and cuts. */
const LATIN_MODERN: Readonly<
  Record<"roman" | "sans", Record<FontVariant, { letters: string; cuts: Ranges }>>
> = {
  roman: {
    regular: {
      letters: "r",
      cuts: [
        [5.5, "5"],
        [6.5, "6"],
        [7.5, "7"],
        [8.5, "8"],
        [9.5, "9"],
        [11, "10"],
        [15, "12"],
        [Number.POSITIVE_INFINITY, "17"],
      ],
    },
    bold: {
      letters: "bx",
      cuts: [
        [5.5, "5"],
        [6.5, "6"],
        [7.5, "7"],
        [8.5, "8"],
        [9.5, "9"],
        [11, "10"],
        [Number.POSITIVE_INFINITY, "12"],
      ],
    },
    italic: {
      letters: "ri",
      cuts: [
        [7.5, "7"],
        [8.5, "8"],
        [9.5, "9"],
        [11, "10"],
        [Number.POSITIVE_INFINITY, "12"],
      ],
    },
    boldItalic: { letters: "bxi", cuts: ONLY_10 },
  },
  sans: {
    regular: { letters: "ss", cuts: LM_SANS },
    bold: { letters: "ssbx", cuts: ONLY_10 },
    italic: { letters: "sso", cuts: LM_SANS },
    boldItalic: { letters: "ssbo", cuts: ONLY_10 },
  },
};

/**
 * A variant's cuts as a font definition file lists them by size, `<size>`: each size it lists and
 * that size's cut, in the file's order.
 */
type Sizes = readonly (readonly [size: number, cut: string])[];

/** The sizes `ot1cmr.fd` lists past 9, which every variant but the bold italic cuts alike. */
const CM_LARGE = [10, 10.95, 12, 14.4, 17.28, 20.74, 24.88] as const;

/** Computer Modern's roman in OT1 (`ot1cmr.fd`): each variant's letters and listed sizes. */
const COMPUTER_MODERN: Readonly<Record<FontVariant, { letters: string; sizes: Sizes }>> = {
  regular: {
    letters: "r",
    sizes: [
      ...([5, 6, 7, 8, 9, 10, 12] as const).map((size) => [size, String(size)] as const),
      [10.95, "10"],
      [14.4, "12"],
      ...([17.28, 20.74, 24.88] as const).map((size) => [size, "17"] as const),
    ],
  },
  bold: {
    letters: "bx",
    sizes: [
      ...([5, 6, 7, 8, 9] as const).map((size) => [size, String(size)] as const),
      ...CM_LARGE.map((size) => [size, size < 12 ? "10" : "12"] as const),
    ],
  },
  italic: {
    letters: "ti",
    sizes: [
      ...([5, 6, 7] as const).map((size) => [size, "7"] as const),
      [8, "8"],
      [9, "9"],
      ...CM_LARGE.map((size) => [size, size < 12 ? "10" : "12"] as const),
    ],
  },
  boldItalic: {
    letters: "bxti",
    sizes: ([5, 6, 7, 8, 9, ...CM_LARGE] as const).map((size) => [size, "10"] as const),
  },
};

/** A size in scaled points, as TeX compares sizes, so that a bound is exactly where it is. */
const sp = (points: number) => Math.round(points * 65536);

/** The cut a size takes in ranges: the first whose end is above it. */
function inRange(cuts: Ranges, size: number): string {
  return (cuts.find(([end]) => sp(size) < sp(end)) ?? cuts[cuts.length - 1])?.[1] ?? "";
}

/**
 * The cut a size takes among listed sizes: its own, or the nearest listed, the first of two as
 * near, as LaTeX's `\try@size@substitution` finds it.
 */
function nearest(sizes: Sizes, size: number): string {
  let best: readonly [number, string] | undefined;
  for (const listed of sizes)
    if (best === undefined || Math.abs(sp(listed[0]) - sp(size)) < Math.abs(sp(best[0]) - sp(size)))
      best = listed;
  return best?.[1] ?? "";
}

/** A Latin Modern font's name: its encoding, sans or not, series, shape and design size. */
const LM = /^(ec|ts1)-lm(ss)?(r|bx|b)?([io])?(\d+)$/;

/** A fontname-scheme name in T1 or TS1: family, weight, shape, encoding, and `n` for narrow. */
const BERRY = /^([a-z]{3})([a-z])([io]?)(8t|8c)(n?)$/;

/** A Computer Modern roman name in OT1. */
const CM = /^cm(r|bx|ti|bxti)(\d+)$/;

/**
 * The names the text font of `variant` may have in the family of the font `name`, at the size
 * `size` in TeX points that the page sets the field at, the likeliest first; none when the name
 * follows none of the schemes above. The tree says which exists.
 */
export function variantFontNames(name: string, variant: FontVariant, size: number): string[] {
  const lm = LM.exec(name);
  if (lm) {
    const { letters, cuts } = LATIN_MODERN[lm[2] ? "sans" : "roman"][variant];
    return [`ec-lm${letters}${inRange(cuts, size)}`];
  }
  const berry = BERRY.exec(name);
  if (berry) {
    const [, family, , shape, , narrow] = berry;
    const weight = variant === "bold" || variant === "boldItalic" ? "b" : "r";
    const slanted = variant === "italic" || variant === "boldItalic";
    const shapes = !slanted ? [""] : shape ? [shape, shape === "i" ? "o" : "i"] : ["i", "o"];
    return shapes.map((each) => `${family}${weight}${each}8t${narrow}`);
  }
  if (CM.test(name)) {
    const { letters, sizes } = COMPUTER_MODERN[variant];
    return [`cm${letters}${nearest(sizes, size)}`];
  }
  return [];
}

/**
 * The companion of a text font: the TS1 font of its family, weight, shape and design size, which
 * LaTeX sets the symbols T1 lacks in, such as `€` and `°`: `ts1-lmbx10` for `ec-lmbx10`, `pplb8c`
 * for `pplb8t`. Undefined for a name no scheme above gives a companion.
 */
export function companionName(name: string): string | undefined {
  const lm = LM.exec(name);
  if (lm?.[1] === "ec") return `ts1-${name.slice("ec-".length)}`;
  const berry = BERRY.exec(name);
  if (berry?.[4] === "8t") {
    const [, family, weight, shape, , narrow] = berry;
    return `${family}${weight}${shape}8c${narrow}`;
  }
  return undefined;
}
