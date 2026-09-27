/**
 * fontspec, as the XeTeX rewrite of an import reproduces it without loading it (decision 0023):
 * which file of the tree each shape of a family a fontspec command declares is set from, and the
 * XeTeX features, scale and adjustments it loads the file with, so that NFSS declarations by file
 * set the glyphs fontspec's own set. It follows fontspec 2.8a, TeX Live 2023's, and the font manager
 * of XeTeX 0.999995, which fontspec asks for a font by name through fontconfig:
 *
 * - A font by name is found as XeTeX finds one: by a full name, then as `Family-Style`, then by a
 *   PostScript name, then as a family, whose regular face it takes (`FontIndex.find`); a `/B` is
 *   the face of its family nearest the font's weight and half the family's range of weights more,
 *   or failing that the first bold one, and an `/I` the one nearest the family's greatest slant, as
 *   XeTeX chooses them, which the engine confirmed on the tree's families. A font by file, which
 *   `Path`, `Extension` or a file's extension ask for, is the tree's file of that name, or, for a
 *   name the tree has no file of, the font whose PostScript name it is, as Adobe's older
 *   `SourceSansPro-It` is `SourceSansPro-RegularIt.otf`: a zip's own copy is never kept.
 * - A family's options are fontspec's defaults, `\defaultfontfeatures` for every font, then for
 *   the command that sets the family, `Ligatures=TeX` for the main and sans families and the mono
 *   family's spaces among them, then for its font's name, then the command's own; its bold,
 *   italic and bold italic are what XeTeX gives for `/B`, `/I` and `/BI` when they
 *   are other faces and no option names them; and each face is declared as fontspec declares it:
 *   `m/n`, `b/n`, `m/it` and `b/it`, the slanted shapes as the italic ones, `bx` as `b` but for
 *   `bx/sc`, which is the bold upright as fontspec has it, and a face's small capitals, `sc` or
 *   `scit`, as its file with `+smcp` where the file has the feature, or `SmallCapsFont`'s file.
 * - A face's features are `script=latn;language=dflt`, or `DFLT` for a font without Latin, then
 *   fontspec's keys, `LetterSpace`, `FakeBold`, `FakeSlant` and `FakeStretch`, then the OpenType
 *   ones, `Numbers`, `Letters`, `Ligatures` and the rest, each only where the font has the feature
 *   and each taking out what it clashes with, then the mapping and the colour, unless it is
 *   fontspec's default black; `Scale` is the declaration's scale, and `WordSpace`,
 *   `PunctuationSpace` and `HyphenChar` what the declaration does to the font as it loads it
 *   (`FontAdjust`), a face's own where its features set them.
 *
 * What it cannot reproduce it refuses, naming the font as the document named it, or the option by
 * its key alone: a font the tree does not have, an option it does not know, `Scale=MatchLowercase`,
 * a renderer other than OpenType, a script or language other than the default, a mapping other than
 * `tex-text`, a raw feature other than a plain `+tag` or `-tag`, and a value only TeX could read,
 * such as a macro's.
 *
 * It is pure, as the rest of `src/import/` is, and imports only types, so that Node's scripts load
 * it as it stands.
 */

import type { FontAdjust } from "../templates/package.ts";
import type { TreeFontFile } from "./fonts.ts";

// Options.

/** One of fontspec's options: a key and its value, or a key alone. */
export interface KeyVal {
  key: string;
  value?: string;
}

/** A value with the braces around the whole of it taken off, and the spaces around it. */
export function unbrace(value: string): string {
  let text = value.trim();
  while (text.startsWith("{") && closingBrace(text, 0) === text.length - 1)
    text = text.slice(1, -1).trim();
  return text;
}

/** The index of the brace that closes the one at `at`, or -1. */
function closingBrace(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return -1;
}

/** A list split at the commas outside braces, each item trimmed, the empty ones left out. */
export function splitList(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if ((char === "," && depth === 0) || i === text.length) {
      const item = text.slice(start, i).trim();
      if (item !== "") items.push(item);
      start = i + 1;
    }
  }
  return items;
}

/** fontspec's options as keys and values, in order, each value's outer braces taken off. */
export function keyVals(options: string): KeyVal[] {
  return splitList(options).map((item) => {
    const equals = indexOutsideBraces(item, "=");
    if (equals < 0) return { key: item.trim() };
    return { key: item.slice(0, equals).trim(), value: unbrace(item.slice(equals + 1)) };
  });
}

function indexOutsideBraces(text: string, char: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    else if (text[i] === char && depth === 0) return i;
  }
  return -1;
}

// Finding a font as XeTeX does.

/** A family of XeTeX's font manager: the fonts that give it as their family, by style name. */
interface Family {
  styles: Map<string, TreeFontFile>;
  minWeight: number;
  maxWeight: number;
  maxSlant: number;
}

/** A font's name as the tree is indexed by file: without its folder or extension, in lower case. */
export const fileKeyOf = (name: string) =>
  (
    name.slice(name.lastIndexOf("/") + 1).replace(/\.(?:otf|ttf|ttc|otc)$/i, "") || name
  ).toLowerCase();

/** A font of the tree found for a name, or why none was. */
export type Found = TreeFontFile | undefined;

/**
 * The tree's fonts, indexed as XeTeX's font manager indexes the fonts fontconfig gives it: by every
 * full name, PostScript name and family name, a family's faces by every style name, the first font
 * of a name keeping it; and by file.
 */
export class FontIndex {
  private readonly fullNames = new Map<string, TreeFontFile>();
  private readonly postScriptNames = new Map<string, TreeFontFile>();
  private readonly families = new Map<string, Family>();
  private readonly parents = new Map<TreeFontFile, Family>();
  private readonly files = new Map<string, TreeFontFile>();

  constructor(fonts: readonly TreeFontFile[]) {
    for (const font of fonts) {
      for (const name of [font.fullName, ...(font.more?.fullName ?? [])])
        if (!this.fullNames.has(name)) this.fullNames.set(name, font);
      if (font.postScriptName !== "" && !this.postScriptNames.has(font.postScriptName))
        this.postScriptNames.set(font.postScriptName, font);
      const key = fileKeyOf(font.file);
      if (!this.files.has(key)) this.files.set(key, font);
      const styles = [font.style, ...(font.more?.style ?? [])];
      for (const name of [font.family, ...(font.more?.family ?? [])]) {
        let family = this.families.get(name);
        if (family === undefined) {
          family = {
            styles: new Map(),
            minWeight: font.weight,
            maxWeight: font.weight,
            maxSlant: 0,
          };
          this.families.set(name, family);
        }
        family.minWeight = Math.min(family.minWeight, font.weight);
        family.maxWeight = Math.max(family.maxWeight, font.weight);
        family.maxSlant = Math.max(family.maxSlant, Math.abs(font.slant ?? 0));
        if (!this.parents.has(font)) this.parents.set(font, family);
        for (const style of styles) if (!family.styles.has(style)) family.styles.set(style, font);
      }
    }
    // XeTeX keeps a family's styles in a map sorted by name, which its searches walk in order.
    for (const family of this.families.values())
      family.styles = new Map([...family.styles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  /** The tree's font file of a name, whatever its folder and extension, or undefined. */
  byFile(name: string): Found {
    return this.files.get(fileKeyOf(name));
  }

  /**
   * The font XeTeX finds for a name and its variant, `B`, `I` or `BI`, or undefined when it finds
   * none: as a full name, as `Family-Style` split at the first hyphen, as a PostScript name, and as
   * a family, whose regular face it takes; then the variant, from the font's own family.
   */
  find(name: string, variant = ""): Found {
    let font = this.fullNames.get(name);
    const hyphen = name.indexOf("-");
    if (font === undefined && hyphen > 0 && hyphen < name.length - 1)
      font = this.families.get(name.slice(0, hyphen))?.styles.get(name.slice(hyphen + 1));
    font ??= this.postScriptNames.get(name);
    if (font === undefined) {
      const family = this.families.get(name);
      if (family !== undefined) font = regularOf(family);
    }
    if (font === undefined) return undefined;
    if (variant.includes("B")) font = this.bolder(font);
    if (variant.includes("I")) font = this.italicOf(font);
    return font;
  }

  /**
   * XeTeX's `/B`: the face of the font's family nearest its weight and half the family's range
   * more, of the same width and slant; failing that, for a font that is not bold, the first face
   * of the family, by style name, that is bold, and italic as it is.
   */
  private bolder(font: TreeFontFile): TreeFontFile {
    const family = this.parents.get(font);
    if (family === undefined) return font;
    let best = font;
    if (font.weight < family.maxWeight)
      best = bestMatch(
        family,
        font.weight + Math.trunc((family.maxWeight - family.minWeight) / 2) + 1,
        font.width,
        font.slant ?? 0,
      );
    if (best === font && !font.bold)
      best =
        [...family.styles.values()].find(
          (each) => each.bold === true && (each.italic === true) === (font.italic === true),
        ) ?? font;
    return best;
  }

  /**
   * XeTeX's `/I`: for a font that is upright, the face of its family nearest its weight and width
   * and the family's greatest slant; failing that, the first face of the family, by style name,
   * that is italic, and bold as it is.
   */
  private italicOf(font: TreeFontFile): TreeFontFile {
    const family = this.parents.get(font);
    if (family === undefined || (font.slant ?? 0) !== 0) return font;
    let best = bestMatch(family, font.weight, font.width, family.maxSlant);
    if (best === font && font.italic !== true)
      best =
        [...family.styles.values()].find(
          (each) => each.italic === true && (each.bold === true) === (font.bold === true),
        ) ?? font;
    return best;
  }
}

/**
 * A family's regular face, as XeTeX takes one for a family's name: the one face with the `OS/2`
 * table's regular flag; else the face of the style Regular, Plain, Normal or Roman; else the one
 * nearest a regular weight, the normal width and no slant.
 */
function regularOf(family: Family): TreeFontFile | undefined {
  const regular = [...family.styles.values()].filter(
    (font, i, all) => font.regular === true && all.indexOf(font) === i,
  );
  if (regular.length === 1) return regular[0];
  for (const style of ["Regular", "Plain", "Normal", "Roman"]) {
    const font = family.styles.get(style);
    if (font !== undefined) return font;
  }
  return bestMatch(family, 400, 5, 0);
}

/** The face of a family XeTeX's `bestMatchFromFamily` takes: the first with the least difference. */
function bestMatch(family: Family, weight: number, width: number, slant: number): TreeFontFile {
  let best: TreeFontFile | undefined;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const font of family.styles.values()) {
    let widthDiff = Math.abs(font.width - width);
    if (widthDiff < 10) widthDiff *= 200;
    const diff =
      Math.abs(Math.abs(font.slant ?? 0) - Math.abs(slant)) * 2 +
      Math.abs(font.weight - weight) +
      widthDiff;
    if (diff < bestDiff) {
      best = font;
      bestDiff = diff;
    }
  }
  return best as TreeFontFile;
}

// fontspec's defaults.

/** The families fontspec keeps defaults for besides every font's: the main, sans and mono ones. */
export type FamilyKind = "rm" | "sf" | "tt";

/**
 * What `\defaultfontfeatures` has set so far. fontspec keeps a family's defaults under the label of
 * the command that sets the family, `\rmfamily`'s for `\setmainfont`, `\headingfont`'s for
 * `\newfontfamily\headingfont`, and a font's under its name, and gives a family the defaults of its
 * label and of its font's name.
 */
export interface Defaults {
  /** Every font's, `\defaultfontfeatures{...}`. */
  all: KeyVal[];
  /**
   * A family's, by its command's name: `rmfamily`, `sffamily` and `ttfamily` for the main, sans and
   * mono families, fontspec.cfg's first, and a `\newfontfamily` command's own,
   * `\defaultfontfeatures[\headingfont]{...}`.
   */
  labels: Map<string, KeyVal[]>;
  /** A font's, by its name as fontspec compares it (`fontKey`), `\defaultfontfeatures[Roboto]{...}`. */
  fonts: Map<string, KeyVal[]>;
}

/** fontspec's defaults as fontspec.cfg sets them. */
export function initialDefaults(): Defaults {
  return {
    all: [],
    labels: new Map([
      ["rmfamily", [{ key: "Ligatures", value: "TeX" }]],
      ["sffamily", [{ key: "Ligatures", value: "TeX" }]],
      [
        "ttfamily",
        [
          { key: "WordSpace", value: "1,0,0" },
          { key: "HyphenChar", value: "None" },
          { key: "PunctuationSpace", value: "WordSpace" },
        ],
      ],
    ]),
    fonts: new Map(),
  };
}

/** fontspec's font extensions, in the order it looks for one in a name (`\DeclareFontExtensions`). */
const EXTENSIONS = [".otf", ".ttf", ".OTF", ".TTF", ".ttc", ".TTC", ".dfont"];

/**
 * A font's name as fontspec keeps defaults under it and looks them up (`\__fontspec_sanitise_fontname:Nn`):
 * as given, spaces and all, with the first of its extensions the name holds taken out once.
 */
export function fontKey(name: string): string {
  const extension = EXTENSIONS.find((each) => name.includes(each));
  return extension === undefined ? name : name.replace(extension, "");
}

/**
 * The most options `\defaultfontfeatures` may keep for every font, or for one family or font: a
 * document sets a few, and every family a command declares reads all that apply to it, so that
 * more, as `\defaultfontfeatures+` repeated would pile up, would make the rewrite's time grow as
 * their number times the families'.
 */
export const MAX_DEFAULTS = 256;

/**
 * `\defaultfontfeatures`, with a `+` or not, for every font or for the families and fonts it
 * names: each takes the options in place of what it had, or after them with the `+`. A target that
 * is a command names the family that command sets, `\rmfamily` the main family's and
 * `\headingfont` the one `\newfontfamily\headingfont` sets; any other names a font. False when
 * they would hold more than MAX_DEFAULTS options for one, which the rewrite refuses.
 */
export function setDefaults(
  defaults: Defaults,
  plus: boolean,
  targets: string | undefined,
  options: string,
): boolean {
  const given = keyVals(options);
  const set = (had: KeyVal[]) => (plus ? [...had, ...given] : given);
  if (targets === undefined) {
    const all = set(defaults.all);
    if (all.length > MAX_DEFAULTS) return false;
    defaults.all = all;
    return true;
  }
  for (const target of splitList(targets)) {
    const label = /^\\([A-Za-z@]+)$/.exec(target)?.[1];
    const [table, key] =
      label === undefined ? [defaults.fonts, fontKey(target)] : [defaults.labels, label];
    const list = set(table.get(key) ?? []);
    if (list.length > MAX_DEFAULTS) return false;
    table.set(key, list);
  }
  return true;
}

// A family.

/**
 * A font a fontspec command asks for: its name, its own options, its kind of family, and the label
 * its defaults are kept under (`Defaults.labels`), the kind's family command's by default.
 */
export interface FontRequest {
  name: string;
  options: string;
  kind?: FamilyKind;
  label?: string;
}

/**
 * Why a family cannot be reproduced: a font the tree lacks, by the name the document gave it, or
 * one of fontspec's options, by its key alone.
 */
export interface Unreproducible {
  unreproducible: "font" | "option";
  name: string;
}

/** One shape of a family: the file, and the features, scale and adjustments it loads with. */
export interface ShapeSpec {
  font: TreeFontFile;
  features: string[];
  scale?: number;
  adjust?: FontAdjust;
}

/** A family as fontspec would declare it: each shape, by `<series>/<shape>`, in fontspec's order. */
export interface FamilySpec {
  shapes: Map<string, ShapeSpec>;
  /** The kinds of feature it carries, as the runner counts them: `smcp`, `pnum`, `letterspace`. */
  kinds: Set<string>;
}

/** The keys fontspec reads before the features, which name faces, files and families. */
const FACE_KEYS: Readonly<Record<string, string>> = {
  UprightFont: "m/n",
  BoldFont: "b/n",
  ItalicFont: "m/it",
  SlantedFont: "m/sl",
  SwashFont: "m/sw",
  BoldItalicFont: "b/it",
  BoldSlantedFont: "b/sl",
  BoldSwashFont: "b/sw",
};

const FACE_FEATURE_KEYS: Readonly<Record<string, string>> = {
  UprightFeatures: "m/n",
  BoldFeatures: "b/n",
  ItalicFeatures: "m/it",
  SlantedFeatures: "m/sl",
  SwashFeatures: "m/sw",
  BoldItalicFeatures: "b/it",
  BoldSlantedFeatures: "b/sl",
  BoldSwashFeatures: "b/sw",
};

/** The keys fontspec's preparse takes that the rewrite reads or passes over. */
const PREPARSE_KEYS = new Set([
  "Path",
  "Extension",
  "SmallCapsFont",
  "SmallCapsFeatures",
  "FontFace",
  "NFSSFamily",
  "Renderer",
  "Scale",
  "ScaleAgain",
]);

/** A value that only TeX could read: a macro, a parameter or a group left in it. */
const byTeX = (value: string) => /[\\#{}]/.test(value);

/** The longest name a face may have once its `*` stand for the font's: none of the tree's is near. */
const MAX_FACE_NAME = 1024;

/** The file extensions that make fontspec take a name for a file's. */
const EXTERNAL = /\.(?:otf|ttf|ttc|otc|pfb|pfa)$/i;

/**
 * A family as fontspec would declare it for a request, with the defaults as they stand, from the
 * tree's fonts; or what cannot be reproduced, named.
 */
export function familyFor(
  request: FontRequest,
  defaults: Defaults,
  index: FontIndex,
  colours: ReadonlyMap<string, string>,
): FamilySpec | Unreproducible {
  const name = request.name.trim();
  if (name === "" || byTeX(name)) return { unreproducible: "font", name };
  const label = request.label ?? (request.kind === undefined ? undefined : `${request.kind}family`);
  const all: KeyVal[] = [
    ...defaults.all,
    ...(label === undefined ? [] : (defaults.labels.get(label) ?? [])),
    ...(defaults.fonts.get(fontKey(name)) ?? []),
    ...keyVals(request.options),
  ];
  const value = (key: string) => {
    let found: string | undefined;
    for (const each of all) if (each.key === key) found = each.value ?? "";
    return found;
  };
  const fileMode =
    value("Path") !== undefined || value("Extension") !== undefined || EXTERNAL.test(name);
  const extension = value("Extension");
  if (extension !== undefined && byTeX(extension))
    return { unreproducible: "option", name: "Extension" };
  const renderer = value("Renderer");
  if (renderer !== undefined && !/^(?:OpenType|HarfBuzz|ICU|Harfbuzz)$/.test(renderer))
    return { unreproducible: "option", name: "Renderer" };
  for (const key of ["SizeFeatures", "OpticalSize", "Weight", "Width", "ScaleAgain"])
    if (value(key) !== undefined) return { unreproducible: "option", name: key };

  // The faces and their names, `*` as the font's name; one that would be longer than any font's
  // name is none of the tree's, and is not made, since stars could make it a square of the text.
  const starred = (face: string) => face.length + (face.split("*").length - 1) * name.length;
  const star = (face: string) =>
    starred(face) > MAX_FACE_NAME ? face : face.replaceAll("*", name).trim();
  const faces = new Map<string, { name: string; features: KeyVal[] }>();
  const none = new Set<string>();
  for (const { key, value: given } of all) {
    const shape = FACE_KEYS[key];
    if (shape === undefined) continue;
    if (given === undefined || given === "") none.add(shape);
    else {
      none.delete(shape);
      faces.set(shape, { name: star(given), features: faces.get(shape)?.features ?? [] });
    }
  }
  for (const { key, value: given } of all) {
    const shape = FACE_FEATURE_KEYS[key];
    if (shape === undefined || given === undefined) continue;
    const face = faces.get(shape);
    const features = [...(face?.features ?? []), ...keyVals(given)];
    faces.set(shape, { name: face?.name ?? "", features });
  }
  const upright = faces.get("m/n")?.name || name;
  faces.set("m/n", { name: upright, features: faces.get("m/n")?.features ?? [] });
  for (const { key, value: given } of all)
    if (key === "AutoFakeBold" || key === "AutoFakeSlant") {
      const amount = given || (key === "AutoFakeBold" ? "1.5" : "0.2");
      const fake = { key: key === "AutoFakeBold" ? "FakeBold" : "FakeSlant", value: amount };
      for (const shape of key === "AutoFakeBold" ? ["b/n", "b/it"] : ["m/it", "b/it"]) {
        const face = faces.get(shape);
        faces.set(shape, { name: upright, features: [...(face?.features ?? []), fake] });
      }
      none.delete(key === "AutoFakeBold" ? "b/n" : "m/it");
    }

  // A face's font: the tree's file of its name, or the font XeTeX finds for it.
  const fontOf = (face: string, variant = ""): TreeFontFile | Unreproducible => {
    if (byTeX(face)) return { unreproducible: "font", name: face };
    if (fileMode) {
      const file = EXTERNAL.test(face) || extension === undefined ? face : `${face}${extension}`;
      const plain = file.slice(file.lastIndexOf("/") + 1).replace(EXTERNAL, "");
      const found = index.byFile(file) ?? index.find(plain);
      return found ?? { unreproducible: "font", name: file.slice(file.lastIndexOf("/") + 1) };
    }
    return index.find(face, variant) ?? { unreproducible: "font", name: face };
  };
  const base = fontOf(upright);
  if ("unreproducible" in base) return base;

  // What XeTeX gives for /B, /I and /BI, where no option names the face and it is another face.
  if (!fileMode) {
    const auto = (from: string | undefined, variant: string) => {
      if (from === undefined || from === "") return undefined;
      const plain = index.find(from);
      const varied = index.find(from, variant);
      return plain !== undefined && varied !== undefined && plain !== varied
        ? `${from}/${variant}`
        : undefined;
    };
    const named = (shape: string) => faces.get(shape)?.name || undefined;
    if (!none.has("m/it") && !none.has("b/n") && named("b/it") === undefined) {
      const bfit =
        auto(named("m/it"), "B") ?? auto(named("b/n"), "I") ?? auto(upright, "BI") ?? undefined;
      if (bfit !== undefined)
        faces.set("b/it", { name: bfit, features: faces.get("b/it")?.features ?? [] });
    }
    if (!none.has("b/n") && named("b/n") === undefined) {
      const bf = auto(upright, "B");
      if (bf !== undefined)
        faces.set("b/n", { name: bf, features: faces.get("b/n")?.features ?? [] });
    }
    if (!none.has("m/it") && named("m/it") === undefined) {
      const it = auto(upright, "I");
      if (it !== undefined)
        faces.set("m/it", { name: it, features: faces.get("m/it")?.features ?? [] });
    }
    const slanted = named("m/sl");
    if (slanted !== undefined && named("b/sl") === undefined) {
      const bfsl = auto(slanted, "B");
      if (bfsl !== undefined)
        faces.set("b/sl", { name: bfsl, features: faces.get("b/sl")?.features ?? [] });
    }
  }
  for (const shape of none) faces.delete(shape);

  // FontFace={series}{shape}{Font=...,features} or {series}{shape}{font}.
  for (const { key, value: given } of all) {
    if (key !== "FontFace" || given === undefined) continue;
    const parts = /^\{([a-z]+)\}\s*\{([a-z]+)\}\s*\{([\s\S]*)\}$/.exec(given.trim());
    if (!parts) return { unreproducible: "option", name: "FontFace" };
    const [, series, shape, spec = ""] = parts;
    const items = keyVals(spec);
    const font = items.find((each) => each.key === "Font")?.value;
    const face =
      font ?? (items.length === 1 && items[0]?.value === undefined ? items[0]?.key : undefined);
    if (face === undefined) return { unreproducible: "option", name: "FontFace" };
    faces.set(`${series}/${shape}`, {
      name: star(face),
      features: items.filter((each) => each.key !== "Font" && each.value !== undefined),
    });
  }

  // The family's own options, which every face takes before its own.
  const familyOptions = all.filter(
    (each) =>
      FACE_KEYS[each.key] === undefined &&
      FACE_FEATURE_KEYS[each.key] === undefined &&
      !PREPARSE_KEYS.has(each.key) &&
      each.key !== "AutoFakeBold" &&
      each.key !== "AutoFakeSlant",
  );
  const script = base.scripts.includes("latn")
    ? "latn"
    : base.scripts.includes("DFLT")
      ? "DFLT"
      : undefined;
  const scale = value("Scale");
  if (scale !== undefined && !/^\d*\.?\d+$/.test(scale))
    return { unreproducible: "option", name: "Scale" };
  const smallCapsName = value("SmallCapsFont");
  const smallCapsFeatures = keyVals(value("SmallCapsFeatures") ?? "");
  const noSmallCaps = smallCapsName === "";

  const spec: FamilySpec = { shapes: new Map(), kinds: new Set() };
  const declare = (shape: string, face: TreeFontFile, options: KeyVal[]) => {
    const made = featuresOf(face, [...familyOptions, ...options], script, colours);
    if ("unreproducible" in made) return made;
    for (const kind of made.kinds) spec.kinds.add(kind);
    spec.shapes.set(shape, {
      font: face,
      features: made.features,
      ...(scale === undefined || Number(scale) === 1 ? {} : { scale: Number(scale) }),
      ...(made.adjust === undefined ? {} : { adjust: made.adjust }),
    });
    return undefined;
  };
  const smallCapsShape = (shape: string) => (shape === "n" ? "sc" : `sc${shape}`);
  for (const [key, face] of orderFaces(faces)) {
    const [series = "m", shape = "n"] = key.split("/");
    const found =
      key === "m/n" ? base : fontOf(face.name.replace(/\/(B|I|BI)$/, ""), variantOf(face.name));
    if ("unreproducible" in found) return found;
    const failed = declare(key, found, face.features);
    if (failed) return failed;
    // Small capitals, where fontspec makes them: another file, or this one's +smcp.
    if (!noSmallCaps && ["n", "it", "sl", "sw"].includes(shape)) {
      if (smallCapsName !== undefined) {
        const small = fontOf(star(smallCapsName));
        if ("unreproducible" in small) return small;
        const failedSmall = declare(`${series}/${smallCapsShape(shape)}`, small, [
          ...face.features,
          ...smallCapsFeatures,
        ]);
        if (failedSmall) return failedSmall;
      } else if (found.features.includes("smcp")) {
        const failedSmall = declare(`${series}/${smallCapsShape(shape)}`, found, [
          ...face.features,
          { key: "Letters", value: "SmallCaps" },
          ...smallCapsFeatures,
        ]);
        if (failedSmall) return failedSmall;
      }
    }
    // fontspec's substitutions, as NFSS declarations of the same file: slanted as italic, and
    // bold extended as bold, its small capitals as the bold upright.
    if (shape === "it" && !faces.has(`${series}/sl`)) copy(spec, `${series}/it`, `${series}/sl`);
    if (series === "b") {
      copy(spec, key, `bx/${shape}`);
      if (spec.shapes.has(`b/${smallCapsShape(shape)}`))
        copy(spec, key, `bx/${smallCapsShape(shape)}`);
      if (shape === "it") copy(spec, key, "bx/sl");
    }
  }
  return spec;
}

/** A face's name's XeTeX variant, `/B`, `/I` or `/BI`, which the autofonts append. */
const variantOf = (name: string) => /\/(B|I|BI)$/.exec(name)?.[1] ?? "";

/** The faces in fontspec's order: its own, then those `FontFace` adds, in the order given. */
function orderFaces(
  faces: Map<string, { name: string; features: KeyVal[] }>,
): [string, { name: string; features: KeyVal[] }][] {
  const order = ["m/n", "b/n", "m/it", "m/sl", "m/sw", "b/it", "b/sl", "b/sw"];
  const known = order.flatMap((key) => {
    const face = faces.get(key);
    return face?.name ? [[key, face] as [string, { name: string; features: KeyVal[] }]] : [];
  });
  const others = [...faces].filter(([key, face]) => !order.includes(key) && face.name);
  return [...known, ...others];
}

/** Declare `to` as `from` is, as fontspec's `ssub` declarations make it; nothing if `from` is not. */
function copy(spec: FamilySpec, from: string, to: string) {
  const shape = spec.shapes.get(from);
  if (shape !== undefined) spec.shapes.set(to, shape);
}

// A face's features.

/** An OpenType option: its feature's tag, what it sets, and the settings it takes out. */
interface OpenTypeOption {
  tag?: string;
  set?: string;
  clashes: string[];
}

/** fontspec's on, off and reset options of a feature, `Name`, `NameOff` and `NameReset`. */
function onOffReset(
  table: Record<string, OpenTypeOption>,
  name: string,
  tag: string,
  clashes: string[] = [],
) {
  table[name] = { tag, set: `+${tag}`, clashes };
  table[`${name}Off`] = { tag, set: `-${tag}`, clashes: [] };
  table[`${name}Reset`] = { clashes: [`+${tag}`, `-${tag}`] };
}

/** fontspec's OpenType options this rewrite reproduces, by key and value (fontspec-code-feat-opentype). */
const OPENTYPE: Readonly<Record<string, Record<string, OpenTypeOption>>> = (() => {
  const groups: Record<string, Record<string, OpenTypeOption>> = {};
  const group = (name: string, build: (table: Record<string, OpenTypeOption>) => void) => {
    const table: Record<string, OpenTypeOption> = {};
    build(table);
    groups[name] = table;
  };
  group("Ligatures", (t) => {
    onOffReset(t, "Required", "rlig");
    onOffReset(t, "Common", "liga");
    onOffReset(t, "Rare", "dlig");
    onOffReset(t, "Discretionary", "dlig");
    onOffReset(t, "Contextual", "clig");
    onOffReset(t, "Historic", "hlig");
    t.NoRequired = { tag: "rlig", set: "-rlig", clashes: [] };
    t.NoCommon = { tag: "liga", set: "-liga", clashes: [] };
    t.NoRare = { tag: "dlig", set: "-dlig", clashes: [] };
    t.NoDiscretionary = { tag: "dlig", set: "-dlig", clashes: [] };
    t.NoContextual = { tag: "clig", set: "-clig", clashes: [] };
    t.NoHistoric = { tag: "hlig", set: "-hlig", clashes: [] };
  });
  group("Letters", (t) => {
    onOffReset(t, "Uppercase", "case");
    onOffReset(t, "SmallCaps", "smcp", ["+pcap", "+unic"]);
    onOffReset(t, "PetiteCaps", "pcap", ["+smcp", "+unic"]);
    onOffReset(t, "UppercaseSmallCaps", "c2sc", ["+c2pc", "+unic"]);
    onOffReset(t, "UppercasePetiteCaps", "c2pc", ["+c2sc", "+unic"]);
    onOffReset(t, "Unicase", "unic");
    onOffReset(t, "Random", "rand");
  });
  group("Numbers", (t) => {
    onOffReset(t, "Monospaced", "tnum", ["+pnum", "-pnum"]);
    onOffReset(t, "Proportional", "pnum", ["+tnum", "-tnum"]);
    onOffReset(t, "Lowercase", "onum", ["+lnum", "-lnum"]);
    onOffReset(t, "Uppercase", "lnum", ["+onum", "-onum"]);
    onOffReset(t, "SlashedZero", "zero");
    t.Tabular = t.Monospaced as OpenTypeOption;
    t.OldStyle = t.Lowercase as OpenTypeOption;
    t.Lining = t.Uppercase as OpenTypeOption;
  });
  group("VerticalPosition", (t) => {
    const all = ["sups", "subs", "ordn", "numr", "dnom", "sinf"];
    const others = (tag: string) => all.filter((each) => each !== tag).map((each) => `+${each}`);
    onOffReset(t, "Superior", "sups", others("sups"));
    onOffReset(t, "Inferior", "subs", others("subs"));
    onOffReset(t, "Ordinal", "ordn", others("ordn"));
    onOffReset(t, "Numerator", "numr", others("numr"));
    onOffReset(t, "Denominator", "dnom", others("dnom"));
    onOffReset(t, "ScientificInferior", "sinf", others("sinf"));
  });
  group("Contextuals", (t) => {
    onOffReset(t, "Swash", "cswh");
    onOffReset(t, "Alternate", "calt");
    onOffReset(t, "WordInitial", "init");
    onOffReset(t, "WordFinal", "fina");
    onOffReset(t, "LineFinal", "falt");
    onOffReset(t, "Inner", "medi");
  });
  group("Kerning", (t) => {
    onOffReset(t, "Uppercase", "cpsp");
    t.On = { tag: "kern", set: "+kern", clashes: ["-kern"] };
    t.Off = { tag: "kern", set: "-kern", clashes: ["+kern"] };
    t.Reset = { clashes: ["+kern", "-kern"] };
  });
  group("Fractions", (t) => {
    t.On = { tag: "frac", set: "+frac", clashes: [] };
    t.Off = { tag: "frac", set: "-frac", clashes: [] };
    t.Reset = { clashes: ["+frac", "-frac"] };
    onOffReset(t, "Alternate", "afrc", ["-frac"]);
  });
  group("Style", (t) => {
    onOffReset(t, "Alternate", "salt");
    onOffReset(t, "Italic", "ital");
    onOffReset(t, "Swash", "swsh");
    onOffReset(t, "Historic", "hist");
    onOffReset(t, "Titling", "titl");
    onOffReset(t, "TitlingCaps", "titl");
    onOffReset(t, "Uppercase", "case");
  });
  return groups;
})();

/** fontspec's own keys that set XeTeX features, by key: the feature and its default. */
const FONTSPEC_FEATURES: Readonly<Record<string, { feature: string; otherwise?: string }>> = {
  LetterSpace: { feature: "letterspace" },
  FakeBold: { feature: "embolden", otherwise: "1.5" },
  FakeSlant: { feature: "slant", otherwise: "0.2" },
  FakeStretch: { feature: "extend", otherwise: "1.2" },
};

/** xcolor's colours by name, as `\convertcolorspec` gives each in HTML. */
const XCOLOR: Readonly<Record<string, string>> = {
  red: "FF0000",
  green: "00FF00",
  blue: "0000FF",
  cyan: "00FFFF",
  magenta: "FF00FF",
  yellow: "FFFF00",
  black: "000000",
  white: "FFFFFF",
  gray: "808080",
  darkgray: "404040",
  lightgray: "BFBFBF",
};

/**
 * A face's XeTeX features from its options (`FamilySpec`): the script and language, fontspec's
 * keys, the OpenType ones, then the mapping and the colour; and what the declaration does to the
 * font (`FontAdjust`); or what cannot be reproduced. A feature the font lacks is left out, as
 * fontspec leaves it out with a warning, and still takes out what it clashes with.
 */
function featuresOf(
  font: TreeFontFile,
  options: readonly KeyVal[],
  script: string | undefined,
  colours: ReadonlyMap<string, string>,
): { features: string[]; adjust?: FontAdjust; kinds: Set<string> } | Unreproducible {
  let raw: string[] = [];
  let mapping: string | undefined;
  let colour: string | undefined;
  let opacity: string | undefined;
  const adjust: FontAdjust = {};
  const kinds = new Set<string>();
  const has = (tag: string) => font.features.includes(tag);
  const update = (setting: string, clashes: readonly string[] = []) => {
    const out = new Set([setting, swap(setting), ...clashes]);
    raw = raw.filter((each) => !out.has(each));
    raw.push(setting);
  };
  const opentype: KeyVal[] = [];
  for (const { key, value } of options) {
    const fontspecFeature = FONTSPEC_FEATURES[key];
    if (fontspecFeature !== undefined) {
      const amount = value === undefined || value === "" ? fontspecFeature.otherwise : value;
      if (amount === undefined || !/^-?\d*\.?\d+$/.test(amount))
        return { unreproducible: "option", name: key };
      update(`${fontspecFeature.feature}=${amount}`);
      kinds.add(fontspecFeature.feature);
      continue;
    }
    switch (key) {
      case "Color":
      case "Colour": {
        const hex = colourOf(value ?? "", colours);
        if (hex === undefined) return { unreproducible: "option", name: key };
        colour = hex.slice(0, 6);
        if (hex.length === 8) opacity = hex.slice(6);
        break;
      }
      case "Opacity": {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1)
          return { unreproducible: "option", name: key };
        opacity = Math.trunc(255 * amount)
          .toString(16)
          .toUpperCase()
          .padStart(2, "0");
        break;
      }
      case "WordSpace": {
        const factors = splitList(value ?? "").map(Number);
        if (
          !(factors.length === 1 || factors.length === 3) ||
          factors.some((f) => !Number.isFinite(f))
        )
          return { unreproducible: "option", name: key };
        const [space = 1, stretch = space, shrink = space] =
          factors.length === 1 ? [factors[0], factors[0], factors[0]] : factors;
        adjust.wordSpace = [space, stretch, shrink];
        kinds.add("wordspace");
        break;
      }
      case "PunctuationSpace": {
        if (value === "WordSpace") adjust.punctuationSpace = { factor: 0, of: "space" };
        else if (value === "TwiceWordSpace") adjust.punctuationSpace = { factor: 1, of: "space" };
        else if (value !== undefined && /^-?\d*\.?\d+$/.test(value))
          adjust.punctuationSpace = { factor: Number(value), of: "punctuation" };
        else return { unreproducible: "option", name: key };
        kinds.add("punctuationspace");
        break;
      }
      case "HyphenChar": {
        if (value === "None") adjust.hyphenChar = -1;
        else if (value !== undefined && [...value].length === 1)
          adjust.hyphenChar = value.codePointAt(0) as number;
        else if (value !== undefined && /^"[0-9A-Fa-f]{1,6}$/.test(value))
          adjust.hyphenChar = Number.parseInt(value.slice(1), 16);
        else if (value !== undefined && /^\d+$/.test(value)) adjust.hyphenChar = Number(value);
        else return { unreproducible: "option", name: key };
        kinds.add("hyphenchar");
        break;
      }
      case "Script":
        if (value !== "Latin" && value !== "Default" && value !== "CustomDefault")
          return { unreproducible: "option", name: key };
        break;
      case "Language":
        if (value !== "Default") return { unreproducible: "option", name: key };
        break;
      default:
        opentype.push({ key, ...(value === undefined ? {} : { value }) });
    }
  }
  for (const { key, value } of opentype) {
    if (key === "Mapping") {
      if (value !== "tex-text") return { unreproducible: "option", name: key };
      mapping = value;
      continue;
    }
    if (key === "RawFeature") {
      for (const setting of (value ?? "")
        .split(";")
        .map((each) => each.trim())
        .filter(Boolean)) {
        if (!/^[+-][A-Za-z0-9]{4}$/.test(setting)) return { unreproducible: "option", name: key };
        update(setting);
        kinds.add(setting.slice(1));
      }
      continue;
    }
    if (key === "StylisticSet" || key === "CharacterVariant") {
      for (const each of splitList(value ?? "")) {
        const number = Number(each);
        if (!Number.isInteger(number) || number < 1 || number > 99)
          return { unreproducible: "option", name: key };
        const tag = `${key === "StylisticSet" ? "ss" : "cv"}${String(number).padStart(2, "0")}`;
        if (has(tag)) update(`+${tag}`);
        kinds.add(tag);
      }
      continue;
    }
    const table = OPENTYPE[key];
    if (table === undefined) return { unreproducible: "option", name: key };
    for (const choice of splitList(value ?? "")) {
      if (key === "Ligatures" && choice === "TeX") {
        mapping = "tex-text";
        continue;
      }
      if (key === "Ligatures" && choice === "ResetAll") {
        mapping = undefined;
        raw = raw.filter((each) => !/^[+-](?:dlig|rlig|liga|clig|hlig)$/.test(each));
        continue;
      }
      const option = table[choice];
      if (option === undefined) return { unreproducible: "option", name: key };
      if (option.set === undefined) {
        raw = raw.filter((each) => !option.clashes.includes(each));
        continue;
      }
      if (option.tag === undefined || has(option.tag)) update(option.set, option.clashes);
      else
        raw = raw.filter(
          (each) => !option.clashes.includes(each) && each !== swap(option.set as string),
        );
      if (option.tag !== undefined) kinds.add(option.tag);
    }
  }
  // fontspec writes the colour unless it is its default, black with the opacity never set: an
  // opacity given, even a full one, as an eight-digit colour's is, writes it.
  const coloured = (colour !== undefined && colour !== "000000") || opacity !== undefined;
  const features = [
    ...(script === undefined ? [] : [`script=${script}`]),
    "language=dflt",
    ...raw,
    ...(mapping === undefined ? [] : [`mapping=${mapping}`]),
    ...(coloured ? [`color=${colour ?? "000000"}${opacity ?? ""}`] : []),
  ];
  if (mapping !== undefined) kinds.add("mapping");
  if (coloured) kinds.add("color");
  return {
    features,
    ...(Object.keys(adjust).length === 0 ? {} : { adjust }),
    kinds,
  };
}

/** A feature's setting turned round, `+pnum` to `-pnum`; any other setting as it is. */
const swap = (setting: string) =>
  setting.startsWith("+")
    ? `-${setting.slice(1)}`
    : setting.startsWith("-")
      ? `+${setting.slice(1)}`
      : setting;

/**
 * A colour as fontspec's `Color` takes one, in hexadecimal: six digits, or eight with the opacity;
 * or an xcolor colour's name, which fontspec converts to HTML, from `colours`, the document's own,
 * or xcolor's base colours. Undefined for one it cannot read.
 */
function colourOf(value: string, colours: ReadonlyMap<string, string>): string | undefined {
  if (/^[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)) return value.toUpperCase();
  return colours.get(value) ?? XCOLOR[value];
}

/**
 * The HTML value xcolor gives a colour a document defines, `\definecolor{name}{model}{spec}` in
 * the HTML, RGB, rgb or gray model, as `\convertcolorspec` converts it, or undefined.
 */
export function htmlColour(model: string, spec: string): string | undefined {
  const hex = (n: number) => Math.round(n).toString(16).toUpperCase().padStart(2, "0");
  const parts = spec.split(",").map((each) => each.trim());
  switch (model) {
    case "HTML":
      return /^[0-9A-Fa-f]{6}$/.test(spec.trim()) ? spec.trim().toUpperCase() : undefined;
    case "RGB": {
      const values = parts.map(Number);
      if (values.length !== 3 || values.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
        return undefined;
      return values.map(hex).join("");
    }
    case "rgb": {
      const values = parts.map(Number);
      if (values.length !== 3 || values.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
        return undefined;
      return values.map((v) => hex(v * 255)).join("");
    }
    case "gray": {
      const value = Number(spec.trim());
      if (!Number.isFinite(value) || value < 0 || value > 1) return undefined;
      return hex(value * 255).repeat(3);
    }
    default:
      return undefined;
  }
}
