/**
 * The generator: the one program between the resume model, a template package and TeX.
 *
 * A package is data (decision 0006), so everything between a resume and its page happens here, as
 * pure functions of the package, the resume and the document's control values: the format each
 * template's documents compile from, and the body each compile sends. User text enters LaTeX only
 * through a snippet's slots, and each slot is escaped by its type (`escape.ts`), so no text a user
 * types can act as LaTeX, whatever the package holds; and an address a user types links only to
 * the web, an email or a phone (`linkAddress`), never to a program or a file. Every typeset slot
 * is wrapped in the markers `fields.ts` reads, named after its node's id so that a field keeps
 * its name through a reorder, and the body comes with each field's text, which the page aligns
 * its glyphs to. Decision 0007 records the rules.
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
import { INVISIBLE } from "../tex/fields";
import { runBreaks, UNBROKEN_RUN } from "../tex/runs";
import { formatDates } from "./dates";
import { escapeText, escapeUrl, isBlank, type TextFonts } from "./escape";
import {
  type BULLET_SLOTS,
  type ByRole,
  type CONTACT_SLOTS,
  type ControlValues,
  type DateFormat,
  type DOCUMENT_SLOTS,
  defaultControls,
  type ENTRY_SLOTS,
  type FontFamily,
  type HEADER_SLOTS,
  type ITEM_SLOTS,
  type LABELLED_ITEM_SLOTS,
  type LINK_SLOTS,
  type SECTION_SLOTS,
  type TemplatePackage,
} from "./package";
import { PRELUDE } from "./prelude";
import { parseSnippet, type SlotType, type SnippetNode, shownSlots } from "./snippet";

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
 * renders costs a character as well, and each slot the length of its source, so a package that
 * repeats slots which render nothing, or a long field, stops as soon.
 */
export const MAX_BODY = 1_048_576;

/** A template's format: the preamble dumped under `name`, with `files` beside it. */
export interface GeneratedFormat {
  name: string;
  preamble: string;
  files: Record<string, string>;
}

/**
 * A body to compile from its format, with the text of each field it marks, by field id, and the
 * characters of them its fonts cannot set (`BodyOptions.covers`), which it left out, or set as the
 * part of them the fonts can, an accented letter's base, each once, in the order the body met them.
 */
export interface GeneratedBody {
  latex: string;
  texts: Map<string, string>;
  dropped: string[];
}

/** What a body is generated with besides the package, the resume and the document's values. */
export interface BodyOptions {
  /**
   * Which characters a XeTeX package's declared fonts can set wherever its template sets a text,
   * from their files (`nativeCoverage`, decision 0014). XeTeX sets a font's `.notdef` box for a
   * character the font lacks, where pdfTeX's LaTeX leaves the character out (`prelude.ts`), so
   * every character of a text this refuses is left out of the LaTeX, or set as the part of it this
   * takes, an accented letter as its base, and named in `GeneratedBody.dropped`; the text is kept
   * composed, as XeTeX's fonts set letters whole (`escapeText`). The field's text stays as the model holds it, and the page skips what the
   * LaTeX leaves out. Without it nothing is left out, as for a pdfTeX package.
   */
  covers?: (char: string) => boolean;
}

/** How a slot's user text is escaped for the body: `escapeText`, with the body's coverage. */
type Escape = (text: string) => string;

/**
 * What a slot holds while a snippet renders. User text carries the id of its field. Whether a
 * slot is present is decided once, when its value is built, so a block that tests it costs a
 * step however long the text is.
 */
type Value =
  | { type: "text"; text: string; field: string; present: boolean }
  /** `text` is the runs joined, which the page shows; `size` their length, addresses included. */
  | { type: "rich"; runs: RichText; text: string; size: number; field: string; present: boolean }
  | { type: "date"; text: string | undefined; field: string; present: boolean }
  | { type: "url"; url: string; present: boolean }
  | { type: "list"; parts: readonly Part[]; separator: string; present: boolean }
  /** A control's value, which is not a field: it goes in as it is, typeset or raw. */
  | { type: "value"; text: string; present: boolean };

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

/** The name of the format for a package and a document's values, which `generateFormat` gives. */
export function formatName(pkg: TemplatePackage, values: ControlValues): string {
  return generateFormat(pkg, values).name;
}

/**
 * What the session dumps: the package's preamble with each format-bound control's slot set to its
 * value, then a XeTeX package's font declarations (`fontDeclarations`), then the prelude, which
 * comes after the template's own preamble so that it sees hyperref; and the package's files,
 * which the session writes beside it.
 *
 * The format is named `<id>-<8 hex digits>`, with the id cut to 55 characters so that the name
 * fits the session's 64 however long the id is, and the digits an FNV-1a hash of exactly what is
 * dumped: the preamble and the files. The same dump has the same name, and anything that changes
 * it has another, be it the template's preamble, a format-bound value it uses, the prelude or a
 * file, while a format-bound value the preamble does not use keeps the name. Every name ends in
 * the suffix, so no package's id, however it is spelt, can be another package's format name.
 */
export function generateFormat(pkg: TemplatePackage, values: ControlValues): GeneratedFormat {
  const scope: Record<string, Value> = {};
  for (const control of controlsOf(pkg, values))
    if (control.format) scope[control.id] = valueSlot(control.text);
  const out = new Output(Number.POSITIVE_INFINITY);
  render({ nodes: parseSnippet(pkg.preamble), scope }, out, new Map(), escapeText, new WeakSet());
  const fonts = pkg.fonts === undefined ? "" : `${fontDeclarations(pkg.fonts)}\n`;
  const preamble = `${out.join()}\n${fonts}${PRELUDE}`;
  // By name, so that the same files listed in another order are the same dump. Names are keys,
  // so no two are equal.
  const files = Object.entries(pkg.files).sort(([a], [b]) => (a < b ? -1 : 1));
  const hash = fnv1a(JSON.stringify([preamble, files]));
  const name = `${pkg.id.slice(0, 55)}-${hash.toString(16).padStart(8, "0")}`;
  return { name, preamble, files: pkg.files };
}

/**
 * A XeTeX package's fonts as NFSS declarations, decision 0003's loop: each family in the TU
 * encoding, with `\DeclareFontFamily{TU}{<family>}{}`, and each shape as its file at every size,
 * with `\DeclareFontShape{TU}{<family>}{<series>}{<shape>}{<->"[<file>]:<features>"}{}`, or
 * `[<file>]` alone for a family without features. XeTeX finds the file by its name through
 * kpathsea, and loads nothing until a shape is selected, so the format they are dumped in holds no
 * native font and dumps; a template selects them in the body, as its preamble's
 * `\renewcommand{\rmdefault}{<family>}` does at `\begin{document}`. In the families' and shapes'
 * order, a line each (decision 0014).
 */
export function fontDeclarations(fonts: readonly FontFamily[]): string {
  const lines: string[] = [];
  for (const { family, shapes, features } of fonts) {
    lines.push(`\\DeclareFontFamily{TU}{${family}}{}`);
    for (const [key, file] of Object.entries(shapes)) {
      const [series, shape] = key.split("/");
      const name = features === undefined ? `[${file}]` : `[${file}]:${features}`;
      lines.push(`\\DeclareFontShape{TU}{${family}}{${series}}{${shape}}{<->"${name}"}{}`);
    }
  }
  return lines.join("\n");
}

/**
 * What the session compiles from the format: each control's snippet for its value, a line each,
 * in the schema's order and whether or not the control is format-bound, since a format-bound
 * value is applied as well as dumped (decision 0006); then the `document` snippet, which runs from
 * `\begin{document}` to `\end{document}`. Every render of a field is marked, however often the
 * package sets it, and `texts` holds each field the body marks once, with the text the page shows
 * for it: the text, a rich field's runs joined, or the formatted dates. The page keeps the first
 * copy of a field that reaches it (`collectFields`), which is the one the user edits. A character
 * `options.covers` says the package's fonts cannot set is left out (`BodyOptions`).
 */
export function generateBody(
  pkg: TemplatePackage,
  resume: Resume,
  values: ControlValues,
  options: BodyOptions = {},
): GeneratedBody {
  // Packages were validated, so a snippet that does not parse here is a bug, and may throw. Each
  // snippet's slot nodes that it shows in `\href`'s text are found as it is parsed (`shownSlots`).
  const trees = new Map<string, readonly SnippetNode[]>();
  const shown = new WeakSet<SnippetNode>();
  const tree = (source: string) => {
    let nodes = trees.get(source);
    if (nodes === undefined) {
      nodes = parseSnippet(source);
      trees.set(source, nodes);
      markShown(nodes, shownSlots(source), shown);
    }
    return nodes;
  };
  const out = new Output(MAX_BODY);
  const texts = new Map<string, string>();
  const dropped = new Set<string>();
  const { covers } = options;
  const fonts: TextFonts | undefined =
    covers === undefined ? undefined : { covers, lacks: (char) => dropped.add(char) };
  const escape: Escape = (text) => escapeText(text, fonts);
  for (const control of controlsOf(pkg, values)) {
    const scope = { value: valueSlot(control.text) } satisfies Scope;
    render({ nodes: tree(control.apply), scope }, out, texts, escape, shown);
    out.add("\n");
  }
  const build: Build = {
    pkg,
    tree,
    dateFormat: values.dateFormat ?? defaultControls(pkg).dateFormat,
  };
  render(documentPart(build, resume), out, texts, escape, shown);
  out.add("\n");
  return { latex: out.join(), texts, dropped: [...dropped] };
}

/**
 * Add to `shown` the slot nodes of a parsed snippet at the places `ordinals` gives among its slot
 * nodes in order, which are the places of its slot tags. The walk keeps its own stack, as
 * `render` does, since blocks nest to any depth.
 */
function markShown(
  nodes: readonly SnippetNode[],
  ordinals: ReadonlySet<number>,
  shown: WeakSet<SnippetNode>,
) {
  if (ordinals.size === 0) return;
  const stack = [...nodes].reverse();
  let k = 0;
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.kind === "slot") {
      if (ordinals.has(k)) shown.add(node);
      k++;
    } else if (node.kind === "block") stack.push(...[...node.children].reverse());
  }
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

/**
 * The address a contact links to, its snippet's `href`: `mailto:` and the address, trimmed;
 * `tel:` and the number with every space taken out; and none for the location. The field is
 * typed as text, so what an address reads as its own syntax is percent-encoded first (`encoded`);
 * the rest of the encoding is `escapeUrl`'s, which keeps a `%` it finds as it is.
 */
function contactAddress(kind: (typeof CONTACTS)[number], text: string): string {
  switch (kind) {
    case "email":
      return `mailto:${encoded(text.trim())}`;
    case "phone":
      return `tel:${encoded(text.replace(/\s/g, ""))}`;
    case "location":
      return "";
  }
}

/**
 * The characters of a contact field that an address would read as syntax rather than as the
 * field's: `#` and `?` would begin a fragment or a query, `&` would part a query, `/` a path, and
 * `%` would begin an escape, so that `a#b@example.com` would link to `a` with a fragment.
 */
const ADDRESS_SYNTAX = /[#?&%/]/g;

/** A contact field with its address syntax percent-encoded. */
const encoded = (text: string) =>
  text.replace(ADDRESS_SYNTAX, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The schemes an address from the resume may link with: the web's, email's and the phone's.
 * hyperref reads an address's scheme to choose the link's PDF action, and under the dvipdfmx
 * driver it makes a `run:` address a Launch action, which asks the reader to run a program; a
 * `file:` address, or one with no scheme, a GoToR link to a file, with `.pdf` added when it has no
 * extension, so that `github.com/mara` would open `github.com/mara.pdf`; `#name` a GoTo within the
 * document; and any other scheme, `javascript:` among them, a URI action a reader may follow.
 */
const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/** A scheme as RFC 3986 spells one, and its colon. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** An email address without its scheme: one `@`, and no whitespace, slash or colon. */
const EMAIL = /^[^\s/:@]+@[^\s/:@]+$/;

/**
 * The address a link from the resume goes to, a header link's `href` or a rich run's, or
 * undefined when the editor does not link it (decision 0007). The address is read as `escapeUrl`
 * writes it, without the characters that drops and the whitespace around it. One with a scheme
 * is kept when the scheme is `http`, `https`, `mailto` or `tel`, in any case, and is not linked
 * otherwise. One without gets `mailto:` when it reads as an email, `https:` when it begins with
 * `//`, and `https://` otherwise, so that `github.com/mara` links to `https://github.com/mara`.
 * One that is blank, or begins with `#` as a name within the document does, is not linked. The
 * addresses the generator builds for the contacts are its own, and do not come through here.
 */
export function linkAddress(href: string): string | undefined {
  const address = href.replace(INVISIBLE, "").trim();
  if (address === "" || address.startsWith("#")) return undefined;
  const scheme = SCHEME.exec(address)?.[1];
  if (scheme !== undefined) return LINK_SCHEMES.has(scheme.toLowerCase()) ? address : undefined;
  if (EMAIL.test(address)) return `mailto:${address}`;
  return address.startsWith("//") ? `https:${address}` : `https://${address}`;
}

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
  const fields = {
    phone: textSlot("header.phone", header.phone),
    email: textSlot("header.email", header.email),
    location: textSlot("header.location", header.location),
  };
  const links = header.links.flatMap((link) => linkPart(build, link) ?? []);
  // A contact field is left out when the package has no snippet for it, and when it is empty,
  // so that the separator falls only between the contacts that are there.
  const contacts: Part[] = [];
  for (const kind of CONTACTS) {
    const source = snippets.contact?.[kind];
    const text = fields[kind];
    if (source === undefined || !text.present) continue;
    const scope: ScopeOf<typeof CONTACT_SLOTS> = {
      text,
      href: urlSlot(contactAddress(kind, text.text)),
    };
    contacts.push({ nodes: build.tree(source), scope });
  }
  const scope: ScopeOf<typeof HEADER_SLOTS> = {
    first: textSlot("header.first", header.name.first),
    last: textSlot("header.last", header.name.last),
    headline: textSlot("header.headline", header.headline),
    email: fields.email,
    phone: fields.phone,
    location: fields.location,
    links: listSlot(links, snippets.separators.links),
    contacts: listSlot([...contacts, ...links], snippets.separators.contacts),
  };
  return { nodes: build.tree(snippets.header), scope };
}

/**
 * A link through its kind's snippet, or through `other`'s when its kind has none. Its `href` is
 * the address `linkAddress` gives, and absent when the editor does not link it, as when it is
 * blank. A link with neither a label nor an address, as a new one starts, shows nothing, so it is
 * left out of both `{{links}}` and `{{contacts}}`, where it would leave a separator with nothing
 * after it.
 */
function linkPart(build: Build, link: Link): Part | undefined {
  const label = textSlot(`${link.id}.label`, link.label);
  const href = urlSlot(linkAddress(link.href) ?? "");
  if (!label.present && !href.present) return undefined;
  const snippets = build.pkg.snippets.link;
  const scope: ScopeOf<typeof LINK_SLOTS> = { label, href };
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
    dates: dateSlot(`${entry.id}.dates`, entry.dates && formatDates(entry.dates, build.dateFormat)),
    bullets: listSlot(bullets, byRole(snippets.separators.bullets, role)),
  };
  return { nodes: build.tree(byRole(snippets.entry, role)), scope };
}

/** A snippet or separator for a section's role: the role's own variant, or the default. */
function byRole(value: ByRole<string>, role: SectionRole): string {
  return typeof value === "string" ? value : (value[role] ?? value.default);
}

// Each slot's presence is decided here, once, by the rule decision 0007 gives: text that shows
// something, a date that exists, a list with items.

function textSlot(field: string, text = ""): ValueOf<"text"> {
  return { type: "text", text, field, present: !isBlank(text) };
}

function richSlot(field: string, runs: RichText): ValueOf<"rich"> {
  const text = runs.map((run) => run.text).join("");
  const size = runs.reduce((size, run) => size + run.text.length + (run.href?.length ?? 0), 0);
  return { type: "rich", runs, text, size, field, present: !isBlank(text) };
}

function dateSlot(field: string, text: string | undefined): ValueOf<"date"> {
  return { type: "date", text, field, present: text !== undefined };
}

function urlSlot(url: string): ValueOf<"url"> {
  return { type: "url", url, present: !isBlank(url) };
}

function listSlot(parts: readonly Part[], separator: string): ValueOf<"list"> {
  return { type: "list", parts, separator, present: parts.length > 0 };
}

function valueSlot(text: string): Extract<Value, { type: "value" }> {
  return { type: "value", text, present: !isBlank(text) };
}

/** A walk's place in a snippet, or in a list whose items it is rendering one by one. */
type Frame =
  | { kind: "nodes"; nodes: readonly SnippetNode[]; next: number; scope: Scope }
  | { kind: "list"; list: ValueOf<"list">; next: number };

/**
 * Render a part into the output. The walk keeps a stack of its own rather than recursing, as
 * `checkSnippet` does, since blocks nest to any depth in a snippet that parses; and a list's items
 * join the stack one at a time, so every step is small and each is counted against MAX_BODY. A
 * block reads the presence its slot's value was built with, and a block over a list never
 * iterates: a list renders only through its slot. `shown` holds the slot nodes a snippet shows in
 * `\href`'s text (`markShown`).
 */
function render(
  part: Part,
  out: Output,
  texts: Map<string, string>,
  escape: Escape,
  shown: WeakSet<SnippetNode>,
) {
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
      if (slot(frame.scope, node.name).present === node.present)
        stack.push({ kind: "nodes", nodes: node.children, next: 0, scope: frame.scope });
    } else {
      const value = slot(frame.scope, node.name);
      if (value.type !== "list")
        out.add(renderValue(value, node.raw, out, texts, escape, shown.has(node)));
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

/**
 * A slot other than a list: typeset in its field's markers, or raw, escaped for where it goes. A
 * field that is absent sets nothing, markers included. Every render is charged its source's
 * length before anything is escaped, so a package that repeats a long field reaches MAX_BODY in
 * proportion, even where the field sets little or nothing.
 */
function renderValue(
  value: Exclude<Value, { type: "list" }>,
  raw: boolean,
  out: Output,
  texts: Map<string, string>,
  escape: Escape,
  shownHere: boolean,
): string {
  switch (value.type) {
    case "value":
      out.charge(value.text.length);
      return value.text;
    case "url":
      // The schema refuses a typeset URL, since its markers would end up in the address.
      if (!raw) throw new Error("a URL goes in raw");
      out.charge(value.url.length);
      return shownHere ? escapeUrl(value.url, UNBROKEN_RUN, BREAK) : escapeUrl(value.url);
    case "text":
      out.charge(value.text.length);
      if (raw) return escapeRun(value.text, escape);
      return value.present
        ? field(value.field, value.text, escapeRun(value.text, escape), texts)
        : "";
    case "rich":
      out.charge(value.size);
      if (raw) return richLatex(value.runs, escape);
      return value.present
        ? field(value.field, value.text, richLatex(value.runs, escape), texts)
        : "";
    case "date":
      if (value.text === undefined) return "";
      out.charge(value.text.length);
      if (raw) return escapeRun(value.text, escape);
      return field(value.field, value.text, escapeRun(value.text, escape), texts);
  }
}

/**
 * A field in its markers, every time it renders. A render may never reach the page, as one in a
 * PDF string or one `\settowidth` only measures does, so the page keeps the first copy that does
 * reach it, such as the first of a link a header sets through both `{{contacts}}` and
 * `{{links}}`: the one the user edits.
 */
function field(id: string, text: string, latex: string, texts: Map<string, string>): string {
  texts.set(id, text);
  return `\\rtfield{${id}}{${latex}}`;
}

/**
 * Rich text as LaTeX, run by run: bold outside italic, and a link outside both, to the address
 * `linkAddress` gives. A run whose address the editor does not link is set as its text alone.
 */
function richLatex(runs: RichText, escape: Escape): string {
  let latex = "";
  // A run of characters with no space goes on from one run of rich text into the next.
  let carried = 0;
  for (const run of runs) {
    const cut = runBreaks(run.text, carried);
    carried = cut.carried;
    let part = escapeRun(run.text, escape, cut.breaks);
    if (part === "") continue;
    if (run.italic) part = `\\textit{${part}}`;
    if (run.bold) part = `\\textbf{${part}}`;
    const address = run.href === undefined ? undefined : linkAddress(run.href);
    if (address !== undefined) part = `\\href{${escapeUrl(address)}}{${part}}`;
    // Two runs that neither wrap meet in one font, so a ? or ! that ends one would make OT1's ¿
    // or ¡ with a backtick that begins the next: they are kept apart as `escapeText` keeps them.
    if (part.startsWith("`") && /[?!]$/.test(latex)) latex += "{}";
    latex += part;
  }
  return latex;
}

/** A break opportunity that sets nothing, where TeX may end a line (`runBreaks`). */
const BREAK = "\\allowbreak ";

/**
 * Text as `escape` escapes it, with a break opportunity at each of `breaks`, UTF-16 offsets into
 * it, after every `UNBROKEN_RUN` characters of a run with no space in it unless given
 * (`runBreaks`). None comes where the pieces would escape otherwise than the whole, such as
 * before a combining mark (`runBreaks`).
 */
function escapeRun(text: string, escape: Escape, breaks = runBreaks(text).breaks): string {
  let latex = "";
  let from = 0;
  for (const at of breaks) {
    latex += escape(text.slice(from, at)) + BREAK;
    from = at;
  }
  return latex + escape(text.slice(from));
}

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

  /** Work in proportion to a slot's source, such as escaping it, which may add less than it cost. */
  charge(size: number) {
    this.spend(size);
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
