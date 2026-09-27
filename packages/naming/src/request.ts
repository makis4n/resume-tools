/**
 * The naming request (milestone 3 item 6, plan section 6 step 4, decision 0024): what leaves the
 * browser for the naming step, one request per imported document. It describes the template, never
 * the resume: each template macro and environment the body calls, by its definition as TeX read it
 * (decision 0020), what the probe found of each argument (decision 0022), and a few of its calls
 * with every argument's text replaced by a placeholder of the same length and character class;
 * and the preamble's candidate settings, masked the same way but for numbers, units, colours and
 * known keywords. A macro that holds the person's data, as `\name{...}` stores it, goes by its name
 * alone. The schema refuses a call site that holds any letter but `x` and `X`, or any digit but
 * `0`, outside the names of commands and environments, and a signature whose defaults do, whoever
 * built it.
 */

import { z } from "zod";
import { NAMING_VERSION } from "./key.ts";
import { defaultHoldsText, holdsText, specDefaults } from "./mask.ts";

/** The engines an import compiles on. */
export const ENGINES = ["pdftex", "xetex"] as const;

/**
 * The corpus's families of template (decision 0017), but `other`: a hint a request carries when
 * its class, or its macros, say which it is, so that a reviewer can find the answers of a family.
 */
export const FAMILY_HINTS = ["jake", "awesome-cv", "altacv", "moderncv", "europecv"] as const;
export const FamilyHint = z.enum(FAMILY_HINTS);
export type FamilyHint = z.infer<typeof FamilyHint>;

/**
 * What the probe found of an argument (decision 0022): `editable`; `container`, one that holds
 * structure; or why it is locked.
 */
export const VERDICTS = [
  "editable",
  "container",
  "raw",
  "breaks",
  "vanished",
  "twice",
  "moved",
  "misaligned",
  "case",
  "split",
  "untested",
] as const;
export const Verdict = z.enum(VERDICTS);
export type Verdict = z.infer<typeof Verdict>;

/** An argument's kind in the signature: `m`, an optional one, a star, or a single token. */
export const ARGUMENT_KINDS = ["mandatory", "optional", "star", "token"] as const;

/** The request's caps, so that a service can bound what it reads. */
export const REQUEST_CAPS = {
  macros: 512,
  definitions: 8192,
  /** One definition's text, in characters. */
  definition: 1_048_576,
  /** A signature's arguments. */
  arguments: 32,
  /** Call sites per macro. */
  sites: 3,
  /** One argument's text in a call site, or an environment's body, in characters. */
  site: 4000,
  settings: 256,
  /** One setting, or one of the class's options, in characters. */
  setting: 2000,
  options: 64,
} as const;

/** A SHA-256 in lower-case hex. */
export const Hash = z.string().regex(/^[0-9a-f]{64}$/, "a hash is 64 lower-case hex digits");

/**
 * A control sequence's name as TeX printed it, without its backslash: `cventry`, `@sectioncolor`,
 * or one a macro hands its work to, such as a robust command's `cventry ` or xparse's
 * `environment cvskills code`.
 */
export const MacroName = z.string().min(1).max(256);

/**
 * A template macro's definition: its `\meaning`, masked, and the SHA-256 of that text in UTF-8,
 * which the service can check; or a macro that holds the person's data, by its name alone.
 */
export const RequestDefinition = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("definition"),
    name: MacroName,
    hash: Hash,
    text: z.string().max(REQUEST_CAPS.definition),
  }),
  z.strictObject({ kind: z.literal("data"), name: MacroName }),
]);
export type RequestDefinition = z.infer<typeof RequestDefinition>;

/** One of a macro's arguments, by its place in the signature, and what the probe found of it. */
export const RequestArgument = z.strictObject({
  /** Its place in the signature, from 1, as TeX numbers parameters: a star counts. */
  index: z.int().min(1).max(REQUEST_CAPS.arguments),
  kind: z.enum(ARGUMENT_KINDS),
  /** What the probe found of it across the body's calls, when any gave it. */
  verdict: Verdict.optional(),
  /** What its empty calls came to, where the others passed. */
  empty: Verdict.optional(),
});
export type RequestArgument = z.infer<typeof RequestArgument>;

/** A call site's text: placeholders, and the names of commands and environments. */
const SiteText = z
  .string()
  .max(REQUEST_CAPS.site)
  .refine((text) => !holdsText(text), {
    message: "a call site holds a letter other than x or X, or a digit other than 0",
  });

/**
 * One call of the macro: each argument of the signature as the call gives it, its text replaced
 * by its placeholder and a date by its shape, or null where the call leaves it out; and, for an
 * environment, the start of its body, masked the same way.
 */
export const CallSite = z.strictObject({
  arguments: z.array(SiteText.nullable()).max(REQUEST_CAPS.arguments),
  body: SiteText.optional(),
});
export type CallSite = z.infer<typeof CallSite>;

/**
 * A signature in xparse's syntax, whose defaults, `O{...}`, `D<>{...}`, `R<>{...}`, `G{...}` and
 * `E{...}{...}`'s, hold no letter but `x` and `X` and no digit but `0` outside the names of
 * commands (`defaultHoldsText`): a default is the definition's text, which may be the person's, as
 * `O{quill@example.invalid}` is, and the builder sends it as its placeholder.
 */
const Signature = z
  .string()
  .max(256)
  .refine((spec) => specDefaults(spec)?.every((each) => !defaultHoldsText(each)) === true, {
    message:
      "a signature is xparse's, and its defaults hold no letter but x or X, or digit but 0, outside the names of commands",
  });

/**
 * A template macro or environment the body calls, or the preamble calls to store the header's
 * text: its name, its signature in xparse's syntax where the engine could read it, its key, which
 * a macro that holds data has none of, its dependencies by name, each in `definitions`, the
 * probe's verdict on each argument, and up to three call sites. Its own definition is the one of
 * its name in `definitions`; an environment's is its `\begin` code, and its `\end` code is its
 * first dependency.
 */
export const RequestMacro = z.strictObject({
  of: z.enum(["command", "environment"]),
  name: MacroName,
  signature: Signature.optional(),
  key: Hash.optional(),
  dependencies: z.array(MacroName).max(REQUEST_CAPS.definitions),
  /** Whether its closure stopped at its cap, 64 definitions or 64 KB (decision 0020). */
  capped: z.boolean(),
  arguments: z.array(RequestArgument).max(REQUEST_CAPS.arguments),
  sites: z.array(CallSite).max(REQUEST_CAPS.sites),
  /** How many times the document calls it, or opens it. */
  calls: z.int().min(0),
});
export type RequestMacro = z.infer<typeof RequestMacro>;

/** A setting's text, masked. */
const SettingText = z.string().max(REQUEST_CAPS.setting);

/**
 * The preamble's candidate settings: the document class and its options, and the statements that
 * set the page's geometry, the base size, fonts, colours and spacing, each masked but for numbers,
 * units, colours, known keywords and the names of commands.
 */
export const RequestPreamble = z.strictObject({
  class: z
    .strictObject({
      name: SettingText,
      options: z.array(SettingText).max(REQUEST_CAPS.options),
    })
    .optional(),
  settings: z.array(SettingText).max(REQUEST_CAPS.settings),
});
export type RequestPreamble = z.infer<typeof RequestPreamble>;

/** A request: one document's template, as the naming step is asked about it. */
export const NamingRequest = z
  .strictObject({
    version: z.literal(NAMING_VERSION),
    engine: z.enum(ENGINES),
    family: FamilyHint.optional(),
    preamble: RequestPreamble,
    macros: z.array(RequestMacro).max(REQUEST_CAPS.macros),
    definitions: z.array(RequestDefinition).max(REQUEST_CAPS.definitions),
  })
  .superRefine((request, ctx) => {
    const defined = new Map<string, RequestDefinition>();
    request.definitions.forEach((definition, i) => {
      if (defined.has(definition.name))
        ctx.addIssue({
          code: "custom",
          message: "a definition is named twice",
          path: ["definitions", i, "name"],
        });
      defined.set(definition.name, definition);
    });
    const seen = new Set<string>();
    request.macros.forEach((macro, i) => {
      const at = (...path: (string | number)[]) => ["macros", i, ...path];
      const id = `${macro.of}|${macro.name}`;
      if (seen.has(id))
        ctx.addIssue({ code: "custom", message: "a macro is listed twice", path: at("name") });
      seen.add(id);
      const own = defined.get(macro.name);
      if (own === undefined)
        ctx.addIssue({ code: "custom", message: "a macro has no definition", path: at("name") });
      else if ((own.kind === "definition") !== (macro.key !== undefined))
        ctx.addIssue({
          code: "custom",
          message: "a macro has a key exactly when its own definition is code, not data",
          path: at("key"),
        });
      macro.dependencies.forEach((name, d) => {
        if (!defined.has(name))
          ctx.addIssue({
            code: "custom",
            message: "a dependency has no definition",
            path: at("dependencies", d),
          });
      });
      macro.arguments.forEach((argument, a) => {
        if (argument.index !== a + 1)
          ctx.addIssue({
            code: "custom",
            message: "arguments come in the signature's order, from 1",
            path: at("arguments", a, "index"),
          });
      });
      macro.sites.forEach((site, s) => {
        if (site.arguments.length !== macro.arguments.length)
          ctx.addIssue({
            code: "custom",
            message: "a call site gives each of the signature's arguments, or null",
            path: at("sites", s, "arguments"),
          });
      });
    });
  });
export type NamingRequest = z.infer<typeof NamingRequest>;
