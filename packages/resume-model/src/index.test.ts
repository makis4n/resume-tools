import { describe, expect, it } from "vitest";
import { Extras, KeptLatex, LockedLatex, MAX_KEPT_LATEX, Resume } from "./index";

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

  it("rejects an id with a capital, since a template may uppercase a field's markers", () => {
    const result = Resume.safeParse(withEntry({ id: "Work" }));
    expect(result.error?.issues).toMatchObject([
      {
        message: "an id is 1 to 64 lowercase letters, digits, - or _",
        path: ["sections", 0, "entries", 0, "id"],
      },
    ]);
    expect(accepts(withEntry({ id: "work-2_b" }))).toBe(true);
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

/** A resume with one locked section, changed as a test needs. */
const withLocked = (locked: object) => ({
  ...minimal,
  sections: [
    {
      kind: "locked",
      id: "lock-a1b2c3",
      title: "",
      role: "other",
      latex: "\\section*{Hobbies}\n\\begin{tabular}{ll}\nRowing & Weekly\n\\end{tabular}",
      ...locked,
    },
  ],
});

/** The messages of what is wrong with a value, by a schema. */
const messages = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("Resume, with what an import keeps", () => {
  it("accepts a locked section, with no title and the role other, and extras on its nodes", () => {
    const imported = {
      ...everything,
      header: { ...everything.header, extras: { photo: "\\photo[circle]{face}" } },
      sections: [
        ...everything.sections.map((section) =>
          section.kind === "entries" ? { ...section, extras: { "rule-width": "0.4pt" } } : section,
        ),
        withLocked({ extras: { note: "% kept" } }).sections[0],
      ],
    };
    expect(Resume.parse(imported)).toEqual(imported);
    const entry = withEntry({ extras: { icon: "\\faBriefcase", "arg-2": "" } });
    expect(Resume.parse(entry)).toEqual(entry);
  });

  it("refuses a locked section with a title, another role, or a field it does not know", () => {
    expect(accepts(withLocked({}))).toBe(true);
    expect(accepts(withLocked({ title: "Hobbies" }))).toBe(false);
    expect(accepts(withLocked({ role: "skills" }))).toBe(false);
    expect(accepts(withLocked({ items: [] }))).toBe(false);
    const { latex: _, ...bare } = withLocked({}).sections[0] ?? {};
    expect(accepts({ ...minimal, sections: [bare] })).toBe(false);
  });

  it("keeps a locked section's id unique across the document", () => {
    const twice = withEntry({});
    const locked = withLocked({ id: "work" }).sections[0];
    const result = Resume.safeParse({ ...twice, sections: [...twice.sections, locked] });
    expect(result.error?.issues).toMatchObject([
      { message: "the id work is already used by another node", path: ["sections", 1, "id"] },
    ]);
  });

  it("holds kept LaTeX to its cap", () => {
    expect(KeptLatex.safeParse("x".repeat(MAX_KEPT_LATEX)).success).toBe(true);
    expect(messages(KeptLatex.safeParse("x".repeat(MAX_KEPT_LATEX + 1)))).toEqual([
      "kept LaTeX is at most 65536 characters",
    ]);
    expect(accepts(withLocked({ latex: "x".repeat(MAX_KEPT_LATEX + 1) }))).toBe(false);
  });

  it("refuses kept LaTeX that holds the editor's own macros or markers, in any case", () => {
    const refused =
      "kept LaTeX holds the editor's own macros or markers, which only the generator writes";
    for (const latex of [
      "\\rtfield{work.title}{Rowing}",
      "\\rtlocked{lock-b}{x}",
      "\\makeatletter\\rt@par{x}\\makeatother",
      "\\special{rt:b:work.title}",
      "\\special{rt:e:work.title}",
      "\\special{rt:p:work.title:hsize=1pt}",
      "\\special{RT:L:lock-b}",
    ])
      expect(messages(KeptLatex.safeParse(latex)), latex).toEqual([refused]);
    // A macro of another name, and a special of another kind, are the upload's own.
    for (const latex of ["\\rtfieldwidth", "\\rtimes", "\\special{rt:x:1}", "art: a b"])
      expect(KeptLatex.safeParse(latex).success, latex).toBe(true);
  });

  it("refuses kept LaTeX whose braces do not balance as TeX reads them", () => {
    const refused = "kept LaTeX's braces do not balance as TeX reads them";
    for (const latex of [
      "\\textbf{Rowing",
      "Rowing}",
      "}{",
      "\\\\{",
      // A comment takes the rest of its line, braces and all, outside an address.
      "\\href{https://example.com/}{50%off}",
      "\\url|https://example.com/",
    ])
      expect(messages(KeptLatex.safeParse(latex)), latex).toEqual([refused]);
    for (const latex of [
      "",
      "\\textbf{Rowing} \\{ and \\}",
      "Rowing % a comment {\nand more",
      "Rowing % a comment }\r\nand more",
      "a\\%{b}",
      "\\begin{tabular}{ll}\nA & B\\\\\n\\end{tabular}",
    ])
      expect(KeptLatex.safeParse(latex).success, latex).toBe(true);
  });

  it("reads a % in an address as the address's own, as \\href and url.sty read it outside an argument", () => {
    // An extra stands where the upload had it, as an address between two header calls did, where
    // hyperref reads the % as a character.
    for (const latex of [
      "\\href{https://quill.example/a%20b}{my site}",
      "\\href [pdfnewwindow] {https://quill.example/a%20b}{my site}",
      "\\url{https://example.com/50%off}",
      "\\url|https://example.com/50%off{|",
      "\\path{C:/Invented%20Folder}",
      "\\nolinkurl{quill.example/a%7Bb}",
      // Braces inside an address are counted as the command counts them.
      "\\url{https://example.com/{a}%b}",
    ])
      expect(KeptLatex.safeParse(latex).success, latex).toBe(true);
    // A locked part is written inside `\rtlocked`'s argument, where every % is a comment.
    const locked = "a locked part's braces do not balance as TeX reads an argument";
    expect(messages(LockedLatex.safeParse("\\url{https://example.com/50%off}"))).toEqual([locked]);
    expect(messages(LockedLatex.safeParse("\\url{https://example.com/50\\%off}"))).toEqual([]);
    expect(accepts(withLocked({ latex: "\\href{https://quill.example/a%20b}{x}" }))).toBe(false);
    expect(accepts(withLocked({ latex: "\\href{https://quill.example/a\\%20b}{x}" }))).toBe(true);
  });

  it("holds each node's kept slots to the slots it has, and none on a locked section", () => {
    const kept = {
      ...everything,
      header: { ...everything.header, kept: ["first", "last", "links"] },
      sections: everything.sections.map((section) => {
        switch (section.kind) {
          case "entries":
            return {
              ...section,
              kept: ["title"],
              entries: (section.entries ?? []).map((entry) => ({
                ...entry,
                kept: ["dates", "bullets"],
              })),
            };
          case "paragraph":
            return { ...section, kept: ["text"] };
          default:
            return { ...section, kept: ["title", "items"] };
        }
      }),
    };
    expect(Resume.parse(kept)).toEqual(kept);
    expect(accepts(withEntry({ kept: ["label"] }))).toBe(false);
    expect(accepts(withEntry({ kept: "dates" }))).toBe(false);
    const header = (slots: unknown) => ({
      ...minimal,
      sections: [],
      header: { ...minimal.header, kept: slots },
    });
    expect(accepts(header(["email"]))).toBe(true);
    expect(accepts(header(["contacts"]))).toBe(false);
    const paragraph = { kind: "paragraph", id: "p", title: "", role: "other", text: [] };
    expect(accepts({ ...minimal, sections: [{ ...paragraph, kept: ["items"] }] })).toBe(false);
    expect(accepts(withLocked({ kept: ["title"] }))).toBe(false);
  });

  it("takes extras as kept LaTeX under a key a snippet can name, and nothing else", () => {
    const longest = `a${"b".repeat(31)}`;
    for (const key of ["a", "photo", "arg-2", "a1", longest])
      expect(Extras.safeParse({ [key]: "x" }).success, key).toBe(true);
    for (const key of ["", "A", "Photo", "1a", "-a", "a_b", "a.b", `${longest}c`])
      expect(Extras.safeParse({ [key]: "x" }).success, key).toBe(false);
    expect(Extras.safeParse({ photo: 3 }).success).toBe(false);
    expect(Extras.safeParse({ photo: { file: "face.png" } }).success).toBe(false);
    expect(Extras.safeParse({ photo: "\\rtfield{x}{y}" }).success).toBe(false);
    expect(Extras.safeParse({ photo: "\\photo{face" }).success).toBe(false);
    expect(accepts(withEntry({ extras: { Icon: "x" } }))).toBe(false);
  });
});
