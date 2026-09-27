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
 * A list a macro opens or closes: for one that opens it, the macro that closes it, which a command
 * must name and an environment's `\end` is, and what it holds; for one that closes it, the macro
 * that opened it. A closer is of its opener's kind.
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
 * The check an answer takes where whether it is a command's or an environment's is known: a
 * command that opens a list names the macro that closes it, which item 7 writes after the list,
 * where an environment's `\end` closes its own.
 */
function checkList(
  of: "command" | "environment",
  answer: Pick<AnswerFields, "list">,
  ctx: z.core.$RefinementCtx,
  path: (string | number)[],
) {
  if (of === "command" && answer.list?.does === "opens" && answer.list.closedBy === undefined)
    ctx.addIssue({
      code: "custom",
      message: "a command that opens a list names the macro that closes it",
      path: [...path, "list", "closedBy"],
    });
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
 * The keys of the macros a stored answer's list names, its closer's or its opener's, as the
 * document it was answered for keys them: a key vouches for what a name cannot, since another
 * template may give the same definition another name, or the name another definition
 * (`answerFor`).
 */
export const PartnerKeys = z.strictObject({
  closedBy: Hash.optional(),
  openedBy: Hash.optional(),
});
export type PartnerKeys = z.infer<typeof PartnerKeys>;

/**
 * An answer as the cache stores it, by the macro's key: the naming version and the key it was
 * given under, the macro's own hash, its name and whether a command or an environment, the family
 * it came from, the answer, whether a person reviewed it, and where it came from; and, written by
 * `corpus seed --write` and absent from older files, the dependencies the key was computed from,
 * each its name and hash in the closure's order, an environment's `\end` first (`keyOf`), so that
 * the answer can be filed again under a new version's key, and its list's partners by their keys.
 * The committed answers are files of it, `corpus/answers/<key>.json`.
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
    dependencies: z
      .array(z.tuple([MacroName, Hash.nullable()]))
      .max(REQUEST_CAPS.definitions)
      .optional(),
    partnerKeys: PartnerKeys.optional(),
  })
  .superRefine((stored, ctx) => {
    checkList(stored.of, stored.answer, ctx, ["answer"]);
    for (const which of ["closedBy", "openedBy"] as const)
      if (stored.partnerKeys?.[which] !== undefined && stored.answer.list?.[which] === undefined)
        ctx.addIssue({
          code: "custom",
          message: "a partner's key is given for a partner the answer names",
          path: ["partnerKeys", which],
        });
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
  setting: z
    .int()
    .min(0)
    .max(REQUEST_CAPS.settings - 1)
    .optional(),
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
 * What the model answers for a whole request, which item 9 asks for as structured output: one
 * answer for each macro, by its name and whether a command or an environment, and the preamble's
 * settings. Whether each partner a list names is a macro of the request is checked where the
 * request is known, by item 9's `name` and by `corpus seed`.
 */
export const ModelNaming = z
  .strictObject({
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
  })
  .superRefine((naming, ctx) => {
    const seen = new Set<string>();
    naming.macros.forEach((macro, i) => {
      const id = `${macro.of}|${macro.name}`;
      if (seen.has(id))
        ctx.addIssue({
          code: "custom",
          message: "a macro is answered once",
          path: ["macros", i, "name"],
        });
      seen.add(id);
      checkList(macro.of, macro.answer, ctx, ["macros", i, "answer"]);
    });
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
