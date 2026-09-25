import { describe, expect, it } from "vitest";
import { withoutFontFolders } from "./fontconfig";

/** The release's `fonts.conf`, as the tree holds it. */
const RELEASE = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
  "<fontconfig>",
  "<dir>/texlive/texmf-dist/fonts/opentype</dir>",
  "<dir>/texlive/texmf-dist/fonts/type1</dir>",
  "</fontconfig>",
  "",
].join("\n");

/**
 * Whether a text is well-formed XML, as far as a conf goes: a declaration and a doctype, then one
 * element, whose elements close in the order they open, around text with no markup characters of
 * its own, and comments.
 */
function wellFormed(xml: string): boolean {
  const open: string[] = [];
  let roots = 0;
  const body = xml
    .replace(/^<\?xml [^?]*\?>/, "")
    .replace(/<!DOCTYPE [^>]*>/, "")
    .replace(/<!--(?:(?!--)[\s\S])*-->/g, "");
  for (const token of body.split(/(<[^<>]*>)/)) {
    const tag = /^<(\/?)([A-Za-z][\w.-]*)(?:\s[^<>]*?)?(\/?)>$/.exec(token);
    if (!tag) {
      if (/[<>]|&(?!(?:amp|lt|gt|quot|apos);)/.test(token)) return false;
      if (open.length === 0 && token.trim() !== "") return false;
      continue;
    }
    const [, closing, name, empty] = tag;
    if (closing) {
      if (open.pop() !== name) return false;
    } else {
      if (open.length === 0) roots++;
      if (!empty) open.push(name as string);
    }
  }
  return open.length === 0 && roots === 1;
}

describe("withoutFontFolders", () => {
  it("takes out the release's two folders and keeps the rest of its conf as it was", () => {
    const conf = withoutFontFolders(RELEASE);
    expect(conf).toBe(
      [
        '<?xml version="1.0"?>',
        '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
        "<fontconfig>",
        "</fontconfig>",
        "",
      ].join("\n"),
    );
    expect(conf).not.toMatch(/<dir\b/);
    expect(wellFormed(conf)).toBe(true);
    // The check itself catches what it is there to catch.
    expect(wellFormed(conf.replace("</fontconfig>", ""))).toBe(false);
  });

  it("takes out a folder in any form fontconfig reads one", () => {
    const conf = withoutFontFolders(
      [
        "<fontconfig>",
        '  <dir prefix="xdg">fonts</dir>',
        "<dir/>",
        "<dir >/usr/share/fonts</dir >",
        "<cachedir>/var/cache/fontconfig</cachedir>",
        "</fontconfig>",
      ].join("\n"),
    );
    expect(conf).toBe("<fontconfig>\n<cachedir>/var/cache/fontconfig</cachedir>\n</fontconfig>");
  });

  it("refuses a conf that would still lead fontconfig to fonts", () => {
    expect(() => withoutFontFolders("<fontconfig><dir>/a<!-- b --></dir></fontconfig>")).toThrow(
      "fonts.conf has a <dir> whose form the fetch script cannot take out",
    );
    expect(() =>
      withoutFontFolders('<fontconfig><include ignore_missing="yes">conf.d</include></fontconfig>'),
    ).toThrow("fonts.conf includes other configuration, which may name font folders");
  });
});
