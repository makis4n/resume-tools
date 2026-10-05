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
 *
 * An `outline` section holds an imported `.tex` resume in its own shape instead (decision 0049):
 * kept text, the upload's LaTeX written back byte for byte; fields of plain or rich text where they
 * stand in it, each named `<id>.text`; and groups whose units repeat. Its fields, groups and units
 * carry ids unique across the document, as every node does.
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
 *
 * The check matches them as they are spelt, and it is no security boundary: kept text, and the
 * preamble the upload brings, can still make them some other way, through `\csname`, `^^5c` or a
 * macro of its own, as TeX lets any document. What that can do is set markers on the uploader's own
 * page, so the page must not trust a marker for what it says: the reader that takes an outline's
 * field from the page accepts only the ids the outline holds, and of each only its first begin and
 * end (`collectFields`, the second pass's item 7).
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
  const read = scan(latex, addresses);
  return !read.under && read.depth === 0 && !read.delimited;
}

/**
 * Whether LaTeX ends inside a comment, as TeX reads it where it stands outside any argument
 * (`balanced`'s reading with `addresses`): its last line holds a `%` that no backslash escapes and
 * that is no character of an address, as `\href{https://quill.example/jos%C3%A9}` holds one. Text
 * written right after such LaTeX would be read as the comment; the generator ends its line first.
 */
export function endsInComment(latex: string): boolean {
  return scan(latex, true).comment;
}

/**
 * LaTeX read as TeX reads its braces and comments (`balanced`): the depth it ends at, whether it
 * went below 0 on the way, whether it ends inside an address `\url|...|` opened, and whether it
 * ends inside a comment. One pass, so it costs the text's length.
 */
function scan(
  latex: string,
  addresses: boolean,
): { depth: number; under: boolean; delimited: boolean; comment: boolean } {
  const lineEnd = (char: string | undefined) => char === "\n" || char === "\r";
  let depth = 0;
  let under = false;
  let comment = false;
  // The depth an address's braces close back to, while one is open; and the character that closes
  // one `\url|...|` opened.
  let address: number | undefined;
  let delimiter: string | undefined;
  for (let at = 0; at < latex.length; at++) {
    const char = latex[at];
    if (delimiter !== undefined) {
      if (char === delimiter) delimiter = undefined;
      continue;
    }
    if (char === "\\") {
      ADDRESS_COMMAND.lastIndex = at;
      const command = addresses && address === undefined ? ADDRESS_COMMAND.exec(latex) : null;
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
    } else if (char === "%" && address === undefined) {
      while (at + 1 < latex.length && !lineEnd(latex[at + 1])) at++;
      if (at + 1 >= latex.length) comment = true;
    } else if (char === "{") depth++;
    else if (char === "}") {
      if (--depth < 0) under = true;
      if (depth === address) address = undefined;
    }
  }
  return { depth, under, delimited: delimiter !== undefined, comment };
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
 * snippet of its own and a user can add; the fifth and the sixth, `locked` and `outline`, only an
 * import makes (`LockedSection`, `OutlineSection`).
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

// The outline (decision 0049).

/**
 * A part of an outline: kept text, a field of plain text, a field of rich text, or a group of units
 * that repeat. The generator writes the parts one after the other, in order.
 */
export type OutlinePart = OutlineKept | OutlineText | OutlineRich | OutlineGroup;

/**
 * Kept text: the upload's own LaTeX, written back byte for byte and never escaped, which nothing
 * but the retype edits. A piece of it is a fragment of the person's LaTeX, such as a command and
 * the brace that opens its argument, so it need not balance on its own; the outline as a whole
 * does (`OutlineSection`).
 */
export interface OutlineKept {
  kind: "kept";
  latex: string;
}

/**
 * A field of plain text, as a date the upload spelt: text a person types into, where it stands in
 * their own LaTeX, which the generator escapes and writes in the editor's marker, named
 * `<id>.text`, as it writes a slot. `bare` is for an argument the upload gave as one token, without
 * braces, whose field the generator writes in braces of its own, so that the command still takes
 * one argument, empty or not. `required` is for a field the import's checks found the template
 * cannot set empty: the editor never leaves it empty, and a new unit's copy of it holds
 * `OUTLINE_PLACEHOLDER` until a person types in it.
 */
export interface OutlineText {
  kind: "text";
  id: Id;
  text: string;
  bare?: boolean;
  required?: boolean;
}

/** A field of rich text: as a field of plain text, with bold, italic and links kept. */
export interface OutlineRich {
  kind: "rich";
  id: Id;
  text: RichText;
  bare?: boolean;
  required?: boolean;
}

/**
 * Why the import's checks found a group fixed, which the editor then neither adds a unit to nor
 * removes one from (the second pass's item 6): a copy of its last unit did not keep the rest of
 * the page (`copy`), the removal of its first or its last unit did not (`removal`), or the checks
 * could not try it, their budget spent or the page not the original's to judge by (`untried`); or
 * one of the copy and the removals stopped the compile (`stops`, the second pass's item 8).
 */
export const OUTLINE_FIXED = ["copy", "removal", "untried", "stops"] as const;
export type OutlineFixed = (typeof OUTLINE_FIXED)[number];

/** What a new unit's copy of a required field holds until a person types in it. */
export const OUTLINE_PLACEHOLDER = "New text";

/**
 * Something that repeats: a list's items, or a run of calls to the same command, each with what
 * follows it up to the next (decision 0049). Its units are copied, removed and moved as wholes. A
 * group the import's checks found `fixed` takes no unit more and none fewer, and says why; any
 * other takes a copy of a unit and the removal of one, but never of its only unit, whose removal
 * would leave a list with no item, which LaTeX refuses (decision 0050's first rule for check 3).
 */
export interface OutlineGroup {
  kind: "group";
  id: Id;
  units: OutlineUnit[];
  fixed?: OutlineFixed;
}

/**
 * A unit of a group, a bullet or an entry: its parts, and `gap`, the kept text that parts it from
 * the unit before it, as the upload had it, which the generator writes before it unless it is its
 * group's first. A unit carries its gap when it is moved, and a copy of it carries it too, so that
 * a copy of the last unit put in after it is parted from it as it is from the unit before, and the
 * removal of the first or of the last unit takes the gap the upload had beside it.
 */
export interface OutlineUnit {
  id: Id;
  gap: string;
  parts: OutlinePart[];
}

/** The most characters an outline may hold, kept text and fields' text together. */
export const MAX_OUTLINE = 1_048_576;

/** How deep groups may nest in an outline, units within units, as the parser's tree nests. */
export const MAX_OUTLINE_DEPTH = 64;

export const OutlinePart: z.ZodType<OutlinePart> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("kept"), latex: z.string() }),
    z.strictObject({
      kind: z.literal("text"),
      id: Id,
      text: z.string(),
      bare: z.boolean().optional(),
      required: z.boolean().optional(),
    }),
    z.strictObject({
      kind: z.literal("rich"),
      id: Id,
      text: RichText,
      bare: z.boolean().optional(),
      required: z.boolean().optional(),
    }),
    z.strictObject({
      kind: z.literal("group"),
      id: Id,
      units: z.array(OutlineUnit),
      fixed: z.enum(OUTLINE_FIXED).optional(),
    }),
  ]),
);

export const OutlineUnit: z.ZodType<OutlineUnit> = z.lazy(() =>
  z.strictObject({ id: Id, gap: z.string(), parts: z.array(OutlinePart) }),
);

/** A field of an outline. */
export type OutlineField = OutlineText | OutlineRich;

/** Whether a part of an outline is a field. */
export const isOutlineField = (part: OutlinePart): part is OutlineField =>
  part.kind === "text" || part.kind === "rich";

/**
 * Every field, group and unit of an outline's parts, in the order the generator writes them, each
 * with how deep it is: 0 at the outline's own level, 1 inside a unit of a group there, and so on.
 * The walk keeps a stack of its own, so a deep outline costs no deep recursion.
 */
export function* outlineNodes(
  parts: readonly OutlinePart[],
): Generator<
  | { kind: "part"; part: OutlinePart; depth: number }
  | { kind: "unit"; unit: OutlineUnit; group: OutlineGroup; first: boolean; depth: number }
> {
  type Step =
    | { kind: "part"; part: OutlinePart; depth: number }
    | { kind: "unit"; unit: OutlineUnit; group: OutlineGroup; first: boolean; depth: number };
  const stack: Step[] = [...parts].reverse().map((part) => ({ kind: "part", part, depth: 0 }));
  for (let step = stack.pop(); step !== undefined; step = stack.pop()) {
    yield step;
    if (step.kind === "part" && step.part.kind === "group") {
      const group = step.part;
      const depth = step.depth + 1;
      for (let u = group.units.length - 1; u >= 0; u--)
        stack.push({
          kind: "unit",
          unit: group.units[u] as OutlineUnit,
          group,
          first: u === 0,
          depth,
        });
    } else if (step.kind === "unit")
      for (let p = step.unit.parts.length - 1; p >= 0; p--)
        stack.push({ kind: "part", part: step.unit.parts[p] as OutlinePart, depth: step.depth });
  }
}

/**
 * The text an outline's kept parts and the gaps between its units make as the generator writes
 * them, each field as `field` gives it, and how many characters it holds with every field's text.
 */
function outlineText(
  parts: readonly OutlinePart[],
  field: (part: OutlineField) => string,
): { text: string; size: number } {
  let text = "";
  let size = 0;
  for (const step of outlineNodes(parts)) {
    if (step.kind === "unit") {
      if (!step.first) text += step.unit.gap;
      size += step.unit.gap.length;
      continue;
    }
    const { part } = step;
    if (part.kind === "kept") {
      text += part.latex;
      size += part.latex.length;
    } else if (isOutlineField(part)) {
      text += field(part);
      size +=
        typeof part.text === "string"
          ? part.text.length
          : part.text.reduce((sum, run) => sum + run.text.length + (run.href?.length ?? 0), 0);
    }
  }
  return { text, size };
}

const EDITORS =
  "an outline's kept text holds the editor's own macros or markers, which only the generator writes";

/** Whether a piece of LaTeX ends in a backslash no backslash escapes, which would take what follows. */
const endsEscaping = (latex: string) => (/\\+$/.exec(latex)?.[0].length ?? 0) % 2 === 1;

/**
 * An imported `.tex` resume in its own shape (decision 0049): its parts in order, kept text, fields
 * and groups of units, which the generator writes where the section sits, and which is what holds
 * the whole of the person's LaTeX after its preamble, `\begin{document}` and a call the preamble
 * stores a value with, issued again before it, among them. Its title is empty and its role
 * `other`, as a locked section's, since nothing says what it is about.
 *
 * Its kept text never holds the editor's own macros or marker texts, however its parts and the gaps
 * between its units meet, with each field empty; no piece of it ends in a backslash that would
 * escape what the generator writes next; and its braces balance as TeX reads it where it stands
 * outside any argument (`balanced`), every field a group. It holds at most `MAX_OUTLINE`
 * characters, and its groups nest at most `MAX_OUTLINE_DEPTH` deep.
 */
export const OutlineSection = z
  .strictObject({
    kind: z.literal("outline"),
    id: Id,
    title: z.literal(""),
    role: z.literal("other"),
    parts: z.array(OutlinePart),
  })
  .superRefine((section, ctx) => {
    const refuse = (message: string) => ctx.addIssue({ code: "custom", message, path: ["parts"] });
    const empty = outlineText(section.parts, () => "");
    if (empty.size > MAX_OUTLINE)
      return refuse(`an outline holds at most ${MAX_OUTLINE} characters`);
    const editors = (latex: string) => EDITOR_MACRO.test(latex) || EDITOR_MARKER.test(latex);
    const grouped = () => "{}";
    for (const step of outlineNodes(section.parts)) {
      if (step.depth > MAX_OUTLINE_DEPTH)
        return refuse(`an outline's groups nest at most ${MAX_OUTLINE_DEPTH} deep`);
      const latex =
        step.kind === "unit" ? step.unit.gap : step.part.kind === "kept" ? step.part.latex : "";
      if (endsEscaping(latex))
        return refuse("a piece of an outline's kept text ends in a backslash that would escape");
      if (editors(latex)) return refuse(EDITORS);
      // A unit is copied, removed and moved whole, its gap with it, so each balances on its own.
      if (
        step.kind === "unit" &&
        (!balanced(step.unit.gap, true) ||
          !balanced(outlineText(step.unit.parts, grouped).text, true))
      )
        return refuse("a unit of an outline, or its gap, does not balance as TeX reads it");
    }
    if (editors(empty.text)) return refuse(EDITORS);
    if (!balanced(outlineText(section.parts, grouped).text, true))
      refuse("an outline's braces do not balance as TeX reads them");
  });
export type OutlineSection = z.infer<typeof OutlineSection>;

/**
 * How many braces an outline's parts leave open at their end, as `OutlineSection` reads them where
 * they stand, each field a group: 0 for parts that balance, as many as stay open for parts whose
 * every `}` closes a `{` before it, and undefined for parts that close a brace they never opened,
 * or end inside an address `\url|...|` opened or in a comment. TeX leaves a group a document opens
 * and never closes open to `\end{document}`, as a `{%` whose `}` is in its comment does; an import
 * closes it just before (the follow-up to decision 0060).
 */
export function outlineOpenBraces(parts: readonly OutlinePart[]): number | undefined {
  const read = scan(outlineText(parts, () => "{}").text, true);
  return read.under || read.delimited || read.comment ? undefined : read.depth;
}

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
  OutlineSection,
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
      } else if (section.kind === "outline") {
        // Its fields, groups and units, each named by its id as any node is.
        for (const step of outlineNodes(section.parts)) {
          if (step.kind === "unit") visit(step.unit.id, ["sections", s, "parts"]);
          else if (step.part.kind !== "kept") visit(step.part.id, ["sections", s, "parts"]);
        }
      }
    });
  });
export type Resume = z.infer<typeof Resume>;
