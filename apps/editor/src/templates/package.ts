/**
 * The template package: everything the editor knows about one template, as one JSON value.
 *
 * The import pipeline will produce packages and the shared cache will store them, so a package is
 * data, never code: the preamble its format is dumped from, any class and style files, the style
 * controls the template offers and how each is applied, and snippets that map the resume model
 * onto its macros. One generator renders the model with any package. A template the generator
 * cannot render needs a generator feature or a new decision record, never code in a package
 * (decision 0006).
 *
 * Every snippet is checked here against the slots its place offers, and for what it puts in an
 * address, so a package that parses is one the generator can render. The marker macros are not a
 * package's: they are the editor's, and the generator appends them to the preamble when it dumps
 * the format.
 *
 * A XeTeX package names its fonts by file (decision 0014): each family's shapes as OpenType or
 * TrueType files of the TeX Live tree, which the generator declares to NFSS in the format, and
 * which XeTeX loads only when a shape is selected, so that the format holds no native font. A
 * shape may carry XeTeX features of its own besides its family's, as an import's small capitals
 * load with `+smcp` while the family's other shapes do not (decision 0023).
 */

import {
  Id,
  type LinkKind,
  SECTION_KINDS,
  SECTION_ROLES,
  type SectionKind,
  type SectionRole,
} from "@resume-tools/resume-model";
import { z } from "zod";
import { isFileName, isFormatName } from "../engine/names";
import type { Engine as SessionEngine } from "../engine/session";
import {
  checkAddresses,
  checkSnippet,
  parseSnippet,
  type SlotType,
  SnippetError,
  type SnippetNode,
} from "./snippet";

type Slots = Readonly<Record<string, SlotType>>;

// The slots each snippet offers, by its place in the package. The generator renders from these.

/** The body, from `\begin{document}` to `\end{document}`. The header is a list of one. */
export const DOCUMENT_SLOTS = { header: "list", sections: "list" } satisfies Slots;
/** `contacts` is the phone, email, location and links that are present, joined by a separator. */
export const HEADER_SLOTS = {
  first: "text",
  last: "text",
  headline: "text",
  email: "text",
  phone: "text",
  location: "text",
  links: "list",
  contacts: "list",
} satisfies Slots;
/**
 * One contact field, as `{{contacts}}` shows it: its `text`, and an `href` the generator builds,
 * since an address is only ever a URL slot. For the email it is `mailto:` and the address,
 * trimmed; for the phone `tel:` and the number with all whitespace taken out, each with the
 * `#`, `?`, `&`, `%` and `/` an address would read as its syntax percent-encoded; and the location
 * has none, so that `{{#href}}` is false and `{{&href}}` sets nothing.
 */
export const CONTACT_SLOTS = { text: "text", href: "url" } satisfies Slots;
export const LINK_SLOTS = { label: "text", href: "url" } satisfies Slots;
export const SECTION_SLOTS = {
  entries: { title: "text", entries: "list" },
  list: { title: "text", items: "list" },
  labelled: { title: "text", items: "list" },
  paragraph: { title: "text", text: "rich" },
} satisfies Record<SectionKind, Slots>;
export const ENTRY_SLOTS = {
  title: "text",
  subtitle: "text",
  place: "text",
  dates: "date",
  bullets: "list",
} satisfies Slots;
export const BULLET_SLOTS = { text: "rich" } satisfies Slots;
export const ITEM_SLOTS = { text: "rich" } satisfies Slots;
export const LABELLED_ITEM_SLOTS = { label: "text", text: "rich" } satisfies Slots;

/** A control's value in the snippet that applies it. It is not a field, so it is never marked. */
const VALUE_SLOTS = { value: "text" } satisfies Slots;

/** Template text in the snippet language. The slots it may use depend on where it sits. */
const Snippet = z.string().superRefine((source, ctx) => {
  try {
    parseSnippet(source);
  } catch (error) {
    if (!(error instanceof SnippetError)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});

/**
 * A snippet or separator that may depend on the role of the section it sits in: the same one for
 * every role, or a `default` and a variant for each role that needs one.
 */
export type ByRole<T> = T | ({ default: T } & Partial<Record<SectionRole, T>>);

function byRole<T extends z.ZodType>(schema: T) {
  const variants = Object.fromEntries(SECTION_ROLES.map((role) => [role, schema.optional()]));
  return z.union([
    schema,
    z.strictObject({ default: schema, ...(variants as Record<SectionRole, z.ZodOptional<T>>) }),
  ]);
}

/** The engines a package can name, which `satisfies` holds to the session's, both ways. */
const Engine = z.enum({ pdftex: "pdftex", xetex: "xetex" } satisfies { [E in SessionEngine]: E });

const PageSize = z.enum(["letter", "a4"]);
type PageSize = z.infer<typeof PageSize>;
/**
 * Inches, the same on every side. `multipleOf` allows for floating point, in which 0.7 / 0.1 is
 * 6.999999999999999.
 */
const Margin = z.number().min(0.4).max(1).multipleOf(0.1);
/** Points. */
const FontSize = z.number().min(9).max(12).multipleOf(0.5);
const HexColour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "a colour is #RRGGBB");
const Density = z.enum(["compact", "normal", "relaxed"]);
export const DateFormat = z.enum(["MMM yyyy", "MMMM yyyy", "MM/yyyy", "yyyy"]);
export type DateFormat = z.infer<typeof DateFormat>;

const format = z.boolean().optional();

/**
 * The style controls a package offers, from the closed set in docs/editor-plan.md section 5.4,
 * and how each is applied. An `apply` snippet goes in the body before `\begin{document}`, so
 * changing the control costs one ordinary compile. A control marked `format` is one the class
 * fixes when it loads, such as the font size in `article`: its value is also a slot of the
 * preamble, named after the control, and one format is dumped for each combination of the
 * format-bound values. The date format has no snippet, because the generator formats every date.
 * Every package offers it and may only choose its default.
 */
const Controls = z.strictObject({
  pageSize: z
    .strictObject({ default: PageSize, apply: z.record(PageSize, Snippet), format })
    .optional(),
  margins: z.strictObject({ default: Margin, apply: Snippet, format }).optional(),
  fontSize: z.strictObject({ default: FontSize, apply: Snippet, format }).optional(),
  font: z
    .strictObject({
      default: Id,
      choices: z
        .array(z.strictObject({ id: Id, name: z.string(), apply: Snippet }))
        .min(1)
        .max(4),
      format,
    })
    .optional(),
  accent: z.strictObject({ default: HexColour, apply: Snippet, format }).optional(),
  density: z
    .strictObject({ default: Density, apply: z.record(Density, Snippet), format })
    .optional(),
  dateFormat: z.strictObject({ default: DateFormat }).optional(),
});
type Controls = z.infer<typeof Controls>;

/**
 * The snippets that map the model onto the template's macros, one for each kind of node. Those
 * that sit inside a section may depend on its role. The generator joins the items of a list slot
 * with the matching separator, which is plain template text and a newline unless the package says
 * otherwise.
 */
const Snippets = z.strictObject({
  document: Snippet,
  header: Snippet,
  /** A contact field without a snippet is left out of `{{contacts}}`. */
  contact: z
    .strictObject({
      phone: Snippet.optional(),
      email: Snippet.optional(),
      location: Snippet.optional(),
    })
    .optional(),
  /** A link kind without a snippet of its own uses `other`'s. */
  link: z.strictObject({
    website: Snippet.optional(),
    linkedin: Snippet.optional(),
    github: Snippet.optional(),
    twitter: Snippet.optional(),
    orcid: Snippet.optional(),
    other: Snippet,
  } satisfies Record<LinkKind, z.ZodType>),
  section: z.strictObject({
    entries: byRole(Snippet),
    list: byRole(Snippet),
    labelled: byRole(Snippet),
    paragraph: byRole(Snippet),
  } satisfies Record<SectionKind, z.ZodType>),
  entry: byRole(Snippet),
  bullet: byRole(Snippet),
  item: byRole(Snippet),
  labelledItem: byRole(Snippet),
  separators: z
    .strictObject({
      sections: z.string().default("\n"),
      links: z.string().default("\n"),
      contacts: z.string().default("\n"),
      entries: byRole(z.string()).default("\n"),
      bullets: byRole(z.string()).default("\n"),
      items: byRole(z.string()).default("\n"),
    })
    .prefault({}),
});

/**
 * The shapes of a font family a resume needs most, as `<series>/<shape>` of NFSS's values: the
 * series medium, bold and bold extended, which LaTeX's `\bfseries` asks for, and the shapes
 * upright, italic, slanted and small capitals. A family may declare any other `ShapeKey` too.
 */
export const FontShapeKey = z.enum([
  "m/n",
  "m/it",
  "m/sl",
  "m/sc",
  "b/n",
  "b/it",
  "b/sl",
  "b/sc",
  "bx/n",
  "bx/it",
  "bx/sl",
  "bx/sc",
]);
export type FontShapeKey = z.infer<typeof FontShapeKey>;

/**
 * A shape of a font family as `<series>/<shape>`, each one to eight lower-case letters, as NFSS
 * names them: `FontShapeKey`'s, and the others fontspec declares for an import (decision 0023),
 * such as the italic small capitals `m/scit` and a light series `l/n`. Letters alone, so that
 * neither can hold anything TeX would read as syntax.
 */
const ShapeKey = z
  .string()
  .regex(
    /^[a-z]{1,8}\/[a-z]{1,8}$/,
    "a font shape is <series>/<shape>, each of lower-case letters",
  );

/**
 * A font file of the tree, by its plain name, as XeTeX's `[<file>]` syntax takes it inside a
 * declaration's quotes: letters, digits, `.`, `_`, `+` and `-`, not starting with a dot, and an
 * OpenType or TrueType extension. Every font file of the tree's `fonts/opentype` and
 * `fonts/truetype` has such a name.
 */
const FontFile = z
  .string()
  .refine(
    (name) => isFileName(name) && /^[A-Za-z0-9._+-]+\.(?:otf|ttf)$/.test(name),
    "a font file is a plain file name of letters, digits, ., _, + and -, ending in .otf or .ttf",
  );

/**
 * XeTeX features, as a font's declaration loads it with them, such as `mapping=tex-text`, which
 * sets `--` as an en dash and quotes as curly ones as TeX's own fonts do, or `+smcp`. They go
 * inside the declaration's quotes after a colon, so they hold none of `[`, `]`, `"` or `:`, and
 * nothing else TeX would read as syntax either: letters, digits, `=`, `;`, `+`, `-`, `.` and `_`.
 */
const FontFeatures = z
  .string()
  .regex(
    /^[A-Za-z0-9=;+._-]+$/,
    "font features are letters, digits, =, ;, +, -, . and _, as XeTeX's feature syntax has them",
  );

/**
 * A shape's font: a file of the tree, or a file and the XeTeX features this shape alone loads it
 * with, after its family's (decision 0023), as a family's small capitals load its upright file
 * with `+smcp`.
 */
const FontShape = z.union([
  FontFile,
  z.strictObject({ file: FontFile, features: FontFeatures.optional() }),
]);
export type FontShape = z.infer<typeof FontShape>;

/** A decimal factor, as fontspec's `Scale` and `WordSpace` take one. */
const Factor = z.number().min(-100).max(100);

/**
 * What fontspec does to a font as it loads it besides its features (decision 0023): `WordSpace`,
 * which scales the space, its stretch and its shrink, `\fontdimen` 2, 3 and 4; `PunctuationSpace`,
 * which sets the space after a sentence, `\fontdimen7`, as a factor of the space's or its own; and
 * `HyphenChar`, the character TeX hyphenates with, -1 for none. Numbers only, which the generator
 * writes as the code `\DeclareFontShape` runs after it loads the font.
 */
const FontAdjust = z.strictObject({
  wordSpace: z.tuple([Factor, Factor, Factor]).optional(),
  punctuationSpace: z
    .strictObject({ factor: Factor, of: z.enum(["space", "punctuation"]) })
    .optional(),
  hyphenChar: z.number().int().min(-1).max(0x10ffff).optional(),
});
export type FontAdjust = z.infer<typeof FontAdjust>;

/**
 * One family of a XeTeX package's fonts (decision 0014): its NFSS name, which may hold a hyphen as
 * fontspec's `NFSSFamily` names may (decision 0023), the file each shape is
 * set from, and the XeTeX features every shape loads with (`FontFeatures`); for an import, as
 * fontspec loaded them (decision 0023), the features a shape loads with besides (`FontShape`), the
 * scale every shape is loaded at, and what fontspec does to each as it loads it (`FontAdjust`).
 */
const FontFamily = z.strictObject({
  family: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9-]*$/, "a font family is letters, digits and -, from a letter"),
  shapes: z
    .record(ShapeKey, FontShape)
    .refine((shapes) => Object.keys(shapes).length > 0, "a font family has at least one shape"),
  features: FontFeatures.optional(),
  scale: z.number().positive().max(10).optional(),
  adjust: FontAdjust.optional(),
});
export type FontFamily = z.infer<typeof FontFamily>;

/** A shape's file. */
export const shapeFile = (shape: FontShape): string =>
  typeof shape === "string" ? shape : shape.file;

/**
 * The XeTeX features a shape of a family loads its file with: the family's, then the shape's own,
 * joined by `;`; undefined when neither has any, so that a package that declares none is as it was.
 */
export function shapeFeatures(family: FontFamily, shape: FontShape): string | undefined {
  const own = typeof shape === "string" ? undefined : shape.features;
  const parts = [family.features, own].flatMap((each) =>
    each === undefined ? [] : [each.replace(/;+$/, "")],
  );
  return parts.length === 0 ? undefined : parts.join(";");
}

/** A package id is a model id that the engine also takes as a format name. */
const PackageId = z
  .string()
  .refine(
    (id) => Id.safeParse(id).success && isFormatName(id),
    "a package id is 1 to 64 lowercase letters, digits, - or _, starting with a letter or digit, not stock",
  );

export const TemplatePackage = z
  .strictObject({
    version: z.literal(1),
    /**
     * Names the template's formats, and the folder a curated package is written in, so the engine
     * must take it as a format name: it starts with a letter or digit, and it is not `stock`.
     */
    id: PackageId,
    name: z.string(),
    engine: Engine,
    /** Where the template came from, and the licence and attribution a port keeps. */
    source: z.strictObject({ url: z.string(), license: z.string(), attribution: z.string() }),
    /** Class and style files the preamble loads, by plain file name, as text. */
    files: z
      .record(z.string(), z.string())
      .superRefine((files, ctx) => {
        for (const name of Object.keys(files))
          if (!isFileName(name))
            ctx.addIssue({
              code: "custom",
              message: `not a plain file name: ${name}`,
              path: [name],
            });
      })
      .default({}),
    /**
     * A XeTeX package's fonts, each family's shapes by file, which the generator declares after
     * the preamble (decision 0014). A pdfTeX package has none: its fonts come from TeX Live's maps.
     */
    fonts: z.array(FontFamily).optional(),
    /** Everything before `\begin{document}`, dumped as the format. */
    preamble: Snippet,
    controls: Controls,
    snippets: Snippets,
  })
  .superRefine((pkg, ctx) => {
    const check = (source: string | undefined, slots: Slots, path: PropertyKey[]) => {
      if (source === undefined) return;
      let nodes: SnippetNode[];
      try {
        nodes = parseSnippet(source);
      } catch (error) {
        if (error instanceof SnippetError) return; // Snippet has reported it.
        throw error;
      }
      for (const message of [...checkSnippet(nodes, slots), ...checkAddresses(source, slots)])
        ctx.addIssue({ code: "custom", message, path });
    };
    const checkEach = (
      sources: Readonly<Record<string, string | undefined>>,
      slots: Slots,
      path: PropertyKey[],
    ) => {
      for (const [key, source] of Object.entries(sources)) check(source, slots, [...path, key]);
    };
    const checkByRole = (value: ByRole<string>, slots: Slots, path: PropertyKey[]) => {
      if (typeof value === "string") check(value, slots, path);
      else checkEach(value, slots, path);
    };

    if (pkg.fonts !== undefined) {
      if (pkg.engine !== "xetex")
        ctx.addIssue({
          code: "custom",
          message: "only a XeTeX package declares its fonts by file",
          path: ["fonts"],
        });
      const families = new Set<string>();
      pkg.fonts.forEach(({ family }, i) => {
        if (families.has(family))
          ctx.addIssue({
            code: "custom",
            message: `the font family ${family} is declared twice`,
            path: ["fonts", i, "family"],
          });
        families.add(family);
      });
    }

    const { controls, snippets } = pkg;
    const formatBound: Record<string, SlotType> = {};
    for (const [id, control] of Object.entries(controls))
      if (control && "format" in control && control.format) formatBound[id] = "text";
    check(pkg.preamble, formatBound, ["preamble"]);

    checkEach(controls.pageSize?.apply ?? {}, {}, ["controls", "pageSize", "apply"]);
    check(controls.margins?.apply, VALUE_SLOTS, ["controls", "margins", "apply"]);
    check(controls.fontSize?.apply, VALUE_SLOTS, ["controls", "fontSize", "apply"]);
    check(controls.accent?.apply, VALUE_SLOTS, ["controls", "accent", "apply"]);
    checkEach(controls.density?.apply ?? {}, {}, ["controls", "density", "apply"]);
    if (controls.font) {
      const ids = new Set<string>();
      controls.font.choices.forEach((choice, i) => {
        check(choice.apply, {}, ["controls", "font", "choices", i, "apply"]);
        if (ids.has(choice.id))
          ctx.addIssue({
            code: "custom",
            message: `the font id ${choice.id} is already used by another choice`,
            path: ["controls", "font", "choices", i, "id"],
          });
        ids.add(choice.id);
      });
      if (!ids.has(controls.font.default))
        ctx.addIssue({
          code: "custom",
          message: `the default font ${controls.font.default} is not one of the choices`,
          path: ["controls", "font", "default"],
        });
    }

    check(snippets.document, DOCUMENT_SLOTS, ["snippets", "document"]);
    check(snippets.header, HEADER_SLOTS, ["snippets", "header"]);
    checkEach(snippets.contact ?? {}, CONTACT_SLOTS, ["snippets", "contact"]);
    checkEach(snippets.link, LINK_SLOTS, ["snippets", "link"]);
    for (const kind of SECTION_KINDS)
      checkByRole(snippets.section[kind], SECTION_SLOTS[kind], ["snippets", "section", kind]);
    checkByRole(snippets.entry, ENTRY_SLOTS, ["snippets", "entry"]);
    checkByRole(snippets.bullet, BULLET_SLOTS, ["snippets", "bullet"]);
    checkByRole(snippets.item, ITEM_SLOTS, ["snippets", "item"]);
    checkByRole(snippets.labelledItem, LABELLED_ITEM_SLOTS, ["snippets", "labelledItem"]);
  });
export type TemplatePackage = z.infer<typeof TemplatePackage>;

/** Read a package, or throw Zod's error, which lists every problem with its path. */
export const parsePackage = (value: unknown): TemplatePackage => TemplatePackage.parse(value);

/**
 * Every font file a XeTeX package's `fonts` section names, each once, in the order the families
 * and their shapes name them; none for a package without the section.
 */
export function fontFiles(pkg: TemplatePackage): string[] {
  return [
    ...new Set((pkg.fonts ?? []).flatMap(({ shapes }) => Object.values(shapes).map(shapeFile))),
  ];
}

/**
 * The XeTeX features each font file of a package's `fonts` section is loaded with, by the file's
 * name: every way its shapes load it, its family's features and its shape's (`shapeFeatures`), or
 * none, once each, in the order of the families and their shapes. A family's upright and its small
 * capitals load one file two ways, as `` and `+smcp`, which the page tells apart by the glyphs a
 * font sets (`DrawOptions.features`, decision 0023).
 */
export function fontFeatures(pkg: TemplatePackage): Map<string, string[]> {
  const features = new Map<string, string[]>();
  for (const family of pkg.fonts ?? [])
    for (const shape of Object.values(family.shapes)) {
      const ways = features.get(shapeFile(shape)) ?? [];
      const way = shapeFeatures(family, shape) ?? "";
      if (!ways.includes(way)) ways.push(way);
      features.set(shapeFile(shape), ways);
    }
  return features;
}

/** A document's choices for its package's controls. A choice left out is the package default. */
export const ControlValues = z.strictObject({
  pageSize: PageSize.optional(),
  margins: Margin.optional(),
  fontSize: FontSize.optional(),
  font: Id.optional(),
  accent: HexColour.optional(),
  density: Density.optional(),
  dateFormat: DateFormat.optional(),
} satisfies Record<keyof Controls, z.ZodType>);
export type ControlValues = z.infer<typeof ControlValues>;

/** The regions that print on US Letter, from CLDR's paper-size data; the rest use A4. */
const LETTER_REGIONS = new Set([
  "BZ",
  "CA",
  "CL",
  "CO",
  "CR",
  "GT",
  "MX",
  "NI",
  "PA",
  "PH",
  "PR",
  "SV",
  "US",
  "VE",
]);

/**
 * The page size a locale implies, which plan section 5.4 makes a new document's default: the
 * browser's `navigator.language`, filled out to a region and looked up in CLDR's paper sizes. A
 * locale that cannot be read gets A4, as most of the world does.
 */
export function pageSizeFor(locale: string): PageSize {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region !== undefined && LETTER_REGIONS.has(region) ? "letter" : "a4";
  } catch {
    return "a4";
  }
}

/**
 * The choices a new document starts with: the default of each control the package offers, and of
 * the date format, which is "MMM yyyy" when the package sets none. The page size follows the
 * locale instead when one is given, as plan section 5.4 rules. Controls the package does not offer
 * stay absent.
 */
export function defaultControls(
  pkg: TemplatePackage,
  locale?: string,
): ControlValues & { dateFormat: DateFormat } {
  const { pageSize, margins, fontSize, font, accent, density, dateFormat } = pkg.controls;
  return {
    ...(pageSize && { pageSize: locale === undefined ? pageSize.default : pageSizeFor(locale) }),
    ...(margins && { margins: margins.default }),
    ...(fontSize && { fontSize: fontSize.default }),
    ...(font && { font: font.default }),
    ...(accent && { accent: accent.default }),
    ...(density && { density: density.default }),
    dateFormat: dateFormat?.default ?? "MMM yyyy",
  };
}

/**
 * The schema for a document's choices under one package, which refuses a choice for a control
 * the package does not offer and a font it does not list. The date format is always allowed.
 */
export function controlValuesFor(pkg: TemplatePackage) {
  const offered = new Set(
    Object.entries(pkg.controls).flatMap(([name, control]) => (control ? [name] : [])),
  );
  const fonts = pkg.controls.font?.choices.map((choice) => choice.id) ?? [];
  return ControlValues.superRefine((values, ctx) => {
    for (const [name, value] of Object.entries(values))
      if (value !== undefined && name !== "dateFormat" && !offered.has(name))
        ctx.addIssue({
          code: "custom",
          message: `the template has no ${name} control`,
          path: [name],
        });
    if (values.font !== undefined && offered.has("font") && !fonts.includes(values.font))
      ctx.addIssue({
        code: "custom",
        message: `${values.font} is not one of the template's fonts`,
        path: ["font"],
      });
  });
}
