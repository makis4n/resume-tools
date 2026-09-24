import { describe, expect, it } from "vitest";
import { Resume } from "./index";

// Everything in these resumes is invented.

/**
 * A resume that uses every construct: the four kinds, a role on each, several link kinds, a
 * range, an ongoing range and a single date.
 */
const everything = {
  version: 1,
  header: {
    name: { first: "Rowan", last: "Pell" },
    headline: "Software engineer",
    email: "rowan@example.com",
    phone: "555-0142",
    location: "Harbour City",
    links: [
      { id: "site", kind: "website", label: "pell.example.com", href: "https://pell.example.com" },
      { id: "code", kind: "github", label: "rowan-pell", href: "https://example.com/rowan-pell" },
      { id: "orcid", kind: "orcid", label: "0000-0000-0000-0000", href: "https://example.org/0" },
    ],
  },
  sections: [
    {
      kind: "paragraph",
      id: "summary",
      title: "Summary",
      role: "summary",
      text: [{ text: "Builds " }, { text: "careful", italic: true }, { text: " tools." }],
    },
    {
      kind: "entries",
      id: "work",
      title: "Experience",
      role: "experience",
      entries: [
        {
          id: "larkspur",
          title: "Engineer",
          subtitle: "Larkspur Labs",
          place: "Remote",
          dates: { start: "2021-03", end: "present" },
          bullets: [
            {
              id: "larkspur-1",
              text: [
                { text: "Shipped the " },
                { text: "typesetter", bold: true, href: "https://example.com/typesetter" },
              ],
            },
          ],
        },
        {
          id: "eastmere",
          title: "Research assistant",
          subtitle: "Eastmere College",
          dates: { start: "2018-09", end: "2021-02" },
          bullets: [],
        },
      ],
    },
    {
      kind: "entries",
      id: "awards",
      title: "Awards",
      role: "awards",
      entries: [{ id: "prize", title: "Typesetting prize", dates: { start: "2020" }, bullets: [] }],
    },
    {
      kind: "labelled",
      id: "skills",
      title: "Skills",
      role: "skills",
      items: [{ id: "tongues", label: "Languages", text: [{ text: "TypeScript, Rust" }] }],
    },
    {
      kind: "list",
      id: "spoken",
      title: "Languages",
      role: "languages",
      items: [{ id: "english", text: [{ text: "English" }] }],
    },
  ],
};

const minimal = { version: 1, header: { name: { first: "Rowan", last: "Pell" }, links: [] } };

/** A resume with one entry, changed as a test needs. */
const withEntry = (entry: object) => ({
  ...minimal,
  sections: [
    {
      kind: "entries",
      id: "work",
      title: "Experience",
      role: "experience",
      entries: [{ id: "larkspur", title: "Engineer", bullets: [], ...entry }],
    },
  ],
});

const accepts = (value: unknown) => Resume.safeParse(value).success;

describe("Resume", () => {
  it("accepts a resume that uses every construct, unchanged", () => {
    expect(Resume.parse(everything)).toEqual(everything);
  });

  it("accepts empty text everywhere, since an edit passes through it", () => {
    const empty = {
      version: 1,
      header: {
        name: { first: "", last: "" },
        headline: "",
        email: "",
        phone: "",
        location: "",
        links: [{ id: "site", kind: "other", label: "", href: "" }],
      },
      sections: [
        {
          kind: "paragraph",
          id: "summary",
          title: "",
          role: "summary",
          text: [{ text: "" }, { text: "", href: "" }],
        },
        { kind: "labelled", id: "skills", title: "", role: "skills", items: [] },
      ],
    };
    expect(accepts(empty)).toBe(true);
    expect(accepts(withEntry({ title: "", subtitle: "", place: "" }))).toBe(true);
    expect(accepts(withEntry({ bullets: [{ id: "larkspur-1", text: [] }] }))).toBe(true);
  });

  it("rejects an id used twice, even by nodes of different types", () => {
    const result = Resume.safeParse(withEntry({ bullets: [{ id: "work", text: [] }] }));
    expect(result.error?.issues).toMatchObject([
      {
        message: "the id work is already used by another node",
        path: ["sections", 0, "entries", 0, "bullets", 0, "id"],
      },
    ]);
  });

  it("rejects an id a marker cannot carry", () => {
    expect(accepts(withEntry({ id: "lark spur" }))).toBe(false);
    expect(accepts(withEntry({ id: "lark#spur" }))).toBe(false);
  });

  it("rejects a date that is not YYYY or YYYY-MM, and a null end", () => {
    expect(accepts(withEntry({ dates: { start: "March 2020" } }))).toBe(false);
    expect(accepts(withEntry({ dates: { start: "2020-13" } }))).toBe(false);
    expect(accepts(withEntry({ dates: { start: "2020", end: null } }))).toBe(false);
  });

  it("rejects an unknown kind, role or link kind", () => {
    const section = { id: "hobbies", title: "Hobbies", role: "other", text: [] };
    expect(accepts({ ...minimal, sections: [{ ...section, kind: "paragraph" }] })).toBe(true);
    expect(accepts({ ...minimal, sections: [{ ...section, kind: "table" }] })).toBe(false);
    expect(
      accepts({ ...minimal, sections: [{ ...section, kind: "paragraph", role: "hobbies" }] }),
    ).toBe(false);
    const link = { id: "social", kind: "mastodon", label: "", href: "" };
    expect(accepts({ ...minimal, header: { ...minimal.header, links: [link] } })).toBe(false);
  });

  it("rejects another version", () => {
    expect(accepts({ ...minimal, sections: [], version: 2 })).toBe(false);
  });

  it("needs both parts of the name, though the last may be empty", () => {
    const named = (name: object) => ({ ...minimal, sections: [], header: { name, links: [] } });
    expect(accepts(named({ first: "Rowan" }))).toBe(false);
    expect(accepts(named({ first: "Rowan", last: "" }))).toBe(true);
  });
});

describe("Resume, being strict", () => {
  it("refuses a field it does not know rather than dropping it", () => {
    const result = Resume.safeParse({
      ...minimal,
      sections: [{ kind: "list", id: "s", title: "", role: "other", items: [], column: "right" }],
    });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Unrecognized key: "column"',
    ]);
    const root = Resume.safeParse({ ...minimal, sections: [], language: "de" });
    expect(root.error?.issues.map((issue) => issue.message)).toEqual([
      'Unrecognized key: "language"',
    ]);
  });
});
