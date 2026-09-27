/**
 * The naming answer (milestone 3 item 6, plan section 6 step 4, decision 0024): what the naming
 * step says of each template macro and environment a request describes, and of the preamble's
 * settings, which item 7 assembles a package from. Per macro: what kind of thing it sets, what each
 * argument means and which of the model's slots it fills (decision 0006's slot names), whether it
 * is a unit the user may add and remove and what a blank one is, which macro closes a list it
 * opens, and a section role where its meaning implies one. For the preamble: which settings are
 * the style controls' parameters, and how each is set.
 *
 * The model's answer (`ModelAnswer`) is words from these lists and nothing else: it never writes
 * LaTeX. A person's reviewed answer (`ReviewedAnswer`) may carry redefinitions, LaTeX a person
 * wrote that redefines or adds macros after the document class, so that a macro that defeats the
 * editor's markers gets the fix its port has, provided it keeps upstream's output. A stored
 * answer is the cache's entry, by the macro's key.
 */

import { LinkKind, SectionRole } from "@resume-tools/resume-model";
import { z } from "zod";
import { NAMING_VERSION } from "./key.ts";
import { FamilyHint, Hash, MacroName, REQUEST_CAPS } from "./request.ts";

/**
 * What a macro or an environment sets: an entry, a section's title, a bullet (an entry's, or a
 * list's item), a list of bullets, the header or part of it, a contact, a link, a labelled item,
 * a paragraph, layout that sets no text of the resume's, or something the model has no place for,
 * which item 7 keeps as an extra.
 */
export const MACRO_KINDS = [
  "entry",
  "section",
  "bullet",
  "bulletList",
  "header",
  "contact",
  "link",
  "labelledItem",
  "paragraph",
  "layout",
  "other",
] as const;
export const MacroKind = z.enum(MACRO_KINDS);
export type MacroKind = z.infer<typeof MacroKind>;

/**
 * What an argument is: text of the resume's, by its role, a title, a subtitle, a place, dates,
 * running text or a label; or not text: an address a link goes to, an icon, a colour, a length, a
 * key the class reads, or something else.
 */
export const MEANINGS = [
  "title",
  "subtitle",
  "place",
  "dates",
  "text",
  "label",
  "address",
  "icon",
  "colour",
  "length",
  "key",
  "other",
] as const;
export const Meaning = z.enum(MEANINGS);
export type Meaning = z.infer<typeof Meaning>;

/**
 * The model's slots each kind's arguments may fill, decision 0006's names for the snippet the
 * kind maps to: an entry's, a section's title and content, a bullet's text, the header's, a
 * contact's and a link's, a labelled item's, a paragraph's. Layout and other fill none.
 */
export const SLOTS_BY_KIND = {
  entry: ["title", "subtitle", "place", "dates", "bullets"],
  section: ["title", "entries", "items", "text"],
  bullet: ["text"],
  bulletList: ["bullets"],
  header: ["first", "last", "headline", "email", "phone", "location", "links", "contacts"],
  contact: ["text", "href"],
  link: ["label", "href"],
  labelledItem: ["label", "text"],
  paragraph: ["text"],
  layout: [],
  other: [],
} as const satisfies Record<MacroKind, readonly string[]>;

/** Every slot any kind has. */
export const SLOTS = [...new Set(Object.values(SLOTS_BY_KIND).flat())] as [string, ...string[]];
export const Slot = z.enum(SLOTS);
export type Slot = z.infer<typeof Slot>;

/** The contact fields of the model's header, which a contact sets. */
export const CONTACT_FIELDS = ["email", "phone", "location"] as const;

/**
 * What an argument is in a blank unit, one the user adds: given and empty, left out (an optional
 * argument), or kept as the document's first call gives it (an icon, a length, a key).
 */
export const BLANKS = ["empty", "absent", "kept"] as const;

/** What a list holds: the model's units, by kind. */
export const HOLDS = ["entry", "bullet", "labelledItem", "contact", "link", "section"] as const;

/** A part of an argument: one paragraph of text inside it, as a projects heading holds two. */
export const ArgumentPart = z.strictObject({
  meaning: Meaning,
  slot: Slot.optional(),
});
export type ArgumentPart = z.infer<typeof ArgumentPart>;

/**
 * What one argument means, by its place in the signature, from 1 as the request numbers it; the
 * slot it fills, if any; the paragraphs it holds, in order, when it holds more than one, each with
 * its own meaning and slot; and what it is in a blank unit.
 */
export const ArgumentAnswer = z.strictObject({
  index: z.int().min(1).max(REQUEST_CAPS.arguments),
  meaning: Meaning,
  slot: Slot.optional(),
  parts: z.array(ArgumentPart).max(8).optional(),
  blank: z.enum(BLANKS).optional(),
});
export type ArgumentAnswer = z.infer<typeof ArgumentAnswer>;

/**
 * A list a macro opens or closes: for one that opens it, the macro that closes it, which an
 * environment's `\end` is, and what it holds; for one that closes it, the macro that opened it.
 */
export const ListAnswer = z.strictObject({
  does: z.enum(["opens", "closes"]),
  closedBy: MacroName.optional(),
  openedBy: MacroName.optional(),
  holds: z.enum(HOLDS).optional(),
});
export type ListAnswer = z.infer<typeof ListAnswer>;

/**
 * Another mapping of the arguments in sections of one role, as Jake's Resume swaps an entry's
 * dates and place in its education section.
 */
export const Variant = z.strictObject({
  role: SectionRole,
  arguments: z.array(ArgumentAnswer).max(REQUEST_CAPS.arguments),
});
export type Variant = z.infer<typeof Variant>;

/** The fields of an answer, the model's and a person's alike. */
const answerFields = {
  kind: MacroKind,
  arguments: z.array(ArgumentAnswer).max(REQUEST_CAPS.arguments),
  /** A unit the user may add and remove: an entry, a bullet, a section, a link, a labelled item. */
  repeatable: z.boolean(),
  /** Whether a blank unit is left off the page, as a tag whose empty frame would show. */
  omitWhenBlank: z.boolean().optional(),
  list: ListAnswer.optional(),
  /** The section role its meaning implies, where it implies one: an awards list's, a projects heading's. */
  role: SectionRole.optional(),
  /** For a contact, the header's field it sets. */
  contact: z.enum(CONTACT_FIELDS).optional(),
  /** For a link, its kind, which picks its icon. */
  link: LinkKind.optional(),
  variants: z.array(Variant).max(8).optional(),
};

type AnswerFields = {
  kind: MacroKind;
  arguments: ArgumentAnswer[];
  contact?: string | undefined;
  link?: string | undefined;
  list?: ListAnswer | undefined;
  variants?: Variant[] | undefined;
};

/** The checks both kinds of answer take: slots the kind has, each once, and fields that fit it. */
function checkAnswer(answer: AnswerFields, ctx: z.core.$RefinementCtx) {
  const slots: readonly string[] = SLOTS_BY_KIND[answer.kind];
  const checkArguments = (list: readonly ArgumentAnswer[], path: (string | number)[]) => {
    const used = new Set<string>();
    let last = 0;
    list.forEach((argument, a) => {
      if (argument.index <= last)
        ctx.addIssue({
          code: "custom",
          message: "arguments come once each, in the signature's order",
          path: [...path, a, "index"],
        });
      last = argument.index;
      const fills = [argument.slot, ...(argument.parts ?? []).map((part) => part.slot)];
      fills.forEach((slot, s) => {
        if (slot === undefined) return;
        const where = s === 0 ? [...path, a, "slot"] : [...path, a, "parts", s - 1, "slot"];
        if (!slots.includes(slot))
          ctx.addIssue({
            code: "custom",
            message: `a ${answer.kind} has no slot ${slot}`,
            path: where,
          });
        else if (used.has(slot))
          ctx.addIssue({
            code: "custom",
            message: `the slot ${slot} is filled twice`,
            path: where,
          });
        used.add(slot);
      });
    });
  };
  checkArguments(answer.arguments, ["arguments"]);
  const roles = new Set<string>();
  (answer.variants ?? []).forEach((variant, v) => {
    if (roles.has(variant.role))
      ctx.addIssue({
        code: "custom",
        message: "a role has one variant",
        path: ["variants", v, "role"],
      });
    roles.add(variant.role);
    checkArguments(variant.arguments, ["variants", v, "arguments"]);
  });
  if (answer.contact !== undefined && answer.kind !== "contact")
    ctx.addIssue({ code: "custom", message: "only a contact names its field", path: ["contact"] });
  if (answer.link !== undefined && answer.kind !== "link")
    ctx.addIssue({ code: "custom", message: "only a link names its kind", path: ["link"] });
  const list = answer.list;
  if (list !== undefined) {
    if (list.does === "closes" && (list.closedBy !== undefined || list.holds !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "a macro that closes a list names what opened it, and nothing else",
        path: ["list"],
      });
    if (list.does === "opens" && list.openedBy !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "a macro that opens a list names what closes it",
        path: ["list", "openedBy"],
      });
  }
}

/**
 * What the model may answer for a macro: words from the lists above, and never LaTeX. It refuses
 * `reviewed` and `redefinitions`, which only a person gives.
 */
export const ModelAnswer = z.strictObject(answerFields).superRefine(checkAnswer);
export type ModelAnswer = z.infer<typeof ModelAnswer>;

/**
 * A redefinition: LaTeX a person wrote, applied after the document class, that redefines the
 * template's macro `name` by name, or adds one it needs, and keeps upstream's output, as the
 * reference check proves on every document (item 7).
 */
export const Redefinition = z.strictObject({
  name: MacroName,
  latex: z.string().min(1).max(65_536),
});
export type Redefinition = z.infer<typeof Redefinition>;

/** A person's answer: the model's fields, reviewed, with any redefinitions and notes. */
export const ReviewedAnswer = z
  .strictObject({
    ...answerFields,
    reviewed: z.literal(true),
    redefinitions: z.array(Redefinition).max(16).optional(),
    notes: z.string().max(4000).optional(),
  })
  .superRefine(checkAnswer);
export type ReviewedAnswer = z.infer<typeof ReviewedAnswer>;

/** Where an answer came from: the committed seed, or a model by its id. */
export const AnswerSource = z
  .string()
  .regex(/^(?:seed|model:[A-Za-z0-9._:/@-]{1,128})$/, 'a source is "seed" or "model:<id>"');
export type AnswerSource = z.infer<typeof AnswerSource>;

/**
 * An answer as the cache stores it, by the macro's key: the naming version and the key it was
 * given under, the macro's own hash, its name and whether a command or an environment, the family
 * it came from, the answer, whether a person reviewed it, and where it came from. The committed
 * answers are files of it, `corpus/answers/<key>.json`.
 */
export const StoredAnswer = z
  .strictObject({
    version: z.literal(NAMING_VERSION),
    key: Hash,
    hash: Hash,
    of: z.enum(["command", "environment"]),
    name: MacroName,
    family: FamilyHint.optional(),
    answer: z.union([ReviewedAnswer, ModelAnswer]),
    reviewed: z.boolean(),
    source: AnswerSource,
  })
  .superRefine((stored, ctx) => {
    if (stored.reviewed !== "reviewed" in stored.answer)
      ctx.addIssue({
        code: "custom",
        message: "an answer is reviewed exactly when a person's answer is stored",
        path: ["reviewed"],
      });
    if (stored.source === "seed" && !stored.reviewed)
      ctx.addIssue({
        code: "custom",
        message: "the seed's answers are reviewed",
        path: ["reviewed"],
      });
  });
export type StoredAnswer = z.infer<typeof StoredAnswer>;

/** The style controls' parameters an import may find in its preamble (decision 0006). */
export const STYLE_PARAMETERS = [
  "pageSize",
  "margins",
  "fontSize",
  "font",
  "accent",
  "density",
] as const;

/**
 * How the preamble sets one style parameter: the request's setting that sets it, by its index,
 * or the class's options when there is none; the command, without its backslash; and the key,
 * option or name inside it, where one does, so that item 7 can write the control's snippet.
 */
export const StyleSetting = z.strictObject({
  parameter: z.enum(STYLE_PARAMETERS),
  setting: z.int().min(0).max(REQUEST_CAPS.settings).optional(),
  command: z.string().regex(/^[A-Za-z@]{1,64}$/, "a command's name, without its backslash"),
  key: z.string().min(1).max(256).optional(),
});
export type StyleSetting = z.infer<typeof StyleSetting>;

/** What the preamble's settings are: the style parameters found, and how each is set. */
export const PreambleAnswer = z.strictObject({
  parameters: z.array(StyleSetting).max(32),
});
export type PreambleAnswer = z.infer<typeof PreambleAnswer>;

/**
 * What the model answers for a whole request, which item 9 asks for as structured output: an
 * answer for each macro, by name, and the preamble's settings.
 */
export const ModelNaming = z.strictObject({
  macros: z
    .array(
      z.strictObject({
        of: z.enum(["command", "environment"]),
        name: MacroName,
        answer: ModelAnswer,
      }),
    )
    .max(REQUEST_CAPS.macros),
  preamble: PreambleAnswer,
});
export type ModelNaming = z.infer<typeof ModelNaming>;

/**
 * The answer to a request, which item 7 assembles from: the stored answer of each macro that has
 * a key, from the cache or the model, and the preamble's settings.
 */
export const NamingAnswer = z.strictObject({
  version: z.literal(NAMING_VERSION),
  macros: z.array(StoredAnswer).max(REQUEST_CAPS.macros),
  preamble: PreambleAnswer,
});
export type NamingAnswer = z.infer<typeof NamingAnswer>;
