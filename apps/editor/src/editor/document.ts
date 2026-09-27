/**
 * The open document: the resume and the document's choices for its template's style controls,
 * as one JSON value. That value is what the browser keeps (`src/storage/store.ts`) and milestone 4
 * syncs. It changes only through commands, which `apply` turns into a new document without
 * touching the old one, so undo is keeping the documents that came before (`History`): the command
 * stack for undo that plan section 8.1 chooses, with nothing to invert.
 *
 * A command names its field as the page's markers do, `<node id>.<name>` (decision 0006), so a
 * click on the page and an edit to the model meet on one name. `fieldsOf` finds where each field
 * of a resume lives, in one walk, and gives each a reader and a writer. The writer copies the
 * nodes on the way down to the field and shares the rest with the resume it was given, which it
 * never changes, so a history of many documents costs little more than one. A structure command,
 * which the side panel makes, names a node by its id instead, and adds, removes or moves it in the
 * same way.
 */

import {
  Dates,
  type Entry,
  Id,
  type Link,
  LinkKind,
  Resume,
  RichText,
  type Section,
  SectionKind,
  SectionRole,
} from "@resume-tools/resume-model";
import { z } from "zod";
import { curated } from "../templates/curated";
import {
  ControlValues,
  controlValuesFor,
  pageSizeFor,
  type TemplatePackage,
} from "../templates/package";

export const Document = z.strictObject({
  version: z.literal(1),
  /** The id of the template package the document is set with; a curated one for now. */
  template: Id,
  resume: Resume,
  /** The document's own choices for the template's controls; one left out is the default. */
  controls: ControlValues,
});
export type Document = z.infer<typeof Document>;

/**
 * A new document for a curated template: the resume, and the page size `locale` implies when one
 * is given and the template offers the control, as plan section 5.4 has it. Every other control is
 * left out, and so on the template's default, since a document keeps only the choices made for it:
 * a default kept in the document would outlive a revision of the template that changed it, as if
 * the user had chosen it (decision 0010). Throws for a template no curated package has, or a resume
 * the model refuses.
 */
export function newDocument(template: string, resume: Resume, locale?: string): Document {
  const { package: pkg } = curated(template);
  const controls =
    pkg.controls.pageSize && locale !== undefined ? { pageSize: pageSizeFor(locale) } : {};
  // Parsed, so the document holds a copy of the resume rather than the caller's.
  return Document.parse({ version: 1, template, resume, controls });
}

/**
 * A stored document as its package reads it now: every choice the package refuses, for a control
 * it no longer offers or a font it no longer lists, is dropped, so the document opens on the
 * package's default for it, and `dropped` names them. Refusing the document instead would keep the
 * user from their own text over a revision of the template (decision 0010).
 */
export function dropRefusedChoices(
  pkg: TemplatePackage,
  doc: Document,
): { document: Document; dropped: string[] } {
  const schema = controlValuesFor(pkg);
  const read = schema.safeParse(doc.controls);
  if (read.success) return { document: doc, dropped: [] };
  const dropped = [...new Set(read.error.issues.map((issue) => String(issue.path[0])))];
  const kept = Object.entries(doc.controls).filter(([name]) => !dropped.includes(name));
  return { document: { ...doc, controls: schema.parse(Object.fromEntries(kept)) }, dropped };
}

/**
 * Where one field's value lives in a resume: how to read it, and how to write it, which gives a
 * new resume and leaves the one given as it was. Text fields are the header's, titles, subtitles,
 * places and labels; rich fields are bullets, items and paragraphs; an entry's dates are dates.
 */
export type FieldRef =
  | {
      kind: "text";
      get(resume: Resume): string | undefined;
      set(resume: Resume, text: string): Resume;
    }
  | { kind: "rich"; get(resume: Resume): RichText; set(resume: Resume, runs: RichText): Resume }
  | {
      kind: "dates";
      get(resume: Resume): Dates | undefined;
      set(resume: Resume, dates: Dates | undefined): Resume;
    };

/**
 * Where one node of a resume sits: how to read it, and how to put a changed copy of it back, which
 * copies each node on the way down to it and shares everything else.
 */
interface Place<T> {
  get(resume: Resume): T;
  put(resume: Resume, node: T): Resume;
}

const ROOT: Place<Resume> = { get: (resume) => resume, put: (_, resume) => resume };

/** What the node at `place` holds under `key`. */
function under<P, K extends keyof P>(place: Place<P>, key: K): Place<P[K]> {
  return {
    get: (resume) => place.get(resume)[key],
    put: (resume, value) => place.put(resume, { ...place.get(resume), [key]: value }),
  };
}

/**
 * The node at `index` of the list at `place`, where the walk that built the index found it. It
 * must still be the node with the id `id`: an index is for the resume it was built from, and a
 * structure edit moves nodes, so a stale one throws rather than write into another node.
 */
function at<T extends { id: string }>(list: Place<T[]>, index: number, id: string): Place<T> {
  const get = (resume: Resume): T => {
    const node = list.get(resume)[index];
    if (node?.id !== id) throw new Error(`${id} has moved since the resume's fields were found`);
    return node;
  };
  return {
    get,
    put: (resume, node) => {
      get(resume); // The same check before a write, so a stale index cannot write elsewhere.
      return list.put(
        resume,
        list.get(resume).map((each, i) => (i === index ? node : each)),
      );
    },
  };
}

type SectionOf<K extends SectionKind> = Extract<Section, { kind: K }>;

/**
 * The section at `place` as the kind the walk found. A section's kind never changes under its id
 * (decision 0006); the check is what lets the type say which kind it is.
 */
function ofKind<K extends SectionKind>(place: Place<Section>, kind: K): Place<SectionOf<K>> {
  return {
    get: (resume) => {
      const section = place.get(resume);
      if (section.kind !== kind) throw new Error(`${section.id} is no longer a ${kind} section`);
      return section as SectionOf<K>;
    },
    put: (resume, section) => place.put(resume, section),
  };
}

const text = (value: Place<string | undefined>): FieldRef => ({
  kind: "text",
  get: value.get,
  set: value.put,
});

const rich = (value: Place<RichText>): FieldRef => ({
  kind: "rich",
  get: value.get,
  set: value.put,
});

/**
 * An entry's dates. Clearing them removes the key rather than keeping it as undefined, so the
 * document stays exactly the JSON it is stored as.
 */
function dates(entry: Place<Entry>): FieldRef {
  return {
    kind: "dates",
    get: (resume) => entry.get(resume).dates,
    set: (resume, value) => {
      const { dates: _, ...rest } = entry.get(resume);
      return entry.put(resume, value === undefined ? rest : { ...rest, dates: value });
    },
  };
}

const HEADER = under(ROOT, "header");
const NAME = under(HEADER, "name");
const LINKS = under(HEADER, "links");
const SECTIONS = under(ROOT, "sections");

/** The header's text fields besides the name, each named `header.<key>` as the model's key. */
const HEADER_TEXTS = ["headline", "email", "phone", "location"] as const;

/**
 * Every field of a resume by its id, as the generator names them (decision 0007): each field the
 * body of any package could mark, blank or not, since a blank field is still one a user fills in,
 * and nothing a body never marks, such as a link's address or a section's role. A locked section
 * has none: it is LaTeX an import kept, which the page draws and nothing edits (decision 0025).
 */
export function fieldsOf(resume: Resume): Map<string, FieldRef> {
  const fields = new Map<string, FieldRef>([
    ["header.first", text(under(NAME, "first"))],
    ["header.last", text(under(NAME, "last"))],
    ...HEADER_TEXTS.map((key): [string, FieldRef] => [`header.${key}`, text(under(HEADER, key))]),
  ]);
  resume.header.links.forEach((link, l) => {
    fields.set(`${link.id}.label`, text(under(at(LINKS, l, link.id), "label")));
  });
  resume.sections.forEach((section, s) => {
    if (section.kind === "locked") return;
    const place = at(SECTIONS, s, section.id);
    fields.set(`${section.id}.title`, text(under(place, "title")));
    switch (section.kind) {
      case "entries": {
        const entries = under(ofKind(place, "entries"), "entries");
        section.entries.forEach((entry, e) => {
          const node = at(entries, e, entry.id);
          fields.set(`${entry.id}.title`, text(under(node, "title")));
          fields.set(`${entry.id}.subtitle`, text(under(node, "subtitle")));
          fields.set(`${entry.id}.place`, text(under(node, "place")));
          fields.set(`${entry.id}.dates`, dates(node));
          const bullets = under(node, "bullets");
          entry.bullets.forEach((bullet, b) => {
            fields.set(`${bullet.id}.text`, rich(under(at(bullets, b, bullet.id), "text")));
          });
        });
        break;
      }
      case "list": {
        const items = under(ofKind(place, "list"), "items");
        section.items.forEach((item, i) => {
          fields.set(`${item.id}.text`, rich(under(at(items, i, item.id), "text")));
        });
        break;
      }
      case "labelled": {
        const items = under(ofKind(place, "labelled"), "items");
        section.items.forEach((item, i) => {
          const node = at(items, i, item.id);
          fields.set(`${item.id}.label`, text(under(node, "label")));
          fields.set(`${item.id}.text`, rich(under(node, "text")));
        });
        break;
      }
      case "paragraph":
        fields.set(`${section.id}.text`, rich(under(ofKind(place, "paragraph"), "text")));
        break;
    }
  });
  return fields;
}

/**
 * The text each kind of new node starts with. A new node has to be on the page at once, so that it
 * can be clicked and edited there, and an empty field is not on the page (decision 0007), so a new
 * node holds words that say what goes where. The panel marks a field that still holds one, so that
 * none goes out on a resume by mistake. A new link starts without an address, which is typed in the
 * panel, since the page shows only the label.
 */
export const PLACEHOLDERS = {
  entry: { title: "Title", subtitle: "Organisation", place: "Place" },
  bullet: "Describe what you did",
  item: "Item",
  labelledItem: { label: "Label", text: "Item" },
  link: { label: "example.com" },
} as const;

/**
 * The title a new section starts with, by its role: the usual title for such a section, which it
 * often keeps, so it is not a placeholder the panel marks.
 */
export const SECTION_TITLES: Readonly<Record<SectionRole, string>> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  awards: "Awards",
  publications: "Publications",
  languages: "Languages",
  other: "Other",
};

/** What a minted id is made of after its prefix: the lowercase letters and digits ids allow. */
const ID_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A new node's id: `prefix`, a hyphen and six random lowercase letters and digits, drawn again
 * while `taken` has it, since an id is unique across the document (decision 0006). Random rather
 * than counted, because the page on screen can be older than the document while a compile is in
 * flight, and its markers name fields by id: a count would give a removed node's id to the next
 * node added, and a click on the old page would open the new node's field.
 */
export function mintId(prefix: string, taken: ReadonlySet<string>): string {
  const bytes = new Uint8Array(6);
  let id: string;
  do {
    crypto.getRandomValues(bytes);
    // A byte modulo 36 favours the first four characters slightly, which does not matter: an id
    // has to be unique, which drawing again ensures, not evenly spread.
    const drawn = Array.from(bytes, (byte) => ID_CHARACTERS.charAt(byte % ID_CHARACTERS.length));
    id = `${prefix}-${drawn.join("")}`;
  } while (taken.has(id));
  return id;
}

/**
 * A change to the resume's structure rather than to a field's text, as the side panel makes them
 * (item 11): a node added, removed or moved, and what the page does not show, such as a section's
 * role or a link's address. A node is named by its id. `at` is the index a new node takes, the end
 * when it is left out, and `to` the index a moved node ends at among its siblings, which it never
 * leaves: an entry stays in its section and a bullet in its entry. A new node gets its id from
 * `mintId` and its text from `PLACEHOLDERS`, and a new section its role's title and nothing in it.
 * A section's kind is its shape, which never changes under the user (decision 0006), so only its
 * role can be set. `setHeader` and `setLink` leave a value the op leaves out as it is. A locked
 * section, which only an import makes, is removed and moved like any other, and no other op
 * touches it: it holds no entries or items, keeps the role `other`, and cannot be added
 * (decision 0025).
 */
export type StructureOp =
  | { op: "addSection"; kind: SectionKind; role: SectionRole; at?: number }
  | { op: "removeSection"; id: string }
  | { op: "moveSection"; id: string; to: number }
  | { op: "setSection"; id: string; role?: SectionRole }
  | { op: "addEntry"; section: string; at?: number }
  | { op: "removeEntry"; id: string }
  | { op: "moveEntry"; id: string; to: number }
  | { op: "addBullet"; entry: string; at?: number }
  | { op: "removeBullet"; id: string }
  | { op: "moveBullet"; id: string; to: number }
  | { op: "addItem"; section: string; at?: number }
  | { op: "removeItem"; id: string }
  | { op: "moveItem"; id: string; to: number }
  | { op: "addLink"; at?: number }
  | { op: "removeLink"; id: string }
  | { op: "moveLink"; id: string; to: number }
  | { op: "setLink"; id: string; kind?: LinkKind; label?: string; href?: string }
  | { op: "setHeader"; headline?: string; email?: string; phone?: string; location?: string };

/** A choice for one of the template's controls; `undefined` goes back to the template's default. */
type ControlCommand = {
  [K in keyof ControlValues]-?: { type: "control"; name: K; value: ControlValues[K] };
}[keyof ControlValues];

/** A change to a document, the only way one changes. */
export type Command =
  | { type: "text"; field: string; text: string }
  | { type: "rich"; field: string; runs: RichText }
  | { type: "dates"; field: string; dates: Dates | undefined }
  | { type: "structure"; op: StructureOp }
  | ControlCommand;

/** A command the document cannot take. The commands come from the editor's code, never a user. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

/** The field a command names, which must be of the command's kind. */
function fieldOf<K extends FieldRef["kind"]>(
  doc: Document,
  id: string,
  kind: K,
): Extract<FieldRef, { kind: K }> {
  const field = fieldsOf(doc.resume).get(id);
  if (field === undefined) throw new CommandError(`the document has no field ${id}`);
  if (field.kind !== kind) throw new CommandError(`${id} is a ${field.kind} field, not ${kind}`);
  return field as Extract<FieldRef, { kind: K }>;
}

/**
 * The document after a command, a new value that shares what the command left alone; the one
 * given is never changed. Throws a `CommandError` for a field the document does not have, a field
 * of another kind, runs or dates the model refuses, a node the document does not have or an index
 * its list does not have, and a control value the template refuses, so that no command makes a
 * document `Document` would not read back. The runs and dates stored are the model's parsed
 * copies, so a caller that changes its own afterwards changes nothing here.
 */
export function apply(doc: Document, command: Command): Document {
  switch (command.type) {
    case "text": {
      const field = fieldOf(doc, command.field, "text");
      if (typeof command.text !== "string")
        throw new CommandError(`${command.field} takes text, not ${typeof command.text}`);
      return { ...doc, resume: field.set(doc.resume, command.text) };
    }
    case "rich": {
      const field = fieldOf(doc, command.field, "rich");
      const runs = RichText.safeParse(command.runs);
      if (!runs.success)
        throw new CommandError(`${command.field} refuses the runs: ${z.prettifyError(runs.error)}`);
      return { ...doc, resume: field.set(doc.resume, runs.data) };
    }
    case "dates": {
      const field = fieldOf(doc, command.field, "dates");
      const dates = Dates.optional().safeParse(command.dates);
      if (!dates.success)
        throw new CommandError(
          `${command.field} refuses the dates: ${z.prettifyError(dates.error)}`,
        );
      return { ...doc, resume: field.set(doc.resume, dates.data) };
    }
    case "structure":
      return { ...doc, resume: restructure(doc.resume, command.op) };
    case "control": {
      const { package: pkg } = curated(doc.template);
      const next: Record<string, unknown> = { ...doc.controls };
      if (command.value === undefined) delete next[command.name];
      else next[command.name] = command.value;
      const controls = controlValuesFor(pkg).safeParse(next);
      if (!controls.success) {
        const choice = `${command.name} ${String(command.value)}`;
        throw new CommandError(`${pkg.name} refuses ${choice}: ${z.prettifyError(controls.error)}`);
      }
      return { ...doc, controls: controls.data };
    }
  }
}

/** The kinds of node that sit in a list, which structure ops add, remove and move. */
type NodeKind = "link" | "section" | "entry" | "bullet" | "item";

/** Each kind of node as an error message names it. */
const NODE_NAMES: Readonly<Record<NodeKind, string>> = {
  link: "a link",
  section: "a section",
  entry: "an entry",
  bullet: "a bullet",
  item: "an item",
};

/**
 * How long a node's list is, and how to take the node out or move it within the list. Both only
 * drop or reorder what the list already holds, so one function builds them for any kind of node.
 */
interface Siblings {
  length: number;
  remove(resume: Resume): Resume;
  move(resume: Resume, to: number): Resume;
}

function siblings<T>(list: Place<T[]>, index: number, length: number): Siblings {
  return {
    length,
    remove: (resume) =>
      list.put(
        resume,
        list.get(resume).filter((_, i) => i !== index),
      ),
    move: (resume, to) => {
      const nodes = [...list.get(resume)];
      nodes.splice(to, 0, ...nodes.splice(index, 1));
      return list.put(resume, nodes);
    },
  };
}

/** A node's kind and where it sits, and the place of each node an op changes or adds to. */
type Located =
  | { kind: "link"; siblings: Siblings; node: Place<Link> }
  | { kind: "section"; siblings: Siblings; node: Place<Section> }
  | { kind: "entry"; siblings: Siblings; node: Place<Entry> }
  | { kind: "bullet"; siblings: Siblings }
  | { kind: "item"; siblings: Siblings };

/**
 * Every node of a resume by its id, found in one walk, as `fieldsOf` finds fields. Its indexes are
 * the resume's, so it serves the one op it was built for.
 */
function nodesOf(resume: Resume): Map<string, Located> {
  const nodes = new Map<string, Located>();
  const { links } = resume.header;
  links.forEach((link, l) => {
    const node = at(LINKS, l, link.id);
    nodes.set(link.id, { kind: "link", siblings: siblings(LINKS, l, links.length), node });
  });
  const { sections } = resume;
  sections.forEach((section, s) => {
    const node = at(SECTIONS, s, section.id);
    nodes.set(section.id, {
      kind: "section",
      siblings: siblings(SECTIONS, s, sections.length),
      node,
    });
    switch (section.kind) {
      case "entries": {
        const entries = under(ofKind(node, "entries"), "entries");
        section.entries.forEach((entry, e) => {
          const place = at(entries, e, entry.id);
          const here = siblings(entries, e, section.entries.length);
          nodes.set(entry.id, { kind: "entry", siblings: here, node: place });
          const bullets = under(place, "bullets");
          entry.bullets.forEach((bullet, b) => {
            const among = siblings(bullets, b, entry.bullets.length);
            nodes.set(bullet.id, { kind: "bullet", siblings: among });
          });
        });
        break;
      }
      case "list": {
        const items = under(ofKind(node, "list"), "items");
        section.items.forEach((item, i) => {
          nodes.set(item.id, { kind: "item", siblings: siblings(items, i, section.items.length) });
        });
        break;
      }
      case "labelled": {
        const items = under(ofKind(node, "labelled"), "items");
        section.items.forEach((item, i) => {
          nodes.set(item.id, { kind: "item", siblings: siblings(items, i, section.items.length) });
        });
        break;
      }
      case "paragraph":
      case "locked":
        break;
    }
  });
  return nodes;
}

/** Whether `index` is a whole number that indexes a list of `length`. */
const isIndex = (index: number, length: number) =>
  Number.isInteger(index) && index >= 0 && index < length;

/** A value the model's schema reads, or a `CommandError` that says what refused it. */
function checked<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const read = schema.safeParse(value);
  if (!read.success) throw new CommandError(`${what} cannot be ${String(value)}`);
  return read.data;
}

/** Text an op sets, which the types already require; the check keeps a slip out of the model. */
function checkedText(value: unknown, what: string): string {
  if (typeof value !== "string") throw new CommandError(`${what} takes text, not ${typeof value}`);
  return value;
}

/** The resume with `node` in the list at `list`, at `index` or at the end. */
function insertAt<T>(resume: Resume, list: Place<T[]>, index: number | undefined, node: T): Resume {
  const nodes = list.get(resume);
  const where = index ?? nodes.length;
  if (!isIndex(where, nodes.length + 1))
    throw new CommandError(`a list of ${nodes.length} has no place ${where} for a new node`);
  return list.put(resume, [...nodes.slice(0, where), node, ...nodes.slice(where)]);
}

/** The resume with the node `id` moved to `to` among its siblings. */
function moveTo(resume: Resume, { siblings }: Located, id: string, to: number): Resume {
  if (!isIndex(to, siblings.length))
    throw new CommandError(`${id} cannot move to ${to} in a list of ${siblings.length}`);
  return siblings.move(resume, to);
}

/** A new section of a kind, titled for its role, with nothing in it yet. */
function newSection(id: string, kind: SectionKind, role: SectionRole): Section {
  const base = { id, title: SECTION_TITLES[role], role };
  switch (kind) {
    case "entries":
      return { ...base, kind, entries: [] };
    case "list":
      return { ...base, kind, items: [] };
    case "labelled":
      return { ...base, kind, items: [] };
    case "paragraph":
      return { ...base, kind, text: [] };
  }
}

/**
 * The resume after a structure op, a new value that shares what the op left alone. Throws a
 * `CommandError` for a node the resume does not have or of another kind than the op's, a section
 * that cannot hold what is added to it, an index outside the list, and a kind, role or text the
 * model refuses. A new node's id is minted against every id in the resume, so ids stay unique.
 */
function restructure(resume: Resume, op: StructureOp): Resume {
  const nodes = nodesOf(resume);
  const find = <K extends NodeKind>(id: string, kind: K): Extract<Located, { kind: K }> => {
    const found = nodes.get(id);
    if (found === undefined) throw new CommandError(`the document has no ${kind} ${id}`);
    if (found.kind !== kind)
      throw new CommandError(`${id} is ${NODE_NAMES[found.kind]}, not ${NODE_NAMES[kind]}`);
    return found as Extract<Located, { kind: K }>;
  };
  const mint = (prefix: string) => mintId(prefix, new Set(nodes.keys()));
  switch (op.op) {
    case "addSection": {
      const kind = checked(SectionKind, op.kind, "a section's kind");
      const role = checked(SectionRole, op.role, "a section's role");
      return insertAt(resume, SECTIONS, op.at, newSection(mint("sec"), kind, role));
    }
    case "removeSection":
      return find(op.id, "section").siblings.remove(resume);
    case "moveSection":
      return moveTo(resume, find(op.id, "section"), op.id, op.to);
    case "setSection": {
      const { node } = find(op.id, "section");
      const section = node.get(resume);
      if (section.kind === "locked")
        throw new CommandError(`the locked section ${op.id} keeps its role, other`);
      if (op.role === undefined) return resume;
      const role = checked(SectionRole, op.role, "a section's role");
      return node.put(resume, { ...section, role });
    }
    case "addEntry": {
      const { node } = find(op.section, "section");
      const { kind } = node.get(resume);
      if (kind !== "entries")
        throw new CommandError(`the ${kind} section ${op.section} holds no entries`);
      const { title, subtitle, place } = PLACEHOLDERS.entry;
      const entry: Entry = { id: mint("ent"), title, subtitle, place, bullets: [] };
      return insertAt(resume, under(ofKind(node, "entries"), "entries"), op.at, entry);
    }
    case "removeEntry":
      return find(op.id, "entry").siblings.remove(resume);
    case "moveEntry":
      return moveTo(resume, find(op.id, "entry"), op.id, op.to);
    case "addBullet": {
      const bullets = under(find(op.entry, "entry").node, "bullets");
      const bullet = { id: mint("bul"), text: [{ text: PLACEHOLDERS.bullet }] };
      return insertAt(resume, bullets, op.at, bullet);
    }
    case "removeBullet":
      return find(op.id, "bullet").siblings.remove(resume);
    case "moveBullet":
      return moveTo(resume, find(op.id, "bullet"), op.id, op.to);
    case "addItem": {
      const { node } = find(op.section, "section");
      const { kind } = node.get(resume);
      if (kind === "list") {
        const item = { id: mint("itm"), text: [{ text: PLACEHOLDERS.item }] };
        return insertAt(resume, under(ofKind(node, "list"), "items"), op.at, item);
      }
      if (kind === "labelled") {
        const { label, text } = PLACEHOLDERS.labelledItem;
        const item = { id: mint("itm"), label, text: [{ text }] };
        return insertAt(resume, under(ofKind(node, "labelled"), "items"), op.at, item);
      }
      throw new CommandError(`the ${kind} section ${op.section} holds no items`);
    }
    case "removeItem":
      return find(op.id, "item").siblings.remove(resume);
    case "moveItem":
      return moveTo(resume, find(op.id, "item"), op.id, op.to);
    case "addLink": {
      const { label } = PLACEHOLDERS.link;
      const link: Link = { id: mint("lnk"), kind: "website", label, href: "" };
      return insertAt(resume, LINKS, op.at, link);
    }
    case "removeLink":
      return find(op.id, "link").siblings.remove(resume);
    case "moveLink":
      return moveTo(resume, find(op.id, "link"), op.id, op.to);
    case "setLink": {
      const { node } = find(op.id, "link");
      const link = { ...node.get(resume) };
      if (op.kind !== undefined) link.kind = checked(LinkKind, op.kind, "a link's kind");
      if (op.label !== undefined) link.label = checkedText(op.label, `${op.id}.label`);
      if (op.href !== undefined) link.href = checkedText(op.href, `${op.id}'s address`);
      return node.put(resume, link);
    }
    case "setHeader": {
      const header = { ...resume.header };
      for (const key of HEADER_TEXTS) {
        const value = op[key];
        if (value !== undefined) header[key] = checkedText(value, `header.${key}`);
      }
      return HEADER.put(resume, header);
    }
    default:
      // The types rule this out; the check keeps a slip from leaving the document without a resume.
      throw new CommandError(`there is no structure op ${String((op as { op: unknown }).op)}`);
  }
}

/**
 * How many steps `History` keeps to undo back to. Without a bound a session that edits for hours
 * would keep every document it ever had; two hundred steps is further back than anyone undoes,
 * since a step is a visit to a field, or one change in the panel, rather than a keystroke.
 */
export const HISTORY_LIMIT = 200;

/**
 * Whether two of a document's JSON values are the same: the same value, or arrays or objects that
 * hold the same values, in any order of an object's keys, since a command may move a key it sets
 * (`dates` does), and with a key whose value is undefined taken as absent, as the JSON a document
 * is kept as has it. A command copies only the nodes on its way down to what it changes and shares
 * the rest (`fieldsOf`), so a comparison of a document with the one before it looks only along
 * that path.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((each, i) => sameValue(each, b[i]));
  }
  const one = a as Record<string, unknown>;
  const other = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(one), ...Object.keys(other)]);
  return [...keys].every((key) => sameValue(one[key], other[key]));
}

/**
 * The document, with the ones before it for undo and the ones undone for redo, a step at a time. A
 * step is what one undo takes back: one command, or every command of one visit to a field, on the
 * page or in one of the panel's inputs, or of one drag of a slider or the colour picker, which the
 * editor dispatches in one group (item 12), so that undo takes back what was typed or dragged
 * there rather than a keystroke or a movement of it.
 * The past holds one document per step, the one before the step began, so the bound counts steps
 * however many commands each took; undo and redo move along the past and the future, and a new
 * command after an undo clears what was undone. Only a change is a step: a command that leaves the
 * document as it was makes none, and a step that ends where it began is dropped, so that neither
 * leaves an undo that does nothing, nor takes away what could have been redone.
 */
export class History {
  private readonly past: Document[] = [];
  private future: Document[] = [];
  /**
   * The step of several commands the present document ends, while more of its group can extend
   * it: its group, and what could be redone before it began, which it gives back if it ends where
   * it began. Undefined for a step of one command, and once the step has ended.
   */
  private open: { group: string; future: Document[] } | undefined;

  constructor(private current: Document) {}

  get present(): Document {
    return this.current;
  }

  /**
   * Apply a command to the present document, or throw a `CommandError` and change nothing. With a
   * group equal to the open step's, the command extends that step, whose entry in the past stays
   * the document before the step began; with none, or another, or once the step has ended
   * (`seal`, `undo`, `redo`), it ends the open step and begins its own. A structure op, a
   * control's click and anything else that is a step by itself comes with no group. A command
   * that leaves the document as it was changes nothing at all, and gives back the present: it
   * makes no step, keeps what could be redone, and leaves the open step open.
   */
  dispatch(command: Command, group?: string): Document {
    const next = apply(this.current, command);
    if (sameValue(next, this.current)) return this.current;
    if (group === undefined || group !== this.open?.group) {
      this.end();
      this.past.push(this.current);
      this.open = group === undefined ? undefined : { group, future: this.future };
      // A step of one command is a change, so it stays; an open one is bound once it has ended.
      if (this.open === undefined) this.bound();
    }
    this.future = [];
    this.current = next;
    return next;
  }

  /**
   * End the open step, whatever the next command's group: a visit to a field has ended, and the
   * next visit to the same field is a step of its own. A step that ends where it began, as when
   * what was typed has been deleted again, is dropped, and gives back what could be redone.
   */
  seal(): void {
    this.end();
  }

  /**
   * The document before the present step, which becomes the present; undefined at the start. The
   * open step ends first (`seal`), and is undone whole, so a command after it begins a new one.
   */
  undo(): Document | undefined {
    this.end();
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(this.current);
    this.current = previous;
    return previous;
  }

  /**
   * The document the step last undone ended with, which becomes the present again; undefined when
   * there is none. The open step ends first (`seal`), and a command after the redo begins a step
   * of its own, as after an undo.
   */
  redo(): Document | undefined {
    this.end();
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** End the open step: dropped, with the future it cleared given back, if it changed nothing. */
  private end(): void {
    const step = this.open;
    if (step === undefined) return;
    this.open = undefined;
    const start = this.past.at(-1);
    if (start !== undefined && sameValue(start, this.current)) {
      this.past.pop();
      this.future = step.future;
    } else this.bound();
  }

  /**
   * Let the oldest steps go past `HISTORY_LIMIT`. An open step is bound only once it has ended, so
   * that a step that is then dropped has not pushed out one that changed something.
   */
  private bound(): void {
    while (this.past.length > HISTORY_LIMIT) this.past.shift();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
