/**
 * The open document: the resume and the document's choices for its template's style controls,
 * as one JSON value. That value is what item 13 stores and milestone 4 syncs. It changes only
 * through commands, which `apply` turns into a new document without touching the old one, so undo
 * is keeping the documents that came before (`History`): the command stack for undo that plan
 * section 8.1 chooses, with nothing to invert.
 *
 * A command names its field as the page's markers do, `<node id>.<name>` (decision 0006), so a
 * click on the page and an edit to the model meet on one name. `fieldsOf` finds where each field
 * of a resume lives, in one walk, and gives each a reader and a writer. The writer copies the
 * nodes on the way down to the field and shares the rest with the resume it was given, which it
 * never changes, so a history of many documents costs little more than one.
 */

import {
  Dates,
  type Entry,
  Id,
  Resume,
  RichText,
  type Section,
  type SectionKind,
} from "@resume-tools/resume-model";
import { z } from "zod";
import { curated } from "../templates/curated";
import { ControlValues, controlValuesFor, defaultControls } from "../templates/package";

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
 * A new document for a curated template: the resume, and the template's default for each of its
 * controls, the page size following `locale` when one is given, as plan section 5.4 has it.
 * Throws for a template no curated package has, or a resume the model refuses.
 */
export function newDocument(template: string, resume: Resume, locale?: string): Document {
  const { package: pkg } = curated(template);
  // Parsed, so the document holds a copy of the resume rather than the caller's.
  return Document.parse({ version: 1, template, resume, controls: defaultControls(pkg, locale) });
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
 * and nothing a body never marks, such as a link's address or a section's role.
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

/** A choice for one of the template's controls; `undefined` goes back to the template's default. */
type ControlCommand = {
  [K in keyof ControlValues]-?: { type: "control"; name: K; value: ControlValues[K] };
}[keyof ControlValues];

/** A change to a document, the only way one changes. */
export type Command =
  | { type: "text"; field: string; text: string }
  | { type: "rich"; field: string; runs: RichText }
  | { type: "dates"; field: string; dates: Dates | undefined }
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
 * of another kind, runs or dates the model refuses, and a control value the template refuses, so
 * that no command makes a document `Document` would not read back. The runs and dates stored are
 * the model's parsed copies, so a caller that changes its own afterwards changes nothing here.
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

/**
 * How many documents `History` keeps to undo back to. Without a bound a session that edits for
 * hours would keep every document it ever had; two hundred steps is further back than anyone
 * undoes, and once item 12 makes a step a visit to a field rather than a keystroke, further still.
 */
export const HISTORY_LIMIT = 200;

/**
 * The document, with the ones before it for undo and the ones undone for redo. A command applies
 * to the present document, which joins the past; undo and redo move along the two, and a new
 * command after an undo clears what was undone. Every command is one step for now; item 12 makes
 * a step one visit to a field, so that undo takes back an edit rather than a keystroke.
 */
export class History {
  private readonly past: Document[] = [];
  private future: Document[] = [];

  constructor(private current: Document) {}

  get present(): Document {
    return this.current;
  }

  /** Apply a command to the present document, or throw a `CommandError` and change nothing. */
  dispatch(command: Command): Document {
    const next = apply(this.current, command);
    this.past.push(this.current);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }

  /** The document before the present one, which becomes the present; undefined at the start. */
  undo(): Document | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(this.current);
    this.current = previous;
    return previous;
  }

  /** The document last undone, which becomes the present again; undefined when there is none. */
  redo(): Document | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
