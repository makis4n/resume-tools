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
 *
 * An imported package says more than a curated one of what its template takes (decision 0026):
 * the slots its checks found stop the compile when empty, which are required, as a required form
 * field is, so that a command refuses to empty one; the kinds of unit a new one of which stops the
 * compile, which a command refuses to add; and, per role, whether an entry shows bullets at all,
 * so that a command refuses a bullet no page would show. And an imported document keeps some of
 * its slots as the upload had them (`kept`), whose value the generator writes back from the node's
 * extras, so that they are no fields. A curated package says none of these, and takes every edit.
 */

import {
  Dates,
  type Entry,
  Id,
  type Link,
  LinkKind,
  LockedLatex,
  Resume,
  RichText,
  type Section,
  SectionKind,
  SectionRole,
} from "@resume-tools/resume-model";
import { z } from "zod";
import { CURATED, curated } from "../templates/curated";
import { isBlank } from "../templates/escape";
import {
  ControlValues,
  controlValuesFor,
  forRole,
  type PinStep,
  pageSizeFor,
  type RequiredPlace,
  requiredSlots,
  type TemplatePackage,
  type UnitKind,
} from "../templates/package";
import { parseSnippet, SnippetError, type SnippetNode } from "../templates/snippet";

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
 * Each says where its package sets it (`FieldSlot`).
 */
export type FieldRef = (
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
    }
) & { slot: FieldSlot };

/**
 * Where a field sits among a package's snippets: the snippet that sets it, as the package's
 * required slots name it (`RequiredPlace`), and the name of its slot there. A labelled item's field
 * is `labelledItem`'s, an item's `item`'s, and a paragraph's text, like any section's title,
 * `section`'s.
 */
export interface FieldSlot {
  snippet: RequiredPlace;
  name: string;
}

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

const text = (value: Place<string | undefined>, slot: FieldSlot): FieldRef => ({
  kind: "text",
  get: value.get,
  set: value.put,
  slot,
});

const rich = (value: Place<RichText>, slot: FieldSlot): FieldRef => ({
  kind: "rich",
  get: value.get,
  set: value.put,
  slot,
});

/**
 * An entry's dates. Clearing them removes the key rather than keeping it as undefined, so the
 * document stays exactly the JSON it is stored as.
 */
function dates(entry: Place<Entry>, slot: FieldSlot): FieldRef {
  return {
    kind: "dates",
    get: (resume) => entry.get(resume).dates,
    set: (resume, value) => {
      const { dates: _, ...rest } = entry.get(resume);
      return entry.put(resume, value === undefined ? rest : { ...rest, dates: value });
    },
    slot,
  };
}

const HEADER = under(ROOT, "header");
const NAME = under(HEADER, "name");
const LINKS = under(HEADER, "links");
const SECTIONS = under(ROOT, "sections");

/** The header's text fields besides the name, each named `header.<key>` as the model's key. */
const HEADER_TEXTS = ["headline", "email", "phone", "location"] as const;

/** No slot kept. */
const NONE: ReadonlySet<string> = new Set();

/**
 * The slots a node keeps as the upload had them (`kept`, decision 0026): an instance of a field an
 * import's checks locked, whose bytes the generator writes back from the node's extras and never
 * from the model, so that it is no field and nothing edits it; or a list the node keeps whole,
 * `bullets`, `entries`, `items` or `links`, which the generator sets from the extras alone, so
 * that none of its units is a field and none can be added to it. Only the header, a section and
 * an entry keep any (the model's `kept`).
 */
export function keptOf(node: { kept?: readonly string[] | undefined }): ReadonlySet<string> {
  return node.kept === undefined ? NONE : new Set(node.kept);
}

/**
 * Every field of a resume by its id, as the generator names them (decision 0007): each field the
 * body of any package could mark, blank or not, since a blank field is still one a user fills in,
 * and nothing a body never marks, such as a link's address or a section's role. A locked section
 * has none: it is LaTeX an import kept, which the page draws and nothing edits (decision 0025);
 * and nor has a slot its node keeps as the upload had it, or a list it keeps whole (`kept`,
 * decision 0026).
 */
export function fieldsOf(resume: Resume): Map<string, FieldRef> {
  const fields = new Map<string, FieldRef>();
  /** The field `id`, unless its node keeps its slot. */
  const add = (id: string, field: FieldRef, kept: ReadonlySet<string> = NONE) => {
    if (!kept.has(field.slot.name)) fields.set(id, field);
  };
  const slot = (snippet: RequiredPlace, name: string): FieldSlot => ({ snippet, name });
  const { header } = resume;
  const keeps = keptOf(header);
  add("header.first", text(under(NAME, "first"), slot("header", "first")), keeps);
  add("header.last", text(under(NAME, "last"), slot("header", "last")), keeps);
  for (const key of HEADER_TEXTS)
    add(`header.${key}`, text(under(HEADER, key), slot("header", key)), keeps);
  if (!keeps.has("links"))
    header.links.forEach((link, l) => {
      const label = under(at(LINKS, l, link.id), "label");
      add(`${link.id}.label`, text(label, slot("link", "label")));
    });
  resume.sections.forEach((section, s) => {
    // An outline's fields come with the second pass's item 7, which opens them in place.
    if (section.kind === "locked" || section.kind === "outline") return;
    const place = at(SECTIONS, s, section.id);
    const kept = keptOf(section);
    add(`${section.id}.title`, text(under(place, "title"), slot("section", "title")), kept);
    switch (section.kind) {
      case "entries": {
        if (kept.has("entries")) break;
        const entries = under(ofKind(place, "entries"), "entries");
        section.entries.forEach((entry, e) => {
          const node = at(entries, e, entry.id);
          const own = keptOf(entry);
          add(`${entry.id}.title`, text(under(node, "title"), slot("entry", "title")), own);
          const subtitle = under(node, "subtitle");
          add(`${entry.id}.subtitle`, text(subtitle, slot("entry", "subtitle")), own);
          add(`${entry.id}.place`, text(under(node, "place"), slot("entry", "place")), own);
          add(`${entry.id}.dates`, dates(node, slot("entry", "dates")), own);
          if (own.has("bullets")) return;
          const bullets = under(node, "bullets");
          entry.bullets.forEach((bullet, b) => {
            const runs = under(at(bullets, b, bullet.id), "text");
            add(`${bullet.id}.text`, rich(runs, slot("bullet", "text")));
          });
        });
        break;
      }
      case "list": {
        if (kept.has("items")) break;
        const items = under(ofKind(place, "list"), "items");
        section.items.forEach((item, i) => {
          const runs = under(at(items, i, item.id), "text");
          add(`${item.id}.text`, rich(runs, slot("item", "text")));
        });
        break;
      }
      case "labelled": {
        if (kept.has("items")) break;
        const items = under(ofKind(place, "labelled"), "items");
        section.items.forEach((item, i) => {
          const node = at(items, i, item.id);
          add(`${item.id}.label`, text(under(node, "label"), slot("labelledItem", "label")));
          add(`${item.id}.text`, rich(under(node, "text"), slot("labelledItem", "text")));
        });
        break;
      }
      case "paragraph": {
        const runs = under(ofKind(place, "paragraph"), "text");
        add(`${section.id}.text`, rich(runs, slot("section", "text")), kept);
        break;
      }
    }
  });
  return fields;
}

/**
 * Whether `pkg` requires the field at `slot`: whether the package lists its slot among those of
 * the snippet that sets it which an import's checks found stop the compile when empty (`required`,
 * decision 0026), which the editor refuses to empty, as a required form field is refused, since
 * Awesome-CV stops on a blank name (decision 0015). A package without the list, as every curated
 * one, requires nothing.
 */
export function isRequired(pkg: TemplatePackage | undefined, slot: FieldSlot): boolean {
  return pkg !== undefined && requiredSlots(pkg, slot.snippet).has(slot.name);
}

/** The fields of a resume its package requires (`isRequired`), which the side panel marks. */
export function requiredFields(pkg: TemplatePackage | undefined, resume: Resume): Set<string> {
  const required = new Set<string>();
  if (pkg === undefined) return required;
  for (const [id, field] of fieldsOf(resume)) if (isRequired(pkg, field.slot)) required.add(id);
  return required;
}

/** Each kind of unit as an error message names it. */
const UNIT_NAMES: Readonly<Record<UnitKind, string>> = {
  entry: "entry",
  bullet: "bullet",
  item: "item",
  labelledItem: "labelled item",
  link: "link",
  "section.entries": "section of entries",
  "section.list": "list section",
  "section.labelled": "labelled list section",
  "section.paragraph": "paragraph section",
};

/**
 * Whether the editor may add a unit of `kind` under `pkg`: unless the package lists the kind among
 * those whose units it keeps as they are (`fixed`), which an import's third check finds when a new
 * unit of the kind, as the editor adds it, or the removal of the first or the last of the
 * document's, stops the compile (decisions 0026 and 0038). A package without the list, as every
 * curated one, takes every kind.
 */
export function addable(pkg: TemplatePackage | undefined, kind: UnitKind): boolean {
  return !(pkg?.fixed ?? []).includes(kind);
}

/**
 * Whether the editor may remove a unit of `kind` under `pkg`: as it may add one (`addable`), since
 * the package marks a kind whose units it keeps as they are, for a new unit or a removal that stops
 * the compile alike (decision 0038).
 */
export function removable(pkg: TemplatePackage | undefined, kind: UnitKind): boolean {
  return addable(pkg, kind);
}

/**
 * The steps the editor does not take with the locked part `id` under `pkg`, its removal and its
 * moves one way or the other, since the template stops after them (`TemplatePackage.pinned`,
 * decision 0041); none under a curated package.
 */
export function pinnedSteps(pkg: TemplatePackage | undefined, id: string): ReadonlySet<PinStep> {
  return new Set(pkg?.pinned?.[id] ?? []);
}

/** Whether a snippet's nodes, however deep, hold the slot `name`. */
function holdsSlot(nodes: readonly SnippetNode[], name: string): boolean {
  return nodes.some((node) =>
    node.kind === "slot"
      ? node.name === name
      : node.kind === "block" && holdsSlot(node.children, name),
  );
}

/**
 * Whether an entry in a section of `role` shows its bullets under `pkg`: whether the package does
 * not say its entries of the role set none (`snippets.entryBullets`), as an import's says for a
 * role whose entries had no list in the upload (decision 0026), and the entry snippet the role
 * takes (`ByRole`) has a bullets slot. A bullet added to such an entry would be in the document and
 * never on the page. With no package, or one whose entry snippet it cannot read, it does.
 */
export function showsBullets(pkg: TemplatePackage | undefined, role: SectionRole): boolean {
  if (pkg === undefined) return true;
  if (!forRole(pkg.snippets.entryBullets ?? true, role)) return false;
  try {
    return holdsSlot(parseSnippet(forRole(pkg.snippets.entry, role)), "bullets");
  } catch (error) {
    if (error instanceof SnippetError) return true;
    throw error;
  }
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
 * (decision 0025). An op that adds a unit the package cannot take (`addable`), or removes one it
 * cannot lose (`removable`, decision 0038), a bullet to an entry whose snippet shows none
 * (`showsBullets`), or a unit to a list its node keeps whole as the upload had it (`kept`), is
 * refused, and so is one that empties a field the package requires (`isRequired`, decision 0026).
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
  | { type: "retype"; section: string; latex: string }
  | ControlCommand;

/**
 * A command the document cannot take. The commands come from the editor's code, never a user's
 * typing as it stands; but a user's edit can be one the package refuses, as emptying a field it
 * requires or adding a unit it cannot take, which the command refuses and the document keeps what
 * it had, and which the side panel marks (decision 0026).
 */
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
 * A `CommandError` for an edit that would leave a field `pkg` requires (`isRequired`) blank, as
 * the generator reads blank (`isBlank`), where it was not: the field keeps its value, and the
 * error says why. A field that is blank already can stay so, since the edit changes nothing.
 */
function refuseEmptied(
  pkg: TemplatePackage | undefined,
  slot: FieldSlot,
  id: string,
  before: string | undefined,
  after: string | undefined,
): void {
  if (isBlank(after ?? "") && !isBlank(before ?? "") && isRequired(pkg, slot))
    throw new CommandError(`the template requires ${id}, which cannot be left empty`);
}

/** The text of rich runs, joined, as the generator reads whether they are blank. */
const joined = (runs: RichText) => runs.map((run) => run.text).join("");

/** A document's package: the one given, or the curated one of its template when there is one. */
const packageOf = (doc: Document, pkg: TemplatePackage | undefined) =>
  pkg ?? CURATED.get(doc.template)?.package;

/**
 * The document after a command, a new value that shares what the command left alone; the one
 * given is never changed. Throws a `CommandError` for a field the document does not have, a field
 * of another kind, runs or dates the model refuses, a node the document does not have or an index
 * its list does not have, and a control value the template refuses, so that no command makes a
 * document `Document` would not read back. The runs and dates stored are the model's parsed
 * copies, so a caller that changes its own afterwards changes nothing here.
 * Its template's package is the curated one (`applyUnder`).
 */
export function apply(doc: Document, command: Command): Document {
  return applyUnder(undefined, doc, command);
}

/**
 * `apply` under `pkg`, the document's package, or its curated one when it is left out: the
 * command is refused where the package says the template cannot take it, a field it requires
 * emptied, a unit of a kind it cannot add, or a bullet for an entry whose snippet shows none
 * (decision 0026). An imported document's commands go through this with its package.
 */
export function applyUnder(
  pkg: TemplatePackage | undefined,
  doc: Document,
  command: Command,
): Document {
  const rules = packageOf(doc, pkg);
  switch (command.type) {
    case "text": {
      const field = fieldOf(doc, command.field, "text");
      if (typeof command.text !== "string")
        throw new CommandError(`${command.field} takes text, not ${typeof command.text}`);
      refuseEmptied(rules, field.slot, command.field, field.get(doc.resume), command.text);
      return { ...doc, resume: field.set(doc.resume, command.text) };
    }
    case "rich": {
      const field = fieldOf(doc, command.field, "rich");
      const runs = RichText.safeParse(command.runs);
      if (!runs.success)
        throw new CommandError(`${command.field} refuses the runs: ${z.prettifyError(runs.error)}`);
      const before = joined(field.get(doc.resume));
      refuseEmptied(rules, field.slot, command.field, before, joined(runs.data));
      return { ...doc, resume: field.set(doc.resume, runs.data) };
    }
    case "dates": {
      const field = fieldOf(doc, command.field, "dates");
      const dates = Dates.optional().safeParse(command.dates);
      if (!dates.success)
        throw new CommandError(
          `${command.field} refuses the dates: ${z.prettifyError(dates.error)}`,
        );
      if (
        dates.data === undefined &&
        field.get(doc.resume) !== undefined &&
        isRequired(rules, field.slot)
      )
        throw new CommandError(
          `the template requires ${command.field}, which cannot be left empty`,
        );
      return { ...doc, resume: field.set(doc.resume, dates.data) };
    }
    case "structure":
      return { ...doc, resume: restructure(doc.resume, command.op, rules) };
    case "retype":
      return { ...doc, resume: retypeSection(doc.resume, command.section, command.latex) };
    case "control": {
      const controlled = pkg ?? curated(doc.template).package;
      const next: Record<string, unknown> = { ...doc.controls };
      if (command.value === undefined) delete next[command.name];
      else next[command.name] = command.value;
      const controls = controlValuesFor(controlled).safeParse(next);
      if (!controls.success) {
        const choice = `${command.name} ${String(command.value)}`;
        throw new CommandError(
          `${controlled.name} refuses ${choice}: ${z.prettifyError(controls.error)}`,
        );
      }
      return { ...doc, controls: controls.data };
    }
  }
}

/**
 * The resume with the locked section `id`'s LaTeX replaced by `latex`, a retype of its words
 * (milestone 3 item 16, decision 0042): the section's runs of plain text, retyped and escaped by
 * `retyped` in `retype.ts`, the rest of its bytes as the upload wrote them. Throws a
 * `CommandError` for a section that is not a locked one, and for LaTeX a locked section may not
 * hold (`LockedLatex`): one that holds the editor's markers' texts, as typed text might, or whose
 * braces do not balance, which escaped text never unbalances. Nothing else of the section changes,
 * so its structure is the same (`structureOf`), and the app checks its page before it keeps it
 * (`RetypeGuard`).
 */
function retypeSection(resume: Resume, id: string, latex: string): Resume {
  const index = resume.sections.findIndex((section) => section.id === id);
  const section = resume.sections[index];
  if (section?.kind !== "locked") throw new CommandError(`the document has no locked part ${id}`);
  const parsed = LockedLatex.safeParse(latex);
  if (!parsed.success)
    throw new CommandError(`the locked part ${id} cannot keep that text: ${parsed.error.message}`);
  const sections = [...resume.sections];
  sections[index] = { ...section, latex: parsed.data };
  return { ...resume, sections };
}

/**
 * A `CommandError` for a unit added to a list its node keeps whole as the upload had it (`kept`):
 * the generator sets that list from the node's extras alone, so a new unit would be in the
 * document and never on the page (decision 0026).
 */
function refuseKept(
  node: { kept?: readonly string[] | undefined },
  list: "bullets" | "entries" | "items" | "links",
  name: string,
): void {
  if (keptOf(node).has(list))
    throw new CommandError(
      `${name} keeps its ${list} as the upload had them, and takes no new one`,
    );
}

/** A `CommandError` for a unit of a kind `pkg` cannot take (`addable`). */
function refuseUnaddable(pkg: TemplatePackage | undefined, kind: UnitKind): void {
  if (!addable(pkg, kind))
    throw new CommandError(
      `the template cannot take another ${UNIT_NAMES[kind]}: adding or removing one stops its compile`,
    );
}

/** A `CommandError` for the removal of a unit of a kind `pkg` cannot lose (`removable`). */
function refuseUnremovable(pkg: TemplatePackage | undefined, kind: UnitKind): void {
  if (!removable(pkg, kind))
    throw new CommandError(
      `the template cannot lose a ${UNIT_NAMES[kind]}: adding or removing one stops its compile`,
    );
}

/** A `CommandError` for a step the template stops after with the locked part `id` (`pinnedSteps`). */
function refusePinned(pkg: TemplatePackage | undefined, id: string, step: PinStep): void {
  if (pinnedSteps(pkg, id).has(step))
    throw new CommandError(
      step === "remove"
        ? `the template stops without the locked section ${id}`
        : `the template stops when the locked section ${id} moves ${step}`,
    );
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

/** A node's kind and where it sits, the place of each node an op changes or adds to, an entry's role. */
type Located =
  | { kind: "link"; siblings: Siblings; node: Place<Link> }
  | { kind: "section"; siblings: Siblings; node: Place<Section> }
  | { kind: "entry"; siblings: Siblings; node: Place<Entry>; role: SectionRole }
  | { kind: "bullet"; siblings: Siblings }
  | { kind: "item"; siblings: Siblings; unit: "item" | "labelledItem" };

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
          const { role } = section;
          nodes.set(entry.id, { kind: "entry", siblings: here, node: place, role });
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
          const here = siblings(items, i, section.items.length);
          nodes.set(item.id, { kind: "item", siblings: here, unit: "item" });
        });
        break;
      }
      case "labelled": {
        const items = under(ofKind(node, "labelled"), "items");
        section.items.forEach((item, i) => {
          const here = siblings(items, i, section.items.length);
          nodes.set(item.id, { kind: "item", siblings: here, unit: "labelledItem" });
        });
        break;
      }
      case "paragraph":
      case "locked":
      case "outline":
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
 * model refuses; and, by `pkg`, a unit of a kind the package cannot take or lose, a bullet for an
 * entry whose snippet shows none, a unit for a list its node keeps whole, a slot the header keeps as
 * the upload had it, and a field it requires emptied. A new node's id is minted against every id in
 * the resume, so ids stay unique.
 */
function restructure(resume: Resume, op: StructureOp, pkg: TemplatePackage | undefined): Resume {
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
      refuseUnaddable(pkg, `section.${kind}`);
      return insertAt(resume, SECTIONS, op.at, newSection(mint("sec"), kind, role));
    }
    case "removeSection": {
      const { node, siblings } = find(op.id, "section");
      const { kind } = node.get(resume);
      // An outline holds the whole of an imported resume, `\begin{document}` with it.
      if (kind === "outline")
        throw new CommandError(`the outline ${op.id} is the imported resume, which stays`);
      // A locked section is no unit of a kind: the user removes it as any part of the page, but
      // for one the template stops without (decision 0041).
      if (kind !== "locked") refuseUnremovable(pkg, `section.${kind}`);
      else refusePinned(pkg, op.id, "remove");
      return siblings.remove(resume);
    }
    case "moveSection": {
      const located = find(op.id, "section");
      // A locked section the template stops after moving that way stays (decision 0041).
      if (located.node.get(resume).kind === "locked") {
        const from = resume.sections.findIndex((section) => section.id === op.id);
        if (op.to < from) refusePinned(pkg, op.id, "up");
        else if (op.to > from) refusePinned(pkg, op.id, "down");
      }
      return moveTo(resume, located, op.id, op.to);
    }
    case "setSection": {
      const { node } = find(op.id, "section");
      const section = node.get(resume);
      if (section.kind === "locked" || section.kind === "outline")
        throw new CommandError(`the ${section.kind} section ${op.id} keeps its role, other`);
      if (op.role === undefined) return resume;
      const role = checked(SectionRole, op.role, "a section's role");
      return node.put(resume, { ...section, role });
    }
    case "addEntry": {
      const { node } = find(op.section, "section");
      const section = node.get(resume);
      const { kind } = section;
      if (kind !== "entries")
        throw new CommandError(`the ${kind} section ${op.section} holds no entries`);
      refuseKept(section, "entries", op.section);
      refuseUnaddable(pkg, "entry");
      const { title, subtitle, place } = PLACEHOLDERS.entry;
      const entry: Entry = { id: mint("ent"), title, subtitle, place, bullets: [] };
      return insertAt(resume, under(ofKind(node, "entries"), "entries"), op.at, entry);
    }
    case "removeEntry": {
      const { siblings } = find(op.id, "entry");
      refuseUnremovable(pkg, "entry");
      return siblings.remove(resume);
    }
    case "moveEntry":
      return moveTo(resume, find(op.id, "entry"), op.id, op.to);
    case "addBullet": {
      const entry = find(op.entry, "entry");
      refuseKept(entry.node.get(resume), "bullets", op.entry);
      // A bullet the entry's snippet has no place for would be in the document and never on the
      // page.
      if (!showsBullets(pkg, entry.role))
        throw new CommandError(
          `the template sets no bullets for an entry of its ${entry.role} sections, as ${op.entry} is`,
        );
      refuseUnaddable(pkg, "bullet");
      const bullets = under(entry.node, "bullets");
      const bullet = { id: mint("bul"), text: [{ text: PLACEHOLDERS.bullet }] };
      return insertAt(resume, bullets, op.at, bullet);
    }
    case "removeBullet": {
      const { siblings } = find(op.id, "bullet");
      refuseUnremovable(pkg, "bullet");
      return siblings.remove(resume);
    }
    case "moveBullet":
      return moveTo(resume, find(op.id, "bullet"), op.id, op.to);
    case "addItem": {
      const { node } = find(op.section, "section");
      const section = node.get(resume);
      const { kind } = section;
      if (kind === "list" || kind === "labelled") refuseKept(section, "items", op.section);
      if (kind === "list") {
        refuseUnaddable(pkg, "item");
        const item = { id: mint("itm"), text: [{ text: PLACEHOLDERS.item }] };
        return insertAt(resume, under(ofKind(node, "list"), "items"), op.at, item);
      }
      if (kind === "labelled") {
        refuseUnaddable(pkg, "labelledItem");
        const { label, text } = PLACEHOLDERS.labelledItem;
        const item = { id: mint("itm"), label, text: [{ text }] };
        return insertAt(resume, under(ofKind(node, "labelled"), "items"), op.at, item);
      }
      throw new CommandError(`the ${kind} section ${op.section} holds no items`);
    }
    case "removeItem": {
      const { siblings, unit } = find(op.id, "item");
      refuseUnremovable(pkg, unit);
      return siblings.remove(resume);
    }
    case "moveItem":
      return moveTo(resume, find(op.id, "item"), op.id, op.to);
    case "addLink": {
      refuseKept(resume.header, "links", "the header");
      refuseUnaddable(pkg, "link");
      const { label } = PLACEHOLDERS.link;
      const link: Link = { id: mint("lnk"), kind: "website", label, href: "" };
      return insertAt(resume, LINKS, op.at, link);
    }
    case "removeLink": {
      const { siblings } = find(op.id, "link");
      refuseUnremovable(pkg, "link");
      return siblings.remove(resume);
    }
    case "moveLink":
      return moveTo(resume, find(op.id, "link"), op.id, op.to);
    case "setLink": {
      const { node } = find(op.id, "link");
      const before = node.get(resume);
      const link = { ...before };
      if (op.kind !== undefined) link.kind = checked(LinkKind, op.kind, "a link's kind");
      if (op.label !== undefined) {
        link.label = checkedText(op.label, `${op.id}.label`);
        const slot: FieldSlot = { snippet: "link", name: "label" };
        refuseEmptied(pkg, slot, `${op.id}.label`, before.label, link.label);
      }
      if (op.href !== undefined) link.href = checkedText(op.href, `${op.id}'s address`);
      return node.put(resume, link);
    }
    case "setHeader": {
      const header = { ...resume.header };
      const kept = keptOf(resume.header);
      for (const key of HEADER_TEXTS) {
        const value = op[key];
        if (value === undefined) continue;
        // A slot the header keeps is no field: the page sets what the upload had there.
        if (kept.has(key))
          throw new CommandError(`header.${key} is kept as the upload had it, and takes no edit`);
        header[key] = checkedText(value, `header.${key}`);
        const slot: FieldSlot = { snippet: "header", name: key };
        refuseEmptied(pkg, slot, `header.${key}`, resume.header[key], header[key]);
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
 * Its commands are applied under `pkg`, the document's package, its curated one when it is left
 * out (`apply`).
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
  /**
   * The oldest steps the last step of one command let go past `HISTORY_LIMIT` (`bound`), which
   * `takeBack` gives back with it, so that a step taken back for good costs no other; none once
   * anything else has changed the history.
   */
  private shed: Document[] = [];

  constructor(
    private current: Document,
    private readonly pkg?: TemplatePackage,
  ) {}

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
    const next = applyUnder(this.pkg, this.current, command);
    if (sameValue(next, this.current)) return this.current;
    this.shed = [];
    if (group === undefined || group !== this.open?.group) {
      this.end();
      this.past.push(this.current);
      this.open = group === undefined ? undefined : { group, future: this.future };
      // A step of one command is a change, so it stays; an open one is bound once it has ended.
      if (this.open === undefined) this.shed = this.bound();
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
    this.shed = [];
    this.end();
  }

  /**
   * The document before the present step, which becomes the present; undefined at the start. The
   * open step ends first (`seal`), and is undone whole, so a command after it begins a new one.
   */
  undo(): Document | undefined {
    this.shed = [];
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
    this.shed = [];
    this.end();
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /**
   * Take the present step back for good: the document before it becomes the present, as with
   * `undo`, but the step is not kept to redo, and what the step cleared to redo stays cleared. A
   * retype whose page did not pass is taken back so (`RetypeGuard`, decision 0042), so that no redo
   * brings back a change that was refused; a step it let go past `HISTORY_LIMIT` comes back.
   * Undefined at the start.
   */
  takeBack(): Document | undefined {
    this.open = undefined;
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.past.unshift(...this.shed);
    this.shed = [];
    this.current = previous;
    return previous;
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
  private bound(): Document[] {
    const shed: Document[] = [];
    while (this.past.length > HISTORY_LIMIT) shed.push(this.past.shift() as Document);
    return shed;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
