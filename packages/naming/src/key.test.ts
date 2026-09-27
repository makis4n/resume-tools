import { describe, expect, test } from "vitest";
import { environmentKeyOf, keyOf, NAMING_VERSION, sha256 } from "./key";

// Every definition here is invented.

describe("the key", () => {
  test("hashes as SHA-256 in lower-case hex", async () => {
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("is the SHA-256 of the version, the hash and the dependencies, as item 4's keys are", async () => {
    // The key item 4's `keysOf` gives an invented macro, `\cvhead`, whose closure names one
    // definition and one the printout lacks: worked out with Node's own SHA-256, so that the
    // formula, and the version's place in it, cannot drift.
    const hash = await sha256("macro:#1->\\textbf {#1}");
    expect(hash).toBe("fbef28f82c3305379f872e24ae85cf61ce6a0fd5768c0727506ff8d74f403f27");
    const dependencies = [
      ["cvhead@style", await sha256("macro:->\\bfseries ")],
      ["cvmissing", null],
    ] as const;
    expect(await keyOf(1, hash, dependencies)).toBe(
      "2cb7bc16aef642396c5e829d0eccb549361e87c482b90460133ac864112d5703",
    );
    expect(await keyOf(2, hash, dependencies)).toBe(
      "f90acabda2c462e92a2a203a608ec8c37a0e3ca157f0c996026586f4f9fe69be",
    );
  });

  test("changes with the version, the definition, and each dependency and its place", async () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const key = await keyOf(NAMING_VERSION, a, [
      ["one", b],
      ["two", a],
    ]);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await keyOf(NAMING_VERSION, a, [
        ["one", b],
        ["two", a],
      ]),
    ).toBe(key);
    const others = await Promise.all([
      keyOf(NAMING_VERSION + 1, a, [
        ["one", b],
        ["two", a],
      ]),
      keyOf(NAMING_VERSION, b, [
        ["one", b],
        ["two", a],
      ]),
      keyOf(NAMING_VERSION, a, [
        ["two", a],
        ["one", b],
      ]),
      keyOf(NAMING_VERSION, a, [
        ["one", a],
        ["two", a],
      ]),
      keyOf(NAMING_VERSION, a, [
        ["uno", b],
        ["two", a],
      ]),
      keyOf(NAMING_VERSION, a, [["one", b]]),
    ]);
    expect(new Set([key, ...others]).size).toBe(7);
  });

  test("keys an environment by its begin code, its end code first among its dependencies", async () => {
    const [begin, end, style] = await Promise.all(
      ["macro:->\\begin {itemize}", "macro:->\\end {itemize}", "macro:->\\small "].map(sha256),
    );
    const key = await environmentKeyOf(NAMING_VERSION, begin ?? "", "endcvlist", end ?? "", [
      ["cvlist@style", style ?? ""],
    ]);
    expect(key).toBe(
      await keyOf(NAMING_VERSION, begin ?? "", [
        ["endcvlist", end ?? ""],
        ["cvlist@style", style ?? ""],
      ]),
    );
    // Its begin code alone, called as a command, is keyed otherwise.
    expect(key).not.toBe(await keyOf(NAMING_VERSION, begin ?? "", [["cvlist@style", style ?? ""]]));
  });
});
