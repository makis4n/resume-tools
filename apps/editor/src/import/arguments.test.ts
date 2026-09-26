import type * as Ast from "@unified-latex/unified-latex-types";
import { parseMinimal } from "@unified-latex/unified-latex-util-parse";
import { describe, expect, test } from "vitest";
import { isReadable, readArguments } from "./arguments";

// Every command here is invented for these tests.

/** A body's top-level nodes, its first a command whose arguments are read. */
function command(source: string): { nodes: Ast.Node[]; end: number } {
  const nodes = parseMinimal(source).content;
  return { nodes, end: nodes[0]?.position?.end.offset ?? 0 };
}

const spans = (source: string, spec: string) => {
  const { nodes, end } = command(source);
  const read = readArguments(nodes, 1, spec, end);
  return read?.args.map((arg) => (arg.present ? source.slice(arg.start, arg.end) : null));
};

describe("reading arguments", () => {
  test("reads each argument with its span, past spaces and comments", () => {
    expect(spans("\\cvx {a} %note\n [b]{c}", "m o m")).toEqual(["{a}", "[b]", "{c}"]);
    expect(spans("\\cvx*{a}", "s m")).toEqual(["*", "{a}"]);
    expect(spans("\\cvx{a}", "s o m")).toEqual([null, null, "{a}"]);
    expect(spans("\\cvx<x>{a}", "d<> m")).toEqual(["<x>", "{a}"]);
  });

  test("takes one token where an argument is not braced, and leaves the rest", () => {
    const source = "\\cvx quill";
    const { nodes, end } = command(source);
    const read = readArguments(nodes, 1, "m", end);
    expect(read?.args[0]).toMatchObject({ open: "", start: 5, end: 6 });
    expect(nodes[read?.next ?? 0]).toMatchObject({ type: "string", content: "uill" });
    expect(spans("\\cvx\\cvy{a}", "m")).toEqual(["\\cvy"]);
  });

  test("does not look for an argument past a blank line", () => {
    expect(spans("\\cvx\n\n[b]", "o")).toEqual([null]);
    const { nodes, end } = command("\\cvx\n\n{a}");
    expect(readArguments(nodes, 1, "m", end)).toMatchObject({ args: [], complete: false });
  });

  test("leaves the array where it is, and says where the arguments end", () => {
    const { nodes, end } = command("\\cvx[a]{b} rest");
    const length = nodes.length;
    const read = readArguments(nodes, 1, "o m", end);
    expect(nodes).toHaveLength(length);
    expect(nodes[read?.next ?? 0]).toMatchObject({ type: "whitespace" });
  });

  test("gives back what it read the first time for a command read again", () => {
    const { nodes, end } = command("\\cvx{a}");
    const owner = nodes[0] as Ast.Node;
    const first = readArguments(nodes, 1, "m", end, owner);
    expect(readArguments(nodes, 1, "o o", end, owner)).toBe(first);
  });

  test("reads only the specifications it can", () => {
    expect(isReadable("s o m O{x} t+ r() D<>{y}")).toBe(true);
    expect(isReadable("v")).toBe(false);
    expect(isReadable("u{\\par}")).toBe(false);
    expect(isReadable("e{^_}")).toBe(false);
    expect(isReadable("m m")).toBe(true);
    expect(readArguments([], 0, "v", 0)).toBeUndefined();
  });
});
