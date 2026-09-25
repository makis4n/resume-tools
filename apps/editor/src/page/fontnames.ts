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
 * Three schemes are read. Latin Modern's, `<encoding>-lm<variant><design size>`: `ec-lmr10`,
 * `ec-lmbx10`, `ec-lmri10` and `ec-lmbxi10` for its roman, `ec-lmss10`, `ec-lmssbx10`,
 * `ec-lmsso10` and `ec-lmssbo10` for its sans, and `ts1-` for their symbols; a variant cut at fewer
 * design sizes, such as the bold italic, only at 10, is tried at 10 when its own size is not
 * there. Karl Berry's fontname scheme, which psnfss's PostScript families follow in T1: a family's
 * three letters, a weight (`r`, `b`), `i` or `o` for italic or oblique, and `8t`, with `8c` for its
 * symbols, as `pplr8t`, `pplbi8t`, `phvro8t` and `pplr8c`. And Computer Modern's, `cmr10`, `cmbx10`,
 * `cmti10` and `cmbxti10`, which has no companion in these schemes. Any other name gives nothing,
 * and the editor measures with the fonts it has.
 */

/** Which of a family's fonts a rich run is set in, as bold and italic choose it (`rich.ts`). */
export type FontVariant = "regular" | "bold" | "italic" | "boldItalic";

/** Latin Modern's roman and sans, each variant's letters after `lm`. */
const LATIN_MODERN: Readonly<Record<"roman" | "sans", Record<FontVariant, string>>> = {
  roman: { regular: "r", bold: "bx", italic: "ri", boldItalic: "bxi" },
  sans: { regular: "ss", bold: "ssbx", italic: "sso", boldItalic: "ssbo" },
};

/** A Latin Modern font's name: its encoding, sans or not, series, shape and design size. */
const LM = /^(ec|ts1)-lm(ss)?(r|bx|b)?([io])?(\d+)$/;

/** A fontname-scheme name in T1 or TS1: family, weight, shape, encoding, and `n` for narrow. */
const BERRY = /^([a-z]{3})([a-z])([io]?)(8t|8c)(n?)$/;

/** Computer Modern's roman in OT1, each variant's letters after `cm`. */
const COMPUTER_MODERN: Readonly<Record<FontVariant, string>> = {
  regular: "r",
  bold: "bx",
  italic: "ti",
  boldItalic: "bxti",
};
const CM = /^cm(r|bx|ti|bxti)(\d+)$/;

/** `names` without repeats, in order. */
const unique = (names: string[]) => [...new Set(names)];

/**
 * The names the font of `variant` may have in the family of the text font `name`, the likeliest
 * first; none when the name follows none of the schemes above. The tree says which exists.
 */
export function variantFontNames(name: string, variant: FontVariant): string[] {
  const lm = LM.exec(name);
  if (lm) {
    const [, encoding, sans, , , size] = lm;
    const letters = LATIN_MODERN[sans ? "sans" : "roman"][variant];
    return unique([`${encoding}-lm${letters}${size}`, `${encoding}-lm${letters}10`]);
  }
  const berry = BERRY.exec(name);
  if (berry) {
    const [, family, , shape, encoding, narrow] = berry;
    const weight = variant === "bold" || variant === "boldItalic" ? "b" : "r";
    const slanted = variant === "italic" || variant === "boldItalic";
    const shapes = !slanted ? [""] : shape ? [shape, shape === "i" ? "o" : "i"] : ["i", "o"];
    return shapes.map((each) => `${family}${weight}${each}${encoding}${narrow}`);
  }
  const cm = CM.exec(name);
  if (cm) {
    const [, , size] = cm;
    const letters = COMPUTER_MODERN[variant];
    return unique([`cm${letters}${size}`, `cm${letters}10`]);
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
