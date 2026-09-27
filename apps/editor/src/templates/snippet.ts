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
 *
 * An extras slot, `{{&x.photo}}`, writes the node's extra under that key as it is, LaTeX kept from
 * the user's own upload, and `{{#x.photo}}` and `{{^x.photo}}` test whether the node has one. It
 * is the one slot whose text the generator does not escape, so it is always raw, and only the
 * header's, a section's and an entry's snippets have one, since only their nodes keep extras
 * (decision 0025).
 */

import { ExtraKey } from "@resume-tools/resume-model";

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

/** What begins an extras slot's name, before its key: `{{&x.photo}}`. */
export const EXTRAS_PREFIX = "x.";

/** The key an extras slot's name holds, or undefined for any other slot's name. */
export function extrasKey(name: string): string | undefined {
  return name.startsWith(EXTRAS_PREFIX) ? name.slice(EXTRAS_PREFIX.length) : undefined;
}

/**
 * Two braces, an optional sigil, a name and two braces, with whitespace allowed in between. The
 * whitespace after the sigil sits inside the sigil's optional group. With a `\s*` on each side of
 * an optional sigil, a `{{` followed by a long run of whitespace that begins no tag is tried once
 * for every way of splitting the run between the two, and packages will come from other users.
 * A name is a letter and letters and digits, or `x.` and a key, taken as letters, digits, `-` and
 * `_` so that `checkSnippet` names a key the model refuses rather than leave the tag as TeX text.
 */
const TAG = /\{\{\s*(?:([&#^/])\s*)?(x\.[A-Za-z0-9_-]*|[A-Za-z][A-Za-z0-9]*)\s*\}\}/y;

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
 * renders it or names a block. A block may test any slot the place offers. An extras slot is
 * offered where `extras` says the place's node keeps them, under a key the model takes, and goes
 * in raw, since what it holds is LaTeX the generator never escapes.
 */
export function checkSnippet(
  nodes: SnippetNode[],
  slots: Readonly<Record<string, SlotType>>,
  extras = false,
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
    if (node.kind === "block") push(node.children);
    const key = extrasKey(node.name);
    if (key !== undefined) {
      if (!extras)
        problems.add(
          `there is no slot ${node.name} here; only the header's, a section's and an entry's snippets have extras`,
        );
      else if (!ExtraKey.safeParse(key).success)
        problems.add(
          `${node.name} names no extra: a key is a lowercase letter, then up to 31 lowercase letters, digits or -`,
        );
      else if (node.kind === "slot" && !node.raw)
        problems.add(
          `${node.name} is an extra, LaTeX kept from the upload, so it goes in raw, as {{&${node.name}}}`,
        );
      continue;
    }
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
  }
  return [...problems];
}

/**
 * The commands whose first argument hyperref reads as an address: `\href`'s and `\url`'s, which
 * link to it, `\nolinkurl`'s, which it sets as `\url` does, and `\hyperlink`'s, a target's name.
 */
const LINK_COMMANDS = new Set(["href", "url", "nolinkurl", "hyperlink"]);

/**
 * Check where a snippet puts its slots in TeX, and return what is wrong: a slot other than a URL
 * in an address, the first argument of `\href`, `\url`, `\nolinkurl` or `\hyperlink`, named with
 * its type; and a slot right after a backslash. Text escaped for typesetting breaks in an
 * address, since hyperref turns back only some of the escapes (decision 0007), and a typeset slot
 * would put its markers there; the generator builds a URL slot for what needs a link, such as a
 * contact's `href`. A slot right after a backslash would make its text a command's name, so that
 * `\{{&text}}` with `LaTeX rocks` sets the logo. An extras slot may stand in an address, since it
 * writes back the upload's own LaTeX, which no escape of the generator's touches (decision 0025);
 * the backslash rule holds for it as for any slot.
 *
 * The check reads as much of TeX as that takes: a comment, from a `%` to the end of its line, is
 * not read, tags and all; a control symbol, such as `\{`, `\%` or `\\`, is one token; an
 * optional argument may come between a command and its address, its braces counted as any
 * others; `\url` and `\nolinkurl` may take their address between a pair of any other character,
 * as `\url|...|`; and a block tag between a backslash and a slot sets nothing, so the backslash
 * still reaches the slot. One pass over the source counts braces, however the arguments nest, so
 * the check costs time in proportion to its length.
 */
export function checkAddresses(
  source: string,
  slots: Readonly<Record<string, SlotType>>,
): string[] {
  const problems = new Set<string>();
  for (const { tag, address, afterBackslash } of slotPlaces(source)) {
    if (afterBackslash)
      problems.add("a slot cannot follow a backslash; the text would become a command");
    // A name the place does not offer is checkSnippet's to report.
    const type = Object.hasOwn(slots, tag.name) ? slots[tag.name] : undefined;
    if (address !== undefined && type !== undefined && type !== "url")
      problems.add(
        `${tag.name} is a ${type} slot; inside \\${address} use a url slot, such as href`,
      );
  }
  return [...problems];
}

/**
 * Which of a snippet's slots it shows rather than links to, by their place among its slot tags in
 * order, which is the order `parseSnippet` gives its slot nodes: those in the text argument of
 * `\href`, its second, which hyperref typesets, as the address a link with no label shows as its
 * text. The generator writes break opportunities into a long address shown there, and never into
 * one it links to, where they would become part of the address (decision 0007).
 */
export function shownSlots(source: string): Set<number> {
  return new Set(slotPlaces(source).flatMap((place, k) => (place.shown ? [k] : [])));
}

/** A slot tag, and where the snippet puts it in TeX. */
interface SlotPlace {
  tag: Tag;
  /** The link command whose address the slot is in, when it is in one. */
  address: string | undefined;
  /** Whether it is in the text argument of `\href`, which hyperref sets. */
  shown: boolean;
  /** Whether a backslash comes right before it, which would make its text a command's name. */
  afterBackslash: boolean;
}

/**
 * Each slot tag of a snippet, and where it sits in TeX, read as `checkAddresses` says: in a link
 * command's address, in `\href`'s text argument, and right after a backslash or not.
 */
function slotPlaces(source: string): SlotPlace[] {
  const places: SlotPlace[] = [];
  const tags = scan(source);
  // Each address that is open, the innermost last: with the brace depth inside it, or with the
  // character that closes it, for `\url|...|` and the like, which take any delimiter.
  const addresses: { command: string; depth: number; delimiter?: string }[] = [];
  // Each `\href` text argument that is open, by the brace depth inside it; and the depth at which
  // an `\href` whose address has closed expects its text argument next, if one does.
  const texts: number[] = [];
  let textAt: number | undefined;
  // A link command whose address has not opened yet: right after its name, inside its optional
  // argument, which ends at a `]` at the brace depth it began at, or after that argument.
  let link: { command: string; stage: "name" | "options" | "argument"; depth: number } | undefined;
  let depth = 0;
  let next = 0;
  let at = 0;
  // Where the text TeX reads has got to: the index after the last character outside a tag. A
  // block tag sets nothing, so the character before a slot, once the tags are gone, is the one
  // before the block tags in between, and a backslash there still makes the slot's text a command.
  let rendered = 0;
  while (at < source.length) {
    const tag = tags[next];
    if (tag !== undefined && tag.at <= at) {
      next++;
      at = Math.max(at, tag.to);
      // A block tag sets nothing itself, so an address may still follow it.
      if (tag.sigil !== "" && tag.sigil !== "&") continue;
      // A slot where a link's argument would begin is that argument, and no address opens; one
      // where `\href`'s text would begin is that text.
      if (link?.stage !== "options") link = undefined;
      const shown = texts.length > 0 || textAt !== undefined;
      textAt = undefined;
      places.push({
        tag,
        address: addresses.at(-1)?.command,
        shown,
        afterBackslash: followsBackslash(source, rendered),
      });
      rendered = at;
      continue;
    }
    const char = source.charAt(at);
    if (char === "%") {
      // TeX reads none of a comment, nor what a tag in it renders. A tag that runs on past the
      // line's end takes the comment on to the end of the line it ends on.
      let end = lineEnd(source, at);
      for (let inside = tags[next]; inside !== undefined && inside.at < end; inside = tags[++next])
        if (inside.to > end) end = lineEnd(source, inside.to);
      at = end;
      rendered = at;
      continue;
    }
    // Where `\href`'s text would begin, anything but a space or a brace means it has none.
    if (textAt !== undefined && !/\s/.test(char) && !(char === "{" && depth === textAt))
      textAt = undefined;
    if (char === "\\") {
      COMMAND.lastIndex = at;
      const command = COMMAND.exec(source);
      // A control symbol, such as \{, \% or \\, is two characters, unless a tag begins right
      // after the backslash, which the tag's own check reports.
      at = command === null ? at + (tag?.at === at + 1 ? 1 : 2) : COMMAND.lastIndex;
      rendered = at;
      // Inside an optional argument a command is part of it. Elsewhere it may begin a link, and
      // where a link's argument would begin it is that argument.
      if (link?.stage !== "options") {
        const name = command?.[1];
        link =
          name !== undefined && LINK_COMMANDS.has(name)
            ? { command: name, stage: "name", depth }
            : undefined;
      }
      continue;
    }
    const delimited = addresses.at(-1);
    if (delimited?.delimiter === char) {
      // The address `\url|...|` opened closes at its own delimiter, whatever the braces inside.
      addresses.pop();
      at++;
      rendered = at;
      continue;
    }
    if (link?.stage === "options") {
      if (char === "]" && depth === link.depth) link.stage = "argument";
    } else if (link !== undefined) {
      if (char === "{") {
        // The address opens, and the walk goes on inside it.
        addresses.push({ command: link.command, depth: depth + 1 });
        link = undefined;
      } else if (char === "[" && link.stage === "name") {
        link.stage = "options";
        link.depth = depth;
      } else if (/\s/.test(char)) {
        // The spaces after a command are TeX's to skip; the address may still follow.
      } else if (DELIMITED_COMMANDS.has(link.command) && link.stage === "name") {
        // `\url` and `\nolinkurl` take their address between any character but a brace, as
        // `\url|...|` does, and it runs to that character's next appearance.
        addresses.push({ command: link.command, depth: -1, delimiter: char });
        link = undefined;
        at++;
        rendered = at;
        continue;
      } else {
        link = undefined;
      }
    }
    if (char === "{") {
      if (textAt === depth) {
        texts.push(depth + 1);
        textAt = undefined;
      }
      depth++;
    } else if (char === "}") {
      if (texts.at(-1) === depth) texts.pop();
      if (addresses.at(-1)?.depth === depth) {
        // An `\href`'s address has closed, and its text argument comes next.
        if (addresses.pop()?.command === "href") textAt = depth - 1;
      }
      depth--;
    }
    at++;
    rendered = at;
  }
  return places;
}

/** The link commands that also take their address between a pair of any other character. */
const DELIMITED_COMMANDS = new Set(["url", "nolinkurl"]);

/** A control word, and the spaces TeX skips after it. */
const COMMAND = /\\([A-Za-z]+)\s*/y;

/** Where the line `from` is on ends: at its line feed, or at the source's end. */
function lineEnd(source: string, from: number): number {
  const end = source.indexOf("\n", from);
  return end < 0 ? source.length : end;
}

/**
 * Whether an odd run of backslashes ends right before `at`, so that the last of them makes what
 * follows part of a command. Each run is read for the one tag after it, so reading them all costs
 * the source's length at most.
 */
function followsBackslash(source: string, at: number): boolean {
  let run = 0;
  while (source[at - 1 - run] === "\\") run++;
  return run % 2 === 1;
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
