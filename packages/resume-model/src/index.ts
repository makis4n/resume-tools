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
 * 0025). `kept` on the same nodes names the slots whose value an import keeps in the extras as the
 * upload had it, which are no fields either (decision 0026).
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
 * The commands whose first argument is an address, which hyperref's `\href` and url.sty's `\url`,
 * `\path` and `\nolinkurl` read with `%` as a character of it, where it stands outside another
 * command's argument: `\href{https://quill.example/a%20b}{...}` sets no comment.
 */
const ADDRESS_COMMAND = /\\(href|url|path|nolinkurl)(?![A-Za-z@])/y;

/**
 * Whether LaTeX's braces balance as TeX reads it: each `{` closed by a later `}`, where a brace
 * after a backslash is a control symbol, `\{` or `\}`, and a comment, from a `%` no backslash
 * escapes to the end of its line, is not read. With `addresses`, as TeX reads it where it stands
 * outside any argument: a `%` in the address of `\href`, `\url`, `\path` or `\nolinkurl`, in its
 * braces or between the pair of another character `\url|...|` takes, is a character, as those
 * commands read it. Without, as TeX reads it inside a macro's argument, which reads the address
 * before the command can, so that every such `%` begins a comment. One pass, so it costs the
 * text's length.
 */
function balanced(latex: string, addresses: boolean): boolean {
  const lineEnd = (char: string | undefined) => char === "\n" || char === "\r";
  let depth = 0;
  // The depth an address's braces close back to, while one is open; and the character that closes
  // one `\url|...|` opened.
  let address = -1;
  let delimiter: string | undefined;
  for (let at = 0; at < latex.length; at++) {
    const char = latex[at];
    if (delimiter !== undefined) {
      if (char === delimiter) delimiter = undefined;
      continue;
    }
    if (char === "\\") {
      ADDRESS_COMMAND.lastIndex = at;
      const command = addresses && address < 0 ? ADDRESS_COMMAND.exec(latex) : null;
      if (command === null) {
        at++;
        continue;
      }
      let next = ADDRESS_COMMAND.lastIndex;
      while (next < latex.length && /\s/.test(latex[next] ?? "")) next++;
      // `\href` may take its options first, in brackets.
      if (command[1] === "href" && latex[next] === "[") {
        const close = latex.indexOf("]", next);
        if (close >= 0) next = close + 1;
        while (next < latex.length && /\s/.test(latex[next] ?? "")) next++;
      }
      const opens = latex[next];
      if (opens === "{") {
        address = depth;
        depth++;
        at = next;
      } else if (opens !== undefined && command[1] !== "href" && !/[\s\\%}A-Za-z]/.test(opens)) {
        delimiter = opens;
        at = next;
      } else at = next - 1;
    } else if (char === "%" && address < 0) {
      while (at + 1 < latex.length && !lineEnd(latex[at + 1])) at++;
    } else if (char === "{") depth++;
    else if (char === "}") {
      if (--depth < 0) return false;
      if (depth === address) address = -1;
    }
  }
  return depth === 0 && delimiter === undefined;
}

/**
 * LaTeX kept byte for byte from the user's own upload, which the generator writes as it is, never
 * escaped: a locked section's, or an extra's. It never holds the editor's own macros or marker
 * texts, which would give the page a field or a locked part the model does not have, and its braces
 * balance as TeX reads it where the upload had it (`balanced`): an extra stands where its argument
 * or its part of the body stood, inside an argument or outside any, as the upload's own did, and a
 * `%` in an address read outside any argument is a character, as `\href` reads it. What else TeX
 * cannot take where the generator writes it, such as `\verb` in an argument, stops the compile,
 * which the import's checks see (decisions 0025 and 0026).
 */
export const KeptLatex = z
  .string()
  .max(MAX_KEPT_LATEX, `kept LaTeX is at most ${MAX_KEPT_LATEX} characters`)
  .refine(
    (latex) => !EDITOR_MACRO.test(latex) && !EDITOR_MARKER.test(latex),
    "kept LaTeX holds the editor's own macros or markers, which only the generator writes",
  )
  .refine((latex) => balanced(latex, true), "kept LaTeX's braces do not balance as TeX reads them");
export type KeptLatex = z.infer<typeof KeptLatex>;

/**
 * A locked section's LaTeX: kept LaTeX whose braces balance as TeX reads a macro's argument, too,
 * every `%` no backslash escapes a comment, since the generator always writes it inside one,
 * `\rtlocked`'s, where a `%` in an address would end the argument inside itself or run it on past
 * its end (decision 0025).
 */
export const LockedLatex = KeptLatex.refine(
  (latex) => balanced(latex, false),
  "a locked part's braces do not balance as TeX reads an argument",
);
export type LockedLatex = z.infer<typeof LockedLatex>;

/**
 * What an imported template has and the model lacks, on the header, a section or an entry: LaTeX
 * kept from the upload under a key, which a snippet writes back through an extras slot.
 */
export const Extras = z.record(ExtraKey, KeptLatex);
export type Extras = z.infer<typeof Extras>;

/**
 * The slots of a node an import keeps as the upload had it (decision 0026): an instance of a field
 * the probe's verdicts or the import's checks lock, whose bytes are in the node's extras, which its
 * snippet writes where the field would be; or a list its snippets cannot set, kept whole there. A
 * kept slot is no field: the generator sets nothing of the model's value for it, markers included,
 * and the editor opens nothing on it. Only the nodes that keep extras have them, the header, a
 * section and an entry: a bullet, an item or a link is kept with its list, whole. A node the user
 * adds keeps none.
 */
const keptSlots = <const T extends readonly [string, ...string[]]>(slots: T) =>
  z.array(z.enum(slots)).optional();

/** The slots an entry may keep: its fields, and its bullets' list. */
export const ENTRY_KEPT = ["title", "subtitle", "place", "dates", "bullets"] as const;
/** The slots the header may keep: its fields, and its links' list. */
export const HEADER_KEPT = [
  "first",
  "last",
  "headline",
  "email",
  "phone",
  "location",
  "links",
] as const;
/** The slots a section may keep, by its kind: its title, and what it holds. */
export const SECTION_KEPT = {
  entries: ["title", "entries"],
  list: ["title", "items"],
  labelled: ["title", "items"],
  paragraph: ["title", "text"],
} as const;

export const Entry = z.strictObject({
  id: Id,
  title: z.string(),
  subtitle: z.string().optional(),
  place: z.string().optional(),
  dates: Dates.optional(),
  bullets: z.array(Bullet),
  extras: Extras.optional(),
  kept: keptSlots(ENTRY_KEPT),
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
 * `other`, which it keeps; the side panel moves and removes it, and nothing else changes it but a
 * retype of its runs of plain text, escaped as a field's text is (decision 0042).
 */
export const LockedSection = z.strictObject({
  kind: z.literal("locked"),
  id: Id,
  title: z.literal(""),
  role: z.literal("other"),
  latex: LockedLatex,
  extras: Extras.optional(),
});
export type LockedSection = z.infer<typeof LockedSection>;

export const Section = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("entries"),
    ...sectionBase,
    entries: z.array(Entry),
    kept: keptSlots(SECTION_KEPT.entries),
  }),
  z.strictObject({
    kind: z.literal("list"),
    ...sectionBase,
    items: z.array(Item),
    kept: keptSlots(SECTION_KEPT.list),
  }),
  z.strictObject({
    kind: z.literal("labelled"),
    ...sectionBase,
    items: z.array(LabelledItem),
    kept: keptSlots(SECTION_KEPT.labelled),
  }),
  z.strictObject({
    kind: z.literal("paragraph"),
    ...sectionBase,
    text: RichText,
    kept: keptSlots(SECTION_KEPT.paragraph),
  }),
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
  kept: keptSlots(HEADER_KEPT),
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
