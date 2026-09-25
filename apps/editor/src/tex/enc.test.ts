import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEncoding } from "./enc";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "latin1");

/** A vector of the given names, written plainly. */
const vector = (names: string[]) => `/Test [\n${names.map((n) => `/${n}`).join(" ")}\n] def\n`;
const letters = (n: number) => Array.from({ length: n }, (_, i) => `g${i}`);

describe("parseEncoding", () => {
  it("reads TeX Base 1, with its comments, by code", () => {
    const names = parseEncoding(fixture("8r.enc"));
    expect(names).toHaveLength(256);
    expect(names[0]).toBe(".notdef");
    expect(names[1]).toBe("dotaccent");
    expect(names[65]).toBe("A");
    expect(names[128]).toBe("Euro");
    expect(names[150]).toBe("endash");
    expect(names[233]).toBe("eacute");
    expect(names[255]).toBe("ydieresis");
  });

  it("takes comments anywhere, whitespace of any kind, and names with none between them", () => {
    const names = letters(256);
    const run = names.map((n) => `/${n}`);
    const text = [
      "% a header",
      `/Tight[${run.slice(0, 100).join("")} % a comment inside`,
      `${run.slice(100, 200).join("\t")}\r\n${run.slice(200).join("\r\n")}`,
      "]def % a trailer",
    ].join("\n");
    expect(parseEncoding(text)).toEqual(names);
  });

  it("keeps .notdef as it is", () => {
    const names = [...letters(255), ".notdef"];
    expect(parseEncoding(vector(names))[255]).toBe(".notdef");
  });

  it("refuses a vector with other than 256 names, saying how many", () => {
    expect(() => parseEncoding(vector(letters(255)))).toThrow(
      "an encoding vector names 256 glyphs, not 255",
    );
    expect(() => parseEncoding(vector(letters(257)))).toThrow("not 257");
  });

  it("refuses what is not a vector of names", () => {
    expect(() => parseEncoding("/Test /a /b def")).toThrow("no [ ... ]");
    expect(() =>
      parseEncoding(
        `[ ${letters(256)
          .map((n) => `/${n}`)
          .join(" ")} ] def`,
      ),
    ).toThrow("does not begin with its name");
    expect(() => parseEncoding(vector(letters(256)).replace("def", ""))).toThrow("`def`");
    const repeated = `/Test [ 128 {/.notdef} repeat ${letters(128)
      .map((n) => `/${n}`)
      .join(" ")} ] def`;
    expect(() => parseEncoding(repeated)).toThrow("holds names only, not 128");
  });
});
