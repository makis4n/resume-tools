/**
 * A body's tree printed back to source (milestone 3 item 4, decision 0020): the body's own bytes
 * for every span nobody replaced, so that a tree printed as the parser made it is the inlined body
 * exactly, and the probe (item 5) and the assembly (item 7) can splice what they make at a node's
 * or an argument's span.
 *
 * A node's bytes are its children's, each printed in turn, and the body's between them, its
 * command's name, its delimiters and its spaces; a node with no children, a raw chunk, a text or a
 * date, is its span's bytes. The walk goes as deep as the tree, which the parser caps at 64 levels.
 */

import type { Argument, Node, Tree } from "./parse";

/** What a caller puts in the place of a node or an argument, or undefined to keep its bytes. */
export type Replace = (part: Node | Argument) => string | undefined;

/** A node's or an argument's parts that are printed in turn, in the order of the body. */
function partsOf(part: Node | Argument): (Node | Argument)[] {
  switch (part.kind) {
    case "mandatory":
    case "optional":
      return part.content ?? [];
    case "star":
    case "token":
    case "text":
    case "date":
      return [];
    case "raw":
      return (part.args ?? []).filter((arg) => arg.present);
    case "group":
      return part.content;
    case "section":
    case "call":
      return part.args.filter((arg) => arg.present);
    case "list":
    case "environment":
    case "block":
    case "item":
      return [...part.args.filter((arg) => arg.present), ...part.content];
  }
}

/**
 * The source a tree prints to: the body's bytes, with what `replace` gives in the place of any node
 * or argument it names. With no `replace`, the inlined body as it was parsed.
 */
export function print(tree: Tree, replace?: Replace): string {
  const out: string[] = [];
  const source = tree.source;
  const walk = (part: Node | Argument) => {
    const replaced = replace?.(part);
    if (replaced !== undefined) {
      out.push(replaced);
      return;
    }
    let at = part.start;
    for (const child of partsOf(part)) {
      out.push(source.slice(at, child.start));
      walk(child);
      at = child.end;
    }
    out.push(source.slice(at, part.end));
  };
  let at = tree.start;
  for (const node of tree.content) {
    out.push(source.slice(at, node.start));
    walk(node);
    at = node.end;
  }
  out.push(source.slice(at, tree.end));
  return out.join("");
}
