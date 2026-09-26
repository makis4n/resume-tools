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
 * lacks, such as a photo, a skill rating or an icon. They are kept so nothing is lost on import,
 * and never typeset, until the import pipeline needs them.
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

export const Extras = z.record(z.string(), z.unknown());
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
 * `\resumeSubheading`, on the same entry shape.
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

export const Section = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entries"), ...sectionBase, entries: z.array(Entry) }),
  z.strictObject({ kind: z.literal("list"), ...sectionBase, items: z.array(Item) }),
  z.strictObject({ kind: z.literal("labelled"), ...sectionBase, items: z.array(LabelledItem) }),
  z.strictObject({ kind: z.literal("paragraph"), ...sectionBase, text: RichText }),
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
      } else if (section.kind !== "paragraph") {
        section.items.forEach((item, i) => visit(item.id, ["sections", s, "items", i]));
      }
    });
  });
export type Resume = z.infer<typeof Resume>;
