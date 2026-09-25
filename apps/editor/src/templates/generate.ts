/**
 * The generator: the one program between the resume model, a template package and TeX.
 *
 * A package is data (decision 0006), so everything between a resume and its page happens here, as
 * pure functions of the package, the resume and the document's control values: the format each
 * template's documents compile from, and the body each compile sends. User text enters LaTeX only
 * through a snippet's slots, and each slot is escaped by its type (`escape.ts`), so no text a user
 * types can act as LaTeX, whatever the package holds. Every typeset slot is wrapped in the markers
 * `fields.ts` reads, named after its node's id so that a field keeps its name through a reorder,
 * and the body comes with each field's text, which the page aligns its glyphs to. Decision 0007
 * records the rules.
 */

import type {
  Entry,
  Header,
  Link,
  Resume,
  RichText,
  Section,
  SectionRole,
} from "@resume-tools/resume-model";
import { formatDates } from "./dates";
import { escapeText, escapeUrl, isBlank } from "./escape";
import {
  type BULLET_SLOTS,
  type ByRole,
  type CONTACT_SLOTS,
  type ControlValues,
  type DateFormat,
  type DOCUMENT_SLOTS,
  defaultControls,
  type ENTRY_SLOTS,
  type HEADER_SLOTS,
  type ITEM_SLOTS,
  type LABELLED_ITEM_SLOTS,
  type LINK_SLOTS,
  type SECTION_SLOTS,
  type TemplatePackage,
} from "./package";
import { PRELUDE } from "./prelude";
import { parseSnippet, type SlotType, type SnippetNode } from "./snippet";

/** A package the generator cannot render: the body would pass MAX_BODY, or a variant is missing. */
export class GenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerateError";
  }
}

/**
 * The longest body the generator builds, in characters. A resume's body is tens of kilobytes, but
 * a package may repeat a list slot any number of times, and packages will come from other users,
 * so the generator stops past this rather than hand TeX a gigabyte. Each tag and list item it
 * renders costs a character as well, so a package that repeats slots which render nothing stops
 * as soon.
 */
export const MAX_BODY = 1_048_576;

/** A template's format: the preamble dumped under `name`, with `files` beside it. */
export interface GeneratedFormat {
  name: string;
  preamble: string;
  files: Record<string, string>;
}

/** A body to compile from its format, with the text of each field it marks, by field id. */
export interface GeneratedBody {
  latex: string;
  texts: Map<string, string>;
}

/** What a slot holds while a snippet renders. User text carries the id of its field. */
type Value =
  | { type: "text"; text: string; field: string }
  | { type: "rich"; runs: RichText; field: string }
  | { type: "date"; text: string | undefined; field: string }
  | { type: "url"; url: string }
  | { type: "list"; parts: readonly Part[]; separator: string }
  /** A control's value, which is not a field: it goes in as it is, typeset or raw. */
  | { type: "value"; text: string };

type ValueOf<T extends SlotType> = Extract<Value, { type: T }>;
type Scope = Readonly<Record<string, Value>>;
/** The scope of a snippet with these slots, so a scope that drifts from `package.ts` fails here. */
type ScopeOf<S extends Readonly<Record<string, SlotType>>> = {
  readonly [K in keyof S]: ValueOf<S[K]>;
};

/** A snippet and the slots it renders with: the whole document, or one item of a list. */
interface Part {
  nodes: readonly SnippetNode[];
  scope: Scope;
}

/**
 * The format for a package and a document's control values. Its name is the package's id when no
 * control is format-bound; otherwise one format stands for each combination of format-bound
 * values, as `<id>-<8 hex digits>`, with the id cut to 55 characters so that the name fits the
 * session's 64 however long the id is. The digits are an FNV-1a hash of the package id and the
 * values as the preamble has them, so values that give the same preamble share a format, and two
 * long ids that begin alike do not.
 */
export function formatName(pkg: TemplatePackage, values: ControlValues): string {
  const bound = controlsOf(pkg, values)
    .filter((control) => control.format)
    .map((control) => [control.id, control.text]);
  if (bound.length === 0) return pkg.id;
  const hash = fnv1a(JSON.stringify([pkg.id, ...bound]));
  return `${pkg.id.slice(0, 55)}-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * What the session dumps: the package's preamble with each format-bound control's slot set to its
 * value, followed by the prelude, which comes after the template's own preamble so that it sees
 * hyperref; and the package's files, which the session writes beside it.
 */
export function generateFormat(pkg: TemplatePackage, values: ControlValues): GeneratedFormat {
  const scope: Record<string, Value> = {};
  for (const control of controlsOf(pkg, values))
    if (control.format) scope[control.id] = { type: "value", text: control.text };
  const out = new Output(Number.POSITIVE_INFINITY);
  render({ nodes: parseSnippet(pkg.preamble), scope }, out, new Map());
  return { name: formatName(pkg, values), preamble: `${out.join()}\n${PRELUDE}`, files: pkg.files };
}

/**
 * What the session compiles from the format: each control's snippet for its value, a line each,
 * in the schema's order and whether or not the control is format-bound, since a format-bound
 * value is applied as well as dumped (decision 0006); then the `document` snippet, which runs from
 * `\begin{document}` to `\end{document}`. `texts` holds every field the body marks, with the text
 * the page shows for it: the text, a rich field's runs joined, or the formatted dates.
 */
export function generateBody(
  pkg: TemplatePackage,
  resume: Resume,
  values: ControlValues,
): GeneratedBody {
  // Packages were validated, so a snippet that does not parse here is a bug, and may throw.
  const trees = new Map<string, readonly SnippetNode[]>();
  const tree = (source: string) => {
    let nodes = trees.get(source);
    if (nodes === undefined) {
      nodes = parseSnippet(source);
      trees.set(source, nodes);
    }
    return nodes;
  };
  const out = new Output(MAX_BODY);
  const texts = new Map<string, string>();
  for (const control of controlsOf(pkg, values)) {
    const scope = { value: { type: "value", text: control.text } } satisfies Scope;
    render({ nodes: tree(control.apply), scope }, out, texts);
    out.add("\n");
  }
  const build: Build = {
    pkg,
    tree,
    dateFormat: values.dateFormat ?? defaultControls(pkg).dateFormat,
  };
  render(documentPart(build, resume), out, texts);
  out.add("\n");
  return { latex: out.join(), texts };
}

/** The controls that have a snippet, which is every one but the date format. */
type Applied = Exclude<keyof ControlValues, "dateFormat">;

/** A control the package offers, with the document's value for it. */
interface Control {
  id: Applied;
  /** The value as snippets have it: `a4`, `0.5`, `10.5`, a font's id, `1F4E79`, `compact`. */
  text: string;
  /** The snippet that applies the value, before `\begin{document}`. */
  apply: string;
  /** The value is also a slot of the preamble, so each value has a format of its own. */
  format: boolean;
}

/**
 * The controls the package offers, in the schema's key order, each with the document's value or,
 * where it has none, the package's default, as `defaultControls` gives it. A value for a control
 * the package does not offer is ignored here; `controlValuesFor` is where it is refused.
 */
function controlsOf(pkg: TemplatePackage, values: ControlValues): Control[] {
  const { pageSize, margins, fontSize, font, accent, density } = pkg.controls;
  const controls: Control[] = [];
  const add = (id: Applied, text: string, apply: string, format: boolean | undefined) =>
    controls.push({ id, text, apply, format: format === true });
  if (pageSize) {
    const value = values.pageSize ?? pageSize.default;
    add("pageSize", value, variant(pageSize.apply, value, "page size"), pageSize.format);
  }
  if (margins)
    add("margins", tenths(values.margins ?? margins.default), margins.apply, margins.format);
  if (fontSize)
    add("fontSize", tenths(values.fontSize ?? fontSize.default), fontSize.apply, fontSize.format);
  if (font) {
    const value = values.font ?? font.default;
    const choice = font.choices.find((choice) => choice.id === value);
    if (!choice) throw new GenerateError(`the template has no font ${value}`);
    add("font", value, choice.apply, font.format);
  }
  if (accent) {
    // xcolor reads either case, but TeX's own hexadecimal numbers need capitals.
    const digits = (values.accent ?? accent.default).slice(1).toUpperCase();
    add("accent", digits, accent.apply, accent.format);
  }
  if (density) {
    const value = values.density ?? density.default;
    add("density", value, variant(density.apply, value, "density"), density.format);
  }
  return controls;
}

/** The snippet for one value of a control, which a stored value may have outlived. */
function variant(snippets: Readonly<Record<string, string>>, value: string, control: string) {
  const snippet = Object.hasOwn(snippets, value) ? snippets[value] : undefined;
  if (snippet === undefined) throw new GenerateError(`the template has no ${control} ${value}`);
  return snippet;
}

/**
 * Margins go in tenths of an inch and sizes in half points, so a value renders to the tenth: one
 * that arithmetic left as 0.7000000000000001 is `0.7` in the LaTeX and in the format's name.
 */
const tenths = (value: number) => String(Math.round(value * 10) / 10);

const UTF8 = new TextEncoder();

/** FNV-1a, 32 bits, over UTF-8: a short name for a combination of values, not a secret. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of UTF8.encode(text)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

/** What every part of a body is built with. */
interface Build {
  pkg: TemplatePackage;
  dateFormat: DateFormat;
  /** A snippet's tree, parsed once however many nodes it sets. */
  tree: (source: string) => readonly SnippetNode[];
}

/** The header's contact fields in the order `{{contacts}}` sets them, before the links. */
const CONTACTS = ["phone", "email", "location"] as const;

function documentPart(build: Build, resume: Resume): Part {
  const { snippets } = build.pkg;
  const sections = resume.sections.map((section) => sectionPart(build, section));
  const scope: ScopeOf<typeof DOCUMENT_SLOTS> = {
    header: listSlot([headerPart(build, resume.header)], ""),
    sections: listSlot(sections, snippets.separators.sections),
  };
  return { nodes: build.tree(snippets.document), scope };
}

function headerPart(build: Build, header: Header): Part {
  const { snippets } = build.pkg;
  const links = header.links.map((link) => linkPart(build, link));
  // A contact field is left out when the package has no snippet for it, and when it is empty,
  // so that the separator falls only between the contacts that are there.
  const contacts: Part[] = [];
  for (const kind of CONTACTS) {
    const source = snippets.contact?.[kind];
    const text = header[kind] ?? "";
    if (source === undefined || isBlank(text)) continue;
    const scope: ScopeOf<typeof CONTACT_SLOTS> = { text: textSlot(`header.${kind}`, text) };
    contacts.push({ nodes: build.tree(source), scope });
  }
  const scope: ScopeOf<typeof HEADER_SLOTS> = {
    first: textSlot("header.first", header.name.first),
    last: textSlot("header.last", header.name.last),
    headline: textSlot("header.headline", header.headline),
    email: textSlot("header.email", header.email),
    phone: textSlot("header.phone", header.phone),
    location: textSlot("header.location", header.location),
    links: listSlot(links, snippets.separators.links),
    contacts: listSlot([...contacts, ...links], snippets.separators.contacts),
  };
  return { nodes: build.tree(snippets.header), scope };
}

/** A link through its kind's snippet, or through `other`'s when its kind has none. */
function linkPart(build: Build, link: Link): Part {
  const snippets = build.pkg.snippets.link;
  const scope: ScopeOf<typeof LINK_SLOTS> = {
    label: textSlot(`${link.id}.label`, link.label),
    href: { type: "url", url: link.href },
  };
  return { nodes: build.tree(snippets[link.kind] ?? snippets.other), scope };
}

/** A section through its kind's snippet, and everything in it through its role's variants. */
function sectionPart(build: Build, section: Section): Part {
  const { snippets } = build.pkg;
  const { role } = section;
  const nodes = build.tree(byRole(snippets.section[section.kind], role));
  const title = textSlot(`${section.id}.title`, section.title);
  switch (section.kind) {
    case "entries": {
      const entries = section.entries.map((entry) => entryPart(build, entry, role));
      const scope: ScopeOf<(typeof SECTION_SLOTS)["entries"]> = {
        title,
        entries: listSlot(entries, byRole(snippets.separators.entries, role)),
      };
      return { nodes, scope };
    }
    case "list": {
      const item = build.tree(byRole(snippets.item, role));
      const items = section.items.map((it): Part => {
        const scope: ScopeOf<typeof ITEM_SLOTS> = { text: richSlot(`${it.id}.text`, it.text) };
        return { nodes: item, scope };
      });
      const scope: ScopeOf<(typeof SECTION_SLOTS)["list"]> = {
        title,
        items: listSlot(items, byRole(snippets.separators.items, role)),
      };
      return { nodes, scope };
    }
    case "labelled": {
      const item = build.tree(byRole(snippets.labelledItem, role));
      const items = section.items.map((it): Part => {
        const scope: ScopeOf<typeof LABELLED_ITEM_SLOTS> = {
          label: textSlot(`${it.id}.label`, it.label),
          text: richSlot(`${it.id}.text`, it.text),
        };
        return { nodes: item, scope };
      });
      const scope: ScopeOf<(typeof SECTION_SLOTS)["labelled"]> = {
        title,
        items: listSlot(items, byRole(snippets.separators.items, role)),
      };
      return { nodes, scope };
    }
    case "paragraph": {
      const scope: ScopeOf<(typeof SECTION_SLOTS)["paragraph"]> = {
        title,
        text: richSlot(`${section.id}.text`, section.text),
      };
      return { nodes, scope };
    }
  }
}

function entryPart(build: Build, entry: Entry, role: SectionRole): Part {
  const { snippets } = build.pkg;
  const bullet = build.tree(byRole(snippets.bullet, role));
  const bullets = entry.bullets.map((it): Part => {
    const scope: ScopeOf<typeof BULLET_SLOTS> = { text: richSlot(`${it.id}.text`, it.text) };
    return { nodes: bullet, scope };
  });
  const scope: ScopeOf<typeof ENTRY_SLOTS> = {
    title: textSlot(`${entry.id}.title`, entry.title),
    subtitle: textSlot(`${entry.id}.subtitle`, entry.subtitle),
    place: textSlot(`${entry.id}.place`, entry.place),
    dates: {
      type: "date",
      text: entry.dates && formatDates(entry.dates, build.dateFormat),
      field: `${entry.id}.dates`,
    },
    bullets: listSlot(bullets, byRole(snippets.separators.bullets, role)),
  };
  return { nodes: build.tree(byRole(snippets.entry, role)), scope };
}

/** A snippet or separator for a section's role: the role's own variant, or the default. */
function byRole(value: ByRole<string>, role: SectionRole): string {
  return typeof value === "string" ? value : (value[role] ?? value.default);
}

const textSlot = (field: string, text: string | undefined): ValueOf<"text"> => ({
  type: "text",
  text: text ?? "",
  field,
});
const richSlot = (field: string, runs: RichText): ValueOf<"rich"> => ({
  type: "rich",
  runs,
  field,
});
const listSlot = (parts: readonly Part[], separator: string): ValueOf<"list"> => ({
  type: "list",
  parts,
  separator,
});

/** A walk's place in a snippet, or in a list whose items it is rendering one by one. */
type Frame =
  | { kind: "nodes"; nodes: readonly SnippetNode[]; next: number; scope: Scope }
  | { kind: "list"; list: ValueOf<"list">; next: number };

/**
 * Render a part into the output. The walk keeps a stack of its own rather than recursing, as
 * `checkSnippet` does, since blocks nest to any depth in a snippet that parses; and a list's items
 * join the stack one at a time, so every step is small and each is counted against MAX_BODY. A
 * block over a list tests whether it has items, and never iterates: a list renders only through
 * its slot.
 */
function render(part: Part, out: Output, texts: Map<string, string>) {
  const stack: Frame[] = [{ kind: "nodes", nodes: part.nodes, next: 0, scope: part.scope }];
  for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
    out.step();
    if (frame.kind === "list") {
      const item = frame.list.parts[frame.next];
      if (item === undefined) {
        stack.pop();
        continue;
      }
      if (frame.next > 0) out.add(frame.list.separator);
      frame.next++;
      stack.push({ kind: "nodes", nodes: item.nodes, next: 0, scope: item.scope });
      continue;
    }
    const node = frame.nodes[frame.next++];
    if (node === undefined) {
      stack.pop();
    } else if (node.kind === "text") {
      out.add(node.text);
    } else if (node.kind === "block") {
      if (isPresent(slot(frame.scope, node.name)) === node.present)
        stack.push({ kind: "nodes", nodes: node.children, next: 0, scope: frame.scope });
    } else {
      const value = slot(frame.scope, node.name);
      if (value.type !== "list") out.add(renderValue(value, node.raw, texts));
      else if (node.raw) throw new Error(`${node.name} is a list, which never goes in raw`);
      else stack.push({ kind: "list", list: value, next: 0 });
    }
  }
}

/** A slot's value. The schema lets a snippet use only its place's slots, so a miss is a bug. */
function slot(scope: Scope, name: string): Value {
  const value = Object.hasOwn(scope, name) ? scope[name] : undefined;
  if (value === undefined) throw new Error(`there is no slot ${name} here`);
  return value;
}

/** Whether a block over a slot is kept: text that shows, a date that exists, a list with items. */
function isPresent(value: Value): boolean {
  switch (value.type) {
    case "text":
    case "value":
      return !isBlank(value.text);
    case "rich":
      return !isBlank(joined(value.runs));
    case "date":
      return value.text !== undefined;
    case "url":
      return !isBlank(value.url);
    case "list":
      return value.parts.length > 0;
  }
}

/** A slot other than a list: typeset in its field's markers, or raw, escaped for where it goes. */
function renderValue(
  value: Exclude<Value, { type: "list" }>,
  raw: boolean,
  texts: Map<string, string>,
): string {
  switch (value.type) {
    case "value":
      return value.text;
    case "url":
      // The schema refuses a typeset URL, since its markers would end up in the address.
      if (!raw) throw new Error("a URL goes in raw");
      return escapeUrl(value.url);
    case "text":
      if (raw) return escapeText(value.text);
      return field(value.field, value.text, escapeText(value.text), texts);
    case "rich":
      if (raw) return richLatex(value.runs);
      return field(value.field, joined(value.runs), richLatex(value.runs), texts);
    case "date":
      if (value.text === undefined) return "";
      if (raw) return escapeText(value.text);
      return field(value.field, value.text, escapeText(value.text), texts);
  }
}

/** A typeset field in its markers, or nothing when it would show nothing. */
function field(id: string, text: string, latex: string, texts: Map<string, string>): string {
  if (isBlank(text)) return "";
  texts.set(id, text);
  return `\\rtfield{${id}}{${latex}}`;
}

/** Rich text as LaTeX, run by run: bold outside italic, and a link outside both. */
function richLatex(runs: RichText): string {
  let latex = "";
  for (const run of runs) {
    let part = escapeText(run.text);
    if (part === "") continue;
    if (run.italic) part = `\\textit{${part}}`;
    if (run.bold) part = `\\textbf{${part}}`;
    if (run.href !== undefined && !isBlank(run.href))
      part = `\\href{${escapeUrl(run.href)}}{${part}}`;
    latex += part;
  }
  return latex;
}

/** The text a rich field shows: its runs, one after another. */
const joined = (runs: RichText) => runs.map((run) => run.text).join("");

/** Output as it grows, which stops the moment it passes its limit. */
class Output {
  private readonly parts: string[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  add(text: string) {
    this.spend(text.length);
    this.parts.push(text);
  }

  /** A step of the walk, which costs a character, so repeating slots that add nothing stops too. */
  step() {
    this.spend(1);
  }

  join(): string {
    return this.parts.join("");
  }

  private spend(size: number) {
    this.size += size;
    if (this.size > this.limit)
      throw new GenerateError(`the body would pass MAX_BODY, ${this.limit} characters`);
  }
}
