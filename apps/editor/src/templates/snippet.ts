/**
 * The snippet language, in which a template package maps the resume model onto its macros.
 *
 * A snippet is template text with slots, in a small language shaped like Mustache. `{{title}}` is
 * a typeset slot: the field, escaped for LaTeX and wrapped in its markers. `{{&href}}` is a raw
 * slot: the value escaped for where it goes, with no markers, which is the only way to use a URL
 * and the way to put text where a marker would break, as in `\href{mailto:{{&email}}}`. A
 * block, `{{#bullets}}...{{/bullets}}`, is kept when its slot is present, and
 * `{{^bullets}}...{{/bullets}}` when it is absent. User text reaches LaTeX only through slots, so
 * whether it can act as LaTeX is up to the generator, never to a template (decision 0006).
 *
 * LaTeX is full of braces, so a tag begins at the last two of a run of `{` and ends at the first
 * `}}` after its name: `\textbf{{{title}}}` is `\textbf{`, a slot and `}`. Two braces that do not
 * begin a well-formed tag are text, so `{{\bf x}}` needs no escaping.
 *
 * A block tag alone on its line takes the whole line with it, as in Mustache, so a block that is
 * left out leaves no blank line behind, which TeX would read as the end of a paragraph.
 */

export type SnippetNode =
  | { kind: "text"; text: string }
  | { kind: "slot"; name: string; raw: boolean }
  | { kind: "block"; name: string; present: boolean; children: SnippetNode[] };

/** A snippet that does not parse. */
export class SnippetError extends Error {
  /** Where the tag at fault begins in the snippet's source, in UTF-16 code units. */
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "SnippetError";
    this.offset = offset;
  }
}

/** What a slot holds, which decides how a snippet may use it. */
export type SlotType = "text" | "rich" | "date" | "url" | "list";

/** Two braces, an optional sigil, a name and two braces, with whitespace allowed in between. */
const TAG = /\{\{\s*([&#^/]?)\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/y;

interface Tag {
  sigil: string;
  name: string;
  /** Where the tag's braces begin. */
  at: number;
  /** What the tag takes out of the text: itself, or its whole line when it stands alone. */
  from: number;
  to: number;
}

/**
 * Parse a snippet into text, slots and blocks. Throws a SnippetError when a block's open and close
 * tags do not pair up.
 */
export function parseSnippet(source: string): SnippetNode[] {
  const root: SnippetNode[] = [];
  const open: { tag: Tag; children: SnippetNode[] }[] = [];
  let children = root;
  let textFrom = 0;
  for (const tag of scan(source)) {
    if (tag.from > textFrom)
      children.push({ kind: "text", text: source.slice(textFrom, tag.from) });
    textFrom = tag.to;
    if (tag.sigil === "" || tag.sigil === "&") {
      children.push({ kind: "slot", name: tag.name, raw: tag.sigil === "&" });
    } else if (tag.sigil === "/") {
      const block = open.pop();
      if (!block) throw new SnippetError(`${show(tag)} closes no block`, tag.at);
      if (block.tag.name !== tag.name)
        throw new SnippetError(`${show(tag)} cannot close ${show(block.tag)}`, tag.at);
      children = open.at(-1)?.children ?? root;
    } else {
      const nested: SnippetNode[] = [];
      children.push({
        kind: "block",
        name: tag.name,
        present: tag.sigil === "#",
        children: nested,
      });
      open.push({ tag, children: nested });
      children = nested;
    }
  }
  const unclosed = open.at(-1);
  if (unclosed) throw new SnippetError(`${show(unclosed.tag)} is never closed`, unclosed.tag.at);
  if (source.length > textFrom) children.push({ kind: "text", text: source.slice(textFrom) });
  return root;
}

/**
 * Check a parsed snippet against the slots its place in a package offers, and return what is
 * wrong, if anything: a name the place does not offer; a URL as a typeset slot, where its markers
 * would end up in the address; and a list as a raw slot, since a list goes in as the generator
 * renders it or names a block. A block may test any slot the place offers.
 */
export function checkSnippet(
  nodes: SnippetNode[],
  slots: Readonly<Record<string, SlotType>>,
): string[] {
  const problems = new Set<string>();
  const names = Object.keys(slots);
  const visit = (node: SnippetNode) => {
    if (node.kind === "text") return;
    // Own names only, since every object inherits a `constructor`.
    const type = Object.hasOwn(slots, node.name) ? slots[node.name] : undefined;
    if (type === undefined) {
      const offered = names.length ? `the slots are ${names.join(", ")}` : "this snippet has none";
      problems.add(`there is no slot ${node.name} here; ${offered}`);
    } else if (node.kind === "slot" && type === "url" && !node.raw) {
      problems.add(`${node.name} is a URL, so it goes in raw, as {{&${node.name}}}`);
    } else if (node.kind === "slot" && type === "list" && node.raw) {
      problems.add(`${node.name} is a list, so it goes in as {{${node.name}}} or names a block`);
    }
    if (node.kind === "block") node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return [...problems];
}

/** Every well-formed tag in a snippet, in order. */
function scan(source: string): Tag[] {
  const tags: Tag[] = [];
  let start = source.indexOf("{{");
  while (start >= 0) {
    // A tag can begin only at the last two braces of a run.
    while (source[start + 2] === "{") start++;
    TAG.lastIndex = start;
    const match = TAG.exec(source);
    if (!match) {
      start = source.indexOf("{{", start + 2);
      continue;
    }
    const [, sigil = "", name = ""] = match;
    const end = TAG.lastIndex;
    tags.push({ sigil, name, at: start, ...span(source, start, end, sigil) });
    start = source.indexOf("{{", end);
  }
  return tags;
}

/**
 * What a tag takes out of the text. A block tag with nothing but spaces and tabs around it on its
 * line takes the line and its line break; a slot, or a tag sharing its line, takes only itself.
 */
function span(source: string, start: number, end: number, sigil: string) {
  if (sigil === "" || sigil === "&") return { from: start, to: end };
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const newline = source.indexOf("\n", end);
  const lineEnd = newline < 0 ? source.length : newline + 1;
  const alone =
    /^[ \t]*$/.test(source.slice(lineStart, start)) &&
    /^[ \t]*\r?\n?$/.test(source.slice(end, lineEnd));
  return alone ? { from: lineStart, to: lineEnd } : { from: start, to: end };
}

/** A tag as an error names it, with its offset. */
function show(tag: Tag) {
  return `{{${tag.sigil}${tag.name}}} at offset ${tag.at}`;
}
