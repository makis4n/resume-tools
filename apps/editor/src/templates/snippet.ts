/**
 * The snippet language, in which a template package maps the resume model onto its macros.
 *
 * A snippet is template text with slots, in a small language shaped like Mustache. `{{title}}` is
 * a typeset slot: the field, escaped for LaTeX and wrapped in its markers. `{{&href}}` is a raw
 * slot: the value escaped for where it goes, with no markers. It is the only way to use a URL,
 * and an address is only ever a URL slot, as in `\href{{{&href}}}{{{text}}}`, since text escaped
 * for typesetting breaks inside `\href` and `\url`; raw text serves where a marker would break
 * outside an address, as in a PDF string such as `pdftitle`. A block,
 * `{{#bullets}}...{{/bullets}}`, is kept when its slot is present, and
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

/**
 * Two braces, an optional sigil, a name and two braces, with whitespace allowed in between. The
 * whitespace after the sigil sits inside the sigil's optional group. With a `\s*` on each side of
 * an optional sigil, a `{{` followed by a long run of whitespace that begins no tag is tried once
 * for every way of splitting the run between the two, and packages will come from other users.
 */
const TAG = /\{\{\s*(?:([&#^/])\s*)?([A-Za-z][A-Za-z0-9]*)\s*\}\}/y;

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
  // An explicit stack rather than recursion: the parser nests blocks to any depth, and a snippet
  // deep enough to overflow the call stack would throw out of Zod's safeParse instead of failing.
  const stack: SnippetNode[] = [];
  const push = (list: SnippetNode[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const node = list[i];
      if (node) stack.push(node);
    }
  };
  push(nodes);
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.kind === "text") continue;
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
    if (node.kind === "block") push(node.children);
  }
  return [...problems];
}

/**
 * Check what a snippet puts in an address, the first argument of `\href` or `\url`, where
 * hyperref reads a URL: only a URL slot may go there, and the message says so for any other.
 * Text escaped for typesetting breaks in an address, since hyperref turns back only some of the
 * escapes (decision 0007), and a typeset slot would put its markers there; the generator builds a
 * URL slot for what needs a link, such as a contact's `href`. One pass over the source counts
 * braces, however the arguments nest, so the check costs time in proportion to its length.
 */
export function checkAddresses(
  source: string,
  slots: Readonly<Record<string, SlotType>>,
): string[] {
  const problems = new Set<string>();
  const tags = scan(source);
  // The brace depth inside each address that is open, the innermost last.
  const addresses: number[] = [];
  let depth = 0;
  let next = 0;
  let at = 0;
  while (at < source.length) {
    const tag = tags[next];
    if (tag !== undefined && tag.at <= at) {
      next++;
      at = Math.max(at, tag.to);
      if (addresses.length === 0 || (tag.sigil !== "" && tag.sigil !== "&")) continue;
      // A name the place does not offer is checkSnippet's to report.
      const type = Object.hasOwn(slots, tag.name) ? slots[tag.name] : undefined;
      if (type !== undefined && type !== "url")
        problems.add(`${tag.name} is text; inside \\href or \\url use a url slot, such as href`);
      continue;
    }
    if (source[at] === "\\") {
      COMMAND.lastIndex = at;
      const command = COMMAND.exec(source);
      if (command === null) {
        // A control symbol, such as \{ or \\, unless a tag begins right after the backslash.
        at += tag?.at === at + 1 ? 1 : 2;
        continue;
      }
      at = COMMAND.lastIndex;
      const name = command[1];
      if ((name === "href" || name === "url") && source[at] === "{" && tag?.at !== at) {
        addresses.push(++depth);
        at++;
      }
      continue;
    }
    if (source[at] === "{") depth++;
    else if (source[at] === "}") {
      if (addresses.at(-1) === depth) addresses.pop();
      depth--;
    }
    at++;
  }
  return [...problems];
}

/** A control word, and the spaces TeX skips after it. */
const COMMAND = /\\([A-Za-z]+)\s*/y;

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
 * Only the blanks next to the tag are read, never the rest of its line, so a line of many tags
 * costs its length once rather than once per tag.
 */
function span(source: string, start: number, end: number, sigil: string) {
  const own = { from: start, to: end };
  if (sigil === "" || sigil === "&") return own;
  let from = start;
  while (from > 0 && isBlank(source[from - 1])) from--;
  if (from > 0 && source[from - 1] !== "\n") return own;
  let to = end;
  while (to < source.length && isBlank(source[to])) to++;
  if (source[to] === "\r") to++;
  if (to < source.length && source[to] !== "\n") return own;
  return { from, to: Math.min(to + 1, source.length) };
}

const isBlank = (char: string | undefined) => char === " " || char === "\t";

/** A tag as an error names it, with its offset. */
function show(tag: Tag) {
  return `{{${tag.sigil}${tag.name}}} at offset ${tag.at}`;
}
