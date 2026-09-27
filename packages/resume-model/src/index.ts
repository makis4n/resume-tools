import { z } from "zod";

/**
 * The canonical resume model, version 1: the one structure every resume is stored in, whatever
 * template it uses. Decision 0006 settles it, and docs/editor-plan.md section 5.2 says why
 * there is one.
 *
 * It checks structure, not content. Any text may be empty, because an edit passes through the
 * empty string on its way to anything else, so only ids, dates and kinds are constrained. Its
 * objects are strict: a document with a field this version does not know is refused rather than
 * read with the field dropped, so an older editor never saves a newer document without part of it.
 *
 * Every node a field lives on has an id, unique across the document, and a field is named by its
 * node's id and its own name: `<entry id>.title`, `<bullet id>.text`, and `header.first` and so on
 * for the header, whose field names no node shares. The name travels in the page's markers, and
 * survives a reorder because the id moves with its node.
 *
 * `extras` on the header, a section or an entry hold what an imported template has and this model
 * lacks, such as a photo, a skill rating, an icon or an argument the editor cannot mark: LaTeX from
 * the user's own upload, which a snippet writes back as it is through an extras slot. A `locked`
 * section holds a part of an imported resume the model has no place for, as LaTeX the generator
 * writes where the section sits. Neither is typed by the user, and neither is a field (decision
 * 0025).
 */

/**
 * A node's id. It travels inside a `\special`, so it keeps to characters that need no escaping,
 * and it is lowercase: a template may set a field in `\MakeUppercase`, which uppercases the
 * marker's text too, and lowercase ids let the page read markers case-insensitively.
 */
export const Id = z
  .string()
  .regex(/^[a-z0-9_-]{1,64}$/, "an id is 1 to 64 lowercase letters, digits, - or _");
export type Id = z.infer<typeof Id>;

/**
 * A date as ISO 8601 writes one to reduced precision: `YYYY-MM`, which is what
 * `<input type="month">` reads and writes, or `YYYY` when only the year matters. It is never
 * prose, so the date format control can format it without parsing.
 */
export const YearMonth = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "a date is YYYY or YYYY-MM");
export type YearMonth = z.infer<typeof YearMonth>;

/** `end: "present"` means ongoing, and `start` alone is a single date, such as an award's. */
export const Dates = z.strictObject({
  start: YearMonth,
  end: z.union([YearMonth, z.literal("present")]).optional(),
});
export type Dates = z.infer<typeof Dates>;

/** A run of text with one set of marks. An `href` makes it a link, and the generator escapes it. */
export const Run = z.strictObject({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z.string().optional(),
});
export type Run = z.infer<typeof Run>;

export const RichText = z.array(Run);
export type RichText = z.infer<typeof RichText>;

export const Bullet = z.strictObject({ id: Id, text: RichText });
export type Bullet = z.infer<typeof Bullet>;

export const Item = z.strictObject({ id: Id, text: RichText });
export type Item = z.infer<typeof Item>;

/** An item with a label before it, such as a kind of skill and the skills. */
export const LabelledItem = z.strictObject({ id: Id, label: z.string(), text: RichText });
export type LabelledItem = z.infer<typeof LabelledItem>;

/**
 * The key an extra is kept under: a lowercase letter, then up to 31 lowercase letters, digits and
 * dashes, as a snippet names it in an extras slot, `{{&x.<key>}}`.
 */
export const ExtraKey = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,31}$/,
    "an extra's key is a lowercase letter, then up to 31 lowercase letters, digits or -",
  );
export type ExtraKey = z.infer<typeof ExtraKey>;

/** The most characters a locked section's LaTeX, or one extra, may hold. */
export const MAX_KEPT_LATEX = 65_536;

/**
 * The editor's own LaTeX, which only the generator writes: the macros of its prelude, `\rtfield`,
 * `\rtlocked` and those under `\rt@`, and the texts of the specials the page reads as its markers, a
 * field's begin, end and paragraph markers and a locked part's, in any case, as the page reads them.
 */
const EDITOR_MACRO = /\\rt(?:field|locked)(?![A-Za-z])|\\rt@/;
const EDITOR_MARKER = /rt:[bepl]:/i;

/**
 * Whether LaTeX's braces balance as TeX reads a macro's argument: each `{` closed by a later `}`,
 * where a brace after a backslash is a control symbol, `\{` or `\}`, and a comment, from a `%` no
 * backslash escapes to the end of its line, is not read. One pass, so it costs the text's length.
 */
function balanced(latex: string): boolean {
  const lineEnd = (char: string | undefined) => char === "\n" || char === "\r";
  let depth = 0;
  for (let at = 0; at < latex.length; at++) {
    const char = latex[at];
    if (char === "\\") at++;
    else if (char === "%") while (at + 1 < latex.length && !lineEnd(latex[at + 1])) at++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * LaTeX kept byte for byte from the user's own upload, which the generator writes as it is, never
 * escaped: a locked section's, or an extra's. It never holds the editor's own macros or marker
 * texts, which would give the page a field or a locked part the model does not have, and its braces
 * balance as TeX reads an argument, since the generator writes it inside one, as `\rtlocked`'s or a
 * template macro's. What else TeX cannot take in an argument, such as `\verb`, stops the compile,
 * which the import's checks see (decision 0025).
 */
export const KeptLatex = z
  .string()
  .max(MAX_KEPT_LATEX, `kept LaTeX is at most ${MAX_KEPT_LATEX} characters`)
  .refine(
    (latex) => !EDITOR_MACRO.test(latex) && !EDITOR_MARKER.test(latex),
    "kept LaTeX holds the editor's own macros or markers, which only the generator writes",
  )
  .refine(balanced, "kept LaTeX's braces do not balance as TeX reads an argument");
export type KeptLatex = z.infer<typeof KeptLatex>;

/**
 * What an imported template has and the model lacks, on the header, a section or an entry: LaTeX
 * kept from the upload under a key, which a snippet writes back through an extras slot.
 */
export const Extras = z.record(ExtraKey, KeptLatex);
export type Extras = z.infer<typeof Extras>;

export const Entry = z.strictObject({
  id: Id,
  title: z.string(),
  subtitle: z.string().optional(),
  place: z.string().optional(),
  dates: Dates.optional(),
  bullets: z.array(Bullet),
  extras: Extras.optional(),
});
export type Entry = z.infer<typeof Entry>;

/**
 * A section's kind fixes the shape of its data, so a section never changes shape under the user.
 * Its role says what the section is about, and is only a hint a package may use to pick a variant
 * snippet: Jake's Resume sets projects with `\resumeProjectHeading` and every other entry with
 * `\resumeSubheading`, on the same entry shape. These are the kinds a package sets through a
 * snippet of its own and a user can add; the fifth, `locked`, only an import makes (`LockedSection`).
 */
export const SECTION_KINDS = ["entries", "list", "labelled", "paragraph"] as const;
export const SectionKind = z.enum(SECTION_KINDS);
export type SectionKind = z.infer<typeof SectionKind>;

export const SECTION_ROLES = [
  "summary",
  "experience",
  "education",
  "projects",
  "skills",
  "awards",
  "publications",
  "languages",
  "other",
] as const;
export const SectionRole = z.enum(SECTION_ROLES);
export type SectionRole = z.infer<typeof SectionRole>;

const sectionBase = { id: Id, title: z.string(), role: SectionRole, extras: Extras.optional() };

/**
 * A part of an imported resume the model has no place for, kept as the user's own upload had it:
 * LaTeX the generator writes where the section sits, between two lock markers the page reads, and
 * never escapes (decision 0025). Nothing in it is a field, so it has no title and its role is
 * `other`, which it keeps; the side panel moves and removes it, and nothing else changes it.
 */
export const LockedSection = z.strictObject({
  kind: z.literal("locked"),
  id: Id,
  title: z.literal(""),
  role: z.literal("other"),
  latex: KeptLatex,
  extras: Extras.optional(),
});
export type LockedSection = z.infer<typeof LockedSection>;

export const Section = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entries"), ...sectionBase, entries: z.array(Entry) }),
  z.strictObject({ kind: z.literal("list"), ...sectionBase, items: z.array(Item) }),
  z.strictObject({ kind: z.literal("labelled"), ...sectionBase, items: z.array(LabelledItem) }),
  z.strictObject({ kind: z.literal("paragraph"), ...sectionBase, text: RichText }),
  LockedSection,
]);
export type Section = z.infer<typeof Section>;

/** A link's kind lets a template pick an icon for it. A template without icons ignores it. */
export const LINK_KINDS = ["website", "linkedin", "github", "twitter", "orcid", "other"] as const;
export const LinkKind = z.enum(LINK_KINDS);
export type LinkKind = z.infer<typeof LinkKind>;

export const Link = z.strictObject({ id: Id, kind: LinkKind, label: z.string(), href: z.string() });
export type Link = z.infer<typeof Link>;

/**
 * The name is stored split, because Awesome-CV takes it as two arguments, and joining two parts
 * is trivial where splitting one is not. `last` may be empty.
 */
export const Name = z.strictObject({ first: z.string(), last: z.string() });
export type Name = z.infer<typeof Name>;

export const Header = z.strictObject({
  name: Name,
  headline: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  links: z.array(Link),
  extras: Extras.optional(),
});
export type Header = z.infer<typeof Header>;

export const Resume = z
  .strictObject({
    version: z.literal(1),
    header: Header,
    sections: z.array(Section),
  })
  .superRefine((resume, ctx) => {
    // A field is named by its node's id, so an id is unique across the document, not per list.
    const seen = new Set<string>();
    const visit = (id: string, path: (string | number)[]) => {
      if (seen.has(id))
        ctx.addIssue({
          code: "custom",
          message: `the id ${id} is already used by another node`,
          path: [...path, "id"],
        });
      seen.add(id);
    };
    resume.header.links.forEach((link, l) => visit(link.id, ["header", "links", l]));
    resume.sections.forEach((section, s) => {
      visit(section.id, ["sections", s]);
      if (section.kind === "entries") {
        section.entries.forEach((entry, e) => {
          visit(entry.id, ["sections", s, "entries", e]);
          entry.bullets.forEach((bullet, b) =>
            visit(bullet.id, ["sections", s, "entries", e, "bullets", b]),
          );
        });
      } else if (section.kind === "list" || section.kind === "labelled") {
        section.items.forEach((item, i) => visit(item.id, ["sections", s, "items", i]));
      }
    });
  });
export type Resume = z.infer<typeof Resume>;
