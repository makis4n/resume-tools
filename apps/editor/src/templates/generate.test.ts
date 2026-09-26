import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { EngineManifest } from "../engine/manifest";
import { isFormatName } from "../engine/names";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { CompileResult, EngineSession } from "../engine/session";
import { type DrawnPage, drawPage } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { bound, fastest } from "../test/timing";
import { type PageItem, parseDvi } from "../tex/dvi";
import { alignGlyphs, collectFields, MARKER_BEGIN, MARKER_END } from "../tex/fields";
import { curated } from "./curated";
import {
  fontDeclarations,
  formatName,
  type GeneratedBody,
  GenerateError,
  generateBody,
  generateFormat,
  linkAddress,
  MAX_BODY,
} from "./generate";
import { INVENTED_XETEX } from "./invented";
import { type ControlValues, defaultControls, parsePackage, type TemplatePackage } from "./package";
import { PARAGRAPH_MARKER, PRELUDE } from "./prelude";

type PackageInput = z.input<typeof TemplatePackage>;

/**
 * A package on `article`, invented for these tests, that uses every construct the generator
 * renders: typeset, raw and URL slots, blocks of both kinds, a variant and a separator by role,
 * contact and link snippets, a file of its own, and every control, written out of the schema's
 * order.
 */
const input: PackageInput = {
  version: 1,
  id: "plain",
  name: "Plain",
  engine: "pdftex",
  source: { url: "https://example.com/plain", license: "MIT", attribution: "Invented for tests" },
  files: { "rtplain.sty": "\\ProvidesPackage{rtplain}\n\\newcommand{\\plainmark}{\\relax}\n" },
  preamble: [
    "\\documentclass[{{fontSize}}pt,dvipdfmx]{article}",
    "\\usepackage{geometry}",
    "\\usepackage{xcolor}",
    "\\usepackage[hidelinks]{hyperref}",
    "\\usepackage{rtplain}",
    "\\pagestyle{empty}",
    "\\setlength{\\parindent}{0pt}",
    // LaTeX sets its own bullet, \textbullet, from TS1, which the page cannot draw yet.
    "\\renewcommand{\\labelitemi}{$\\bullet$}",
  ].join("\n"),
  controls: {
    density: {
      default: "normal",
      apply: {
        compact: "\\linespread{0.9}",
        normal: "\\linespread{1}",
        relaxed: "\\linespread{1.1}",
      },
    },
    accent: { default: "#1f4e79", apply: "\\definecolor{accent}{HTML}{{{value}}}" },
    fontSize: { default: 11, apply: "\\newcommand{\\bodysize}{{{value}}pt}", format: true },
    font: {
      default: "serif",
      choices: [
        { id: "serif", name: "Serif", apply: "\\renewcommand{\\familydefault}{\\rmdefault}" },
        { id: "sans", name: "Sans", apply: "\\renewcommand{\\familydefault}{\\sfdefault}" },
      ],
    },
    margins: { default: 0.8, apply: "\\geometry{margin={{value}}in}" },
    pageSize: {
      default: "letter",
      apply: { letter: "\\geometry{letterpaper}", a4: "\\geometry{a4paper}" },
    },
    dateFormat: { default: "MMM yyyy" },
  },
  snippets: {
    document: "\\begin{document}\n{{header}}\n{{sections}}\n\\end{document}",
    header: [
      "\\plainmark",
      "\\begin{center}",
      "{\\Large\\textbf{{{first}} {{last}}}}\\\\",
      "{{#headline}}",
      "\\textit{{{headline}}}\\\\",
      "{{/headline}}",
      "{{contacts}}",
      "\\end{center}",
    ].join("\n"),
    contact: {
      phone: "\\href{{{&href}}}{{{text}}}",
      email: "\\href{{{&href}}}{\\underline{{{text}}}}",
      location: "{{text}}",
    },
    link: {
      github: "Code: \\href{{{&href}}}{{{label}}}",
      other: "\\href{{{&href}}}{{{label}}}",
    },
    section: {
      entries: "\\section*{\\color{accent}{{title}}}\n{{entries}}",
      list: [
        "\\section*{{{title}}}",
        "{{#items}}",
        "\\begin{itemize}",
        "{{items}}",
        "\\end{itemize}",
        "{{/items}}",
      ].join("\n"),
      labelled: "\\section*{{{title}}}\n{{items}}",
      // Numbered, so the title also goes to the table of contents and to a bookmark.
      paragraph: "\\section{{{title}}}\n{{text}}",
    },
    entry: {
      default: [
        "\\textbf{{{title}}}{{#place}}, {{place}}{{/place}} \\hfill {{dates}}\\par",
        "{{#subtitle}}",
        "\\textit{{{subtitle}}}\\par",
        "{{/subtitle}}",
        "{{#bullets}}",
        "\\begin{itemize}",
        "{{bullets}}",
        "\\end{itemize}",
        "{{/bullets}}",
      ].join("\n"),
      projects: [
        "\\textbf{{{title}}}{{#subtitle}} $|$ \\emph{{{subtitle}}}{{/subtitle}}{{^dates}} (undated){{/dates}} \\hfill {{dates}}\\par",
        "{{#bullets}}",
        "\\begin{itemize}",
        "{{bullets}}",
        "\\end{itemize}",
        "{{/bullets}}",
      ].join("\n"),
    },
    bullet: "\\item {{text}}",
    item: "\\item {{text}}",
    labelledItem: "\\textbf{{{label}}}: {{text}}\\par",
    separators: {
      contacts: " $|$ ",
      links: ", ",
      sections: "\n\n",
      entries: { default: "\n\\medskip\n", projects: "\n\\smallskip\n" },
    },
  },
};

const pkg = parsePackage(input);

/** The package with a change. */
function packageWith(change: (pkg: PackageInput) => void): TemplatePackage {
  const copy = structuredClone(input);
  change(copy);
  return parsePackage(copy);
}

/** An invented resume that reaches every snippet, with empty and absent optional fields. */
const resume = Resume.parse({
  version: 1,
  header: {
    name: { first: "Ilse", last: "Marrow" },
    headline: "Typesetting engineer",
    email: "ilse_m@example.com",
    phone: "+1 555 0100",
    links: [
      { id: "code", kind: "github", label: "code.example/ilse", href: "https://code.example/ilse" },
      { id: "site", kind: "website", label: "marrow.example", href: "https://marrow.example/" },
    ],
  },
  sections: [
    {
      id: "summary",
      kind: "paragraph",
      role: "summary",
      title: "Summary & aims",
      text: [
        { text: "Builds " },
        { text: "fast", bold: true },
        { text: ", " },
        { text: "careful", italic: true },
        { text: " tools", bold: true, italic: true },
        { text: "; see " },
        { text: "notes", href: "https://notes.example/a b?x=1&y=2#top_1" },
        { text: " and " },
        { text: "the log", bold: true, href: "https://log.example/" },
        { text: "." },
      ],
    },
    {
      id: "work",
      kind: "entries",
      role: "experience",
      title: "Experience",
      entries: [
        {
          id: "fennel",
          title: "Engineer",
          subtitle: "Fennel Systems",
          place: "Remote",
          dates: { start: "2021-03", end: "present" },
          bullets: [
            { id: "fennel-1", text: [{ text: "Cut build times by 40% & more" }] },
            {
              id: "fennel-2",
              text: [{ text: "Ran the " }, { text: "release", italic: true }, { text: " train" }],
            },
          ],
        },
        {
          id: "larch",
          title: "Intern",
          subtitle: "",
          dates: { start: "2019-06", end: "2019-09" },
          bullets: [],
        },
      ],
    },
    {
      id: "projects",
      kind: "entries",
      role: "projects",
      title: "Projects",
      entries: [
        {
          id: "galley",
          title: "Galley",
          subtitle: "TypeScript",
          bullets: [{ id: "galley_1", text: [{ text: "A page editor" }] }],
        },
        { id: "quire", title: "Quire", dates: { start: "2020" }, bullets: [] },
      ],
    },
    {
      id: "skills",
      kind: "labelled",
      role: "skills",
      title: "Skills",
      items: [{ id: "langs", label: "Languages", text: [{ text: "TypeScript, Rust" }] }],
    },
    {
      id: "awards",
      kind: "list",
      role: "awards",
      title: "Awards",
      items: [{ id: "prize", text: [{ text: "Best paper, 2020" }] }],
    },
  ],
});

/** Each field the resume shows through the package, with its text as the page shows it. */
const TEXTS = {
  "header.first": "Ilse",
  "header.last": "Marrow",
  "header.headline": "Typesetting engineer",
  "header.phone": "+1 555 0100",
  "header.email": "ilse_m@example.com",
  "code.label": "code.example/ilse",
  "site.label": "marrow.example",
  "summary.title": "Summary & aims",
  "summary.text": "Builds fast, careful tools; see notes and the log.",
  "work.title": "Experience",
  "fennel.title": "Engineer",
  "fennel.subtitle": "Fennel Systems",
  "fennel.place": "Remote",
  "fennel.dates": "Mar 2021 \u2013 Present",
  "fennel-1.text": "Cut build times by 40% & more",
  "fennel-2.text": "Ran the release train",
  "larch.title": "Intern",
  "larch.dates": "Jun 2019 \u2013 Sep 2019",
  "projects.title": "Projects",
  "galley.title": "Galley",
  "galley.subtitle": "TypeScript",
  "galley_1.text": "A page editor",
  "quire.title": "Quire",
  "quire.dates": "2020",
  "skills.title": "Skills",
  "langs.label": "Languages",
  "langs.text": "TypeScript, Rust",
  "awards.title": "Awards",
  "prize.text": "Best paper, 2020",
};

/** The ids of the fields a body marks, in order, once for each time it marks one. */
const marked = (latex: string) => [...latex.matchAll(/\\rtfield\{([^}]*)\}/g)].map((m) => m[1]);

/**
 * The package with a header that sets fields twice: the name in the PDF's author before it shows
 * it, and the links in the contacts and again on their own. Its preamble is the package's, so it
 * compiles from the same format.
 */
const twice = packageWith((pkg) => {
  pkg.snippets.header = [
    "\\hypersetup{pdfauthor={{{first}} {{last}}}}",
    "{\\Large {{first}} {{last}}}\\\\",
    "{{contacts}}\\\\",
    "{{links}}",
  ].join("\n");
});

/** What a call throws. */
function thrown(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("nothing was thrown");
}

describe("generateBody", () => {
  it("applies each control's snippet in the schema's order, then sets the document", () => {
    const lines = (values: Parameters<typeof generateBody>[2]) =>
      generateBody(pkg, resume, values).latex.split("\n").slice(0, 7);
    expect(lines({})).toEqual([
      "\\geometry{letterpaper}",
      "\\geometry{margin=0.8in}",
      "\\newcommand{\\bodysize}{11pt}",
      "\\renewcommand{\\familydefault}{\\rmdefault}",
      "\\definecolor{accent}{HTML}{1F4E79}",
      "\\linespread{1}",
      "\\begin{document}",
    ]);
    const values = {
      pageSize: "a4",
      margins: 0.1 + 0.2 + 0.4,
      fontSize: 10.5,
      font: "sans",
      accent: "#aa0033",
      density: "compact",
    } as const;
    expect(lines(values)).toEqual([
      "\\geometry{a4paper}",
      "\\geometry{margin=0.7in}",
      "\\newcommand{\\bodysize}{10.5pt}",
      "\\renewcommand{\\familydefault}{\\sfdefault}",
      "\\definecolor{accent}{HTML}{AA0033}",
      "\\linespread{0.9}",
      "\\begin{document}",
    ]);
    expect(generateBody(pkg, resume, {}).latex.endsWith("\n\\end{document}\n")).toBe(true);
  });

  it("ignores a value for a control the package does not offer", () => {
    const bare = packageWith((pkg) => {
      pkg.preamble = "\\documentclass{article}";
      pkg.controls = {};
    });
    const { latex } = generateBody(bare, resume, { margins: 0.5, pageSize: "a4" });
    expect(latex.startsWith("\\begin{document}\n")).toBe(true);
  });

  it("refuses a font the package does not offer", () => {
    const error = thrown(() => generateBody(pkg, resume, { font: "mono" }));
    expect(error).toBeInstanceOf(GenerateError);
    expect(error.message).toBe("the template has no font mono");
  });

  it("marks every field by its node's id, and holds each field's text as the page shows it", () => {
    const { latex, texts } = generateBody(pkg, resume, {});
    expect(Object.fromEntries(texts)).toEqual(TEXTS);
    expect(marked(latex).sort()).toEqual(Object.keys(TEXTS).sort());
    expect(latex).toContain(String.raw`\rtfield{fennel.dates}{Mar 2021 – Present}`);
    expect(latex).toContain(String.raw`\section{\rtfield{summary.title}{Summary \& aims}}`);
  });

  it("formats dates in the document's format, or the package's", () => {
    const monthly = generateBody(pkg, resume, { dateFormat: "MM/yyyy" }).texts;
    expect(monthly.get("fennel.dates")).toBe("03/2021 \u2013 Present");
    const spelled = packageWith((pkg) => {
      pkg.controls.dateFormat = { default: "MMMM yyyy" };
    });
    const texts = generateBody(spelled, resume, {}).texts;
    expect(texts.get("larch.dates")).toBe("June 2019 \u2013 September 2019");
    expect(texts.get("quire.dates")).toBe("2020");
  });

  it("leaves an empty optional field out, skipping a block over it and keeping an inverted one", () => {
    const { latex, texts } = generateBody(pkg, resume, {});
    for (const id of ["larch.subtitle", "larch.place", "galley.dates", "header.location"])
      expect(texts.has(id), id).toBe(false);
    // The whole work section, every line of it: the standalone block tags of the intern's
    // subtitle and bullets take their lines with them, so no blank line is left behind.
    const work = [
      String.raw`\section*{\color{accent}\rtfield{work.title}{Experience}}`,
      String.raw`\textbf{\rtfield{fennel.title}{Engineer}}, \rtfield{fennel.place}{Remote} \hfill \rtfield{fennel.dates}{Mar 2021 – Present}\par`,
      String.raw`\textit{\rtfield{fennel.subtitle}{Fennel Systems}}\par`,
      String.raw`\begin{itemize}`,
      String.raw`\item \rtfield{fennel-1.text}{Cut build times by 40\% \& more}`,
      String.raw`\item \rtfield{fennel-2.text}{Ran the \textit{release} train}`,
      String.raw`\end{itemize}`,
      "",
      String.raw`\medskip`,
      String.raw`\textbf{\rtfield{larch.title}{Intern}} \hfill \rtfield{larch.dates}{Jun 2019 – Sep 2019}\par`,
      "",
      "",
      String.raw`\section*{\color{accent}\rtfield{projects.title}{Projects}}`,
    ].join("\n");
    expect(latex).toContain(work);
    expect(latex).toContain(
      String.raw`\textbf{\rtfield{galley.title}{Galley}} $|$ \emph{\rtfield{galley.subtitle}{TypeScript}} (undated) \hfill \par`,
    );
  });

  it("sets rich runs in bold, italic, both, and links with escaped addresses", () => {
    const { latex } = generateBody(pkg, resume, {});
    expect(latex).toContain(
      String.raw`\rtfield{summary.text}{Builds \textbf{fast}, \textit{careful}\textbf{\textit{ tools}}; see \href{https://notes.example/a\%20b?x=1\&y=2\#top\_1}{notes} and \href{https://log.example/}{\textbf{the log}}.}`,
    );
  });

  it("keeps a ? or ! that ends a run from a backtick that begins the next", () => {
    const quoted = Resume.parse({
      ...resume,
      sections: [
        {
          id: "summary",
          kind: "paragraph",
          role: "summary",
          title: "Summary",
          text: [
            { text: "Really?" },
            { text: "` and `" },
            { text: "!", bold: true },
            { text: "`x" },
          ],
        },
      ],
    });
    const { latex } = generateBody(pkg, quoted, {});
    // A bold run is set in a font of its own, so the backtick after it needs no group.
    expect(latex).toContain("\\rtfield{summary.text}{Really?{}` and `\\textbf{!}`x}");
  });

  it("joins the contacts that are there with their separator, then the links", () => {
    const { latex } = generateBody(pkg, resume, {});
    const contacts = [
      String.raw`\href{tel:+15550100}{\rtfield{header.phone}{+1 555 0100}}`,
      String.raw`\href{mailto:ilse\_m@example.com}{\underline{\rtfield{header.email}{ilse\_m@example.com}}}`,
      // A link kind with a snippet of its own, then one that falls back to other's.
      String.raw`Code: \href{https://code.example/ilse}{\rtfield{code.label}{code.example/ilse}}`,
      String.raw`\href{https://marrow.example/}{\rtfield{site.label}{marrow.example}}`,
    ];
    expect(latex).toContain(`${contacts.join(" $|$ ")}\n\\end{center}`);
    // A field without a snippet is left out even when it is there.
    const noEmail = packageWith((pkg) => {
      pkg.snippets.contact = { phone: "{{text}}", location: "{{text}}" };
    });
    const located = { ...resume, header: { ...resume.header, location: "Quillford" } };
    const body = generateBody(noEmail, located, {});
    expect(body.latex).toContain(
      String.raw`\rtfield{header.phone}{+1 555 0100} $|$ \rtfield{header.location}{Quillford} $|$ Code:`,
    );
    expect(body.texts.has("header.email")).toBe(false);
  });

  it("gives each contact the address it links to, escaped as a URL, and the location none", () => {
    const addressed = packageWith((pkg) => {
      pkg.snippets.contact = {
        phone: "\\href{{{&href}}}{{{text}}}",
        email: "\\href{{{&href}}}{{{text}}}",
        location: "{{#href}}\\href{{{&href}}}{x}{{/href}}{{^href}}no address: {{/href}}{{text}}",
      };
    });
    const header = {
      ...resume.header,
      email: " Ilse <ilse@example.com> ",
      phone: "+1 555 0100 | +44 20 7946 0000",
      location: "Quillford",
    };
    const { latex } = generateBody(addressed, { ...resume, header }, {});
    expect(latex).toContain(
      String.raw`\href{tel:+15550100\%7C+442079460000}{\rtfield{header.phone}`,
    );
    expect(latex).toContain(
      String.raw`\href{mailto:Ilse\%20\%3Cilse@example.com\%3E}{\rtfield{header.email}`,
    );
    expect(latex).toContain(String.raw`no address: \rtfield{header.location}{Quillford}`);
  });

  it("percent-encodes what an address would read as its own syntax in a contact field", () => {
    // A # would begin a fragment, so that the address would be a's; a / would begin a path.
    const header = { ...resume.header, email: "a#b@example.com", phone: "+1 555/0100" };
    const { latex } = generateBody(pkg, { ...resume, header }, {});
    expect(latex).toContain(String.raw`\href{mailto:a\%23b@example.com}`);
    expect(latex).toContain(String.raw`\href{tel:+1555\%2F0100}`);
    // And ?, & and %, a % once, since escapeUrl keeps one it finds.
    const other = { ...resume.header, email: "q?x&y%z@example.com" };
    expect(generateBody(pkg, { ...resume, header: other }, {}).latex).toContain(
      String.raw`\href{mailto:q\%3Fx\%26y\%25z@example.com}`,
    );
  });

  it("marks every render of a field, and holds each field's text once", () => {
    const { latex, texts } = generateBody(twice, resume, {});
    const ids = marked(latex);
    for (const id of ["header.first", "header.last", "code.label", "site.label"])
      expect(
        ids.filter((each) => each === id),
        id,
      ).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set(texts.keys()));
    expect(texts.get("code.label")).toBe("code.example/ilse");
    // The name in the PDF's author as well as on the page, and the links in both lists: here
    // through {{links}}, whose separator is a comma.
    expect(latex).toContain(
      String.raw`\hypersetup{pdfauthor={\rtfield{header.first}{Ilse} \rtfield{header.last}{Marrow}}}`,
    );
    expect(latex).toContain(
      String.raw`Code: \href{https://code.example/ilse}{\rtfield{code.label}{code.example/ilse}}, \href{https://marrow.example/}{\rtfield{site.label}{marrow.example}}`,
    );
  });

  it("leaves a link with neither a label nor an address out of both lists", () => {
    const withLink = (link: { label: string; href: string }) => ({
      ...resume,
      header: {
        ...resume.header,
        links: [...resume.header.links, { id: "new", kind: "other" as const, ...link }],
      },
    });
    for (const each of [pkg, twice]) {
      const without = generateBody(each, resume, {});
      // An address the editor does not link is no address, as a blank one is.
      for (const href of [" ", "run:calc.exe", "#top"]) {
        const fresh = generateBody(each, withLink({ label: "", href }), {});
        expect(fresh.latex, href).toBe(without.latex);
        expect(fresh.texts, href).toEqual(without.texts);
      }
    }
    // A link with an address stays while its label is empty, as it does the other way round.
    const addressOnly = generateBody(
      pkg,
      withLink({ label: "", href: "https://new.example/" }),
      {},
    );
    expect(addressOnly.latex).toContain(String.raw` $|$ \href{https://new.example/}{}`);
    const labelOnly = generateBody(pkg, withLink({ label: "New", href: "" }), {});
    expect(labelOnly.latex).toContain(String.raw` $|$ \href{}{\rtfield{new.label}{New}}`);
  });

  it("links a header link and a rich run to the address linkAddress gives, or not at all", () => {
    // A link snippet that tests its address, as Jake's does, and sets the label alone without one.
    const guarded = packageWith((pkg) => {
      pkg.snippets.link = {
        other: "{{#href}}\\href{{{&href}}}{{{label}}}{{/href}}{{^href}}{{label}}{{/href}}",
      };
    });
    const typed = Resume.parse({
      ...resume,
      header: {
        ...resume.header,
        links: [
          { id: "code", kind: "github", label: "Code", href: "code.example/ilse" },
          { id: "tool", kind: "other", label: "Tool", href: "run:calc.exe" },
        ],
      },
      sections: [
        {
          id: "summary",
          kind: "paragraph",
          role: "summary",
          title: "Summary",
          text: [
            { text: "Mail", href: "ilse@example.com" },
            { text: ", " },
            { text: "launch", bold: true, href: "run:calc.exe" },
            { text: " and " },
            { text: "top", href: "#Doc-Start" },
          ],
        },
      ],
    });
    const { latex, texts } = generateBody(guarded, typed, {});
    // The contacts link to the addresses the generator builds for them, as before.
    expect(latex).toContain(
      [
        String.raw`\href{tel:+15550100}{\rtfield{header.phone}{+1 555 0100}}`,
        String.raw`\href{mailto:ilse\_m@example.com}{\underline{\rtfield{header.email}{ilse\_m@example.com}}}`,
        String.raw`\href{https://code.example/ilse}{\rtfield{code.label}{Code}}`,
        String.raw`\rtfield{tool.label}{Tool}`,
      ].join(" $|$ "),
    );
    expect(latex).toContain(
      String.raw`\rtfield{summary.text}{\href{mailto:ilse@example.com}{Mail}, \textbf{launch} and top}`,
    );
    // What the page shows is the text alone either way.
    expect(texts.get("summary.text")).toBe("Mail, launch and top");
  });

  it("chooses variants and separators by role, and the default for a role without its own", () => {
    const { latex } = generateBody(pkg, resume, {});
    expect(latex).toContain("\\end{itemize}\n\n\\medskip\n\\textbf{\\rtfield{larch.title}");
    expect(latex).toContain("\\end{itemize}\n\n\\smallskip\n\\textbf{\\rtfield{quire.title}");
    expect(latex).toContain(String.raw`\textbf{\rtfield{quire.title}{Quire}} \hfill \rtfield`);
  });

  it("sets raw slots escaped and without markers, adding no field", () => {
    const raw = packageWith((pkg) => {
      pkg.snippets.labelledItem = "\\textbf{{{&label}}}: {{&text}}\\par";
      pkg.snippets.entry = "{{&title}} ({{&dates}})";
    });
    const tricky = Resume.parse({
      ...resume,
      sections: [
        {
          id: "skills",
          kind: "labelled",
          role: "skills",
          title: "Skills",
          items: [{ id: "langs", label: "C & C#", text: [{ text: "50%", bold: true }] }],
        },
        {
          id: "work",
          kind: "entries",
          role: "experience",
          title: "Work",
          entries: [{ id: "x", title: "R&D [lab]*", dates: { start: "2020" }, bullets: [] }],
        },
      ],
    });
    const { latex, texts } = generateBody(raw, tricky, {});
    expect(latex).toContain(String.raw`\textbf{C \& C\#}: \textbf{50\%}\par`);
    expect(latex).toContain(String.raw`R\&D {[}lab{]}{*} (2020)`);
    expect([...texts.keys()].filter((id) => /^(langs|x)\./.test(id))).toEqual([]);
  });

  it("leaves out what a XeTeX package's fonts cannot set, says which, and keeps the text", () => {
    // XeTeX would set each font's .notdef box for them, where pdfTeX's LaTeX leaves them out.
    const { package: xetex, sample } = INVENTED_XETEX;
    const edited = structuredClone(sample);
    const [summary] = edited.sections;
    if (summary?.kind !== "paragraph") throw new Error("the sample starts with its summary");
    const typed = "Cut 40 \u{2192} 12 minutes \u{1f600} for the caf\u{e9}, and \u{2192} again";
    summary.text = [{ text: typed }];
    const covers = (char: string) => char !== "\u{2192}" && char !== "\u{1f600}";
    const body = generateBody(xetex, edited, {}, { covers });
    expect(body.latex).toContain(
      "\\rtfield{summary.text}{Cut 40  12 minutes  for the caf\u{e9}, and  again}",
    );
    expect(body.dropped).toEqual(["\u{2192}", "\u{1f600}"]);
    // The page aligns its glyphs with the text as the model holds it.
    expect(body.texts.get("summary.text")).toBe(typed);
    // Without a coverage, nothing is left out, as for a pdfTeX package, whose prelude does it.
    const whole = generateBody(xetex, edited, {});
    expect(whole.latex).toContain(typed);
    expect(whole.dropped).toEqual([]);
  });

  it("writes a break opportunity after every 200 characters of a run with no space, and none before", () => {
    // XeTeX builds one node of a run of characters with nothing to break it, and one of about
    // 1,100 overflows the engine's stack; the break sets nothing, so every character still typesets.
    const BREAK = "\\allowbreak ";
    /** The LaTeX of a bullet of the runs given, as the package's bullet snippet sets it. */
    const bullet = (text: string | { text: string; bold?: boolean }[]) => {
      const runs = typeof text === "string" ? [{ text }] : text;
      const one = Resume.parse({
        version: 1,
        header: { name: { first: "Ilse", last: "Marrow" }, links: [] },
        sections: [
          {
            id: "work",
            kind: "entries",
            role: "experience",
            title: "Work",
            entries: [{ id: "tern", title: "Typesetter", bullets: [{ id: "b", text: runs }] }],
          },
        ],
      });
      const body = generateBody(pkg, one, {});
      expect(body.texts.get("b.text")).toBe(runs.map((run) => run.text).join(""));
      return /\\rtfield\{b\.text\}\{(.*)\}\n/.exec(body.latex)?.[1];
    };
    const a = (count: number) => "a".repeat(count);
    const b = (count: number) => "b".repeat(count);
    expect(bullet(a(200))).toBe(a(200));
    expect(bullet(a(201))).toBe(`${a(200)}${BREAK}a`);
    expect(bullet(a(450))).toBe(`${a(200)}${BREAK}${a(200)}${BREAK}${a(50)}`);
    // A space, or a no-break space, begins a run again.
    expect(bullet(`${a(150)} ${b(200)}`)).toBe(`${a(150)} ${b(200)}`);
    expect(bullet(`${a(150)}\u00a0${b(200)}`)).toBe(`${a(150)}~${b(200)}`);
    // A run goes on across rich text's runs, and an escaped character is one character.
    expect(bullet([{ text: a(150) }, { text: b(100), bold: true }])).toBe(
      `${a(150)}\\textbf{${b(50)}${BREAK}${b(50)}}`,
    );
    expect(bullet("&".repeat(201))).toBe(`${"\\&".repeat(200)}${BREAK}\\&`);
    // An accent sets a glyph and counts, and goes with the letter before it: no break comes
    // between them, so a letter goes on to the next piece with its accents.
    expect(bullet("e\u0301".repeat(201))).toBe(
      `${"\u00e9".repeat(100)}${BREAK}${"\u00e9".repeat(100)}${BREAK}\u00e9`,
    );
    expect(bullet(`${a(199)}e\u0301`)).toBe(`${a(199)}${BREAK}\u00e9`);
  });

  it("keeps 30 accents on a letter, as Unicode's stream-safe form does, and says it left the rest out", () => {
    const text = `a${"\u0301".repeat(40)}`;
    const one = Resume.parse({
      version: 1,
      header: { name: { first: "Ilse", last: "Marrow" }, links: [] },
      sections: [
        {
          id: "work",
          kind: "entries",
          role: "experience",
          title: "Work",
          entries: [{ id: "tern", title: "Typesetter", bullets: [{ id: "b", text: [{ text }] }] }],
        },
      ],
    });
    const body = generateBody(pkg, one, {});
    // Composed as the escape composes it, the a and its first accent one letter.
    expect(/\\rtfield\{b\.text\}\{(.*)\}\n/.exec(body.latex)?.[1]).toBe(
      `\u00e1${"\u0301".repeat(29)}`,
    );
    expect(body.surplus).toEqual(["\u0301"]);
    // The field's text stays the model's, and the page skips what the body leaves out.
    expect(body.texts.get("b.text")).toBe(text);
    expect(generateBody(pkg, resume, {}).surplus).toEqual([]);
  });

  it("breaks an address it shows as text, and never one it links to", () => {
    const shows = packageWith((pkg) => {
      pkg.snippets.link.other =
        "\\href{{{&href}}}{{{#label}}{{label}}{{/label}}{{^label}}{{&href}}{{/label}}}";
    });
    const long = `https://example.com/${"a".repeat(430)}`;
    const encoded = `https://example.com/${"é".repeat(100)}`;
    const links = Resume.parse({
      version: 1,
      header: {
        name: { first: "Ilse", last: "Marrow" },
        links: [
          { id: "far", kind: "other", label: "", href: long },
          { id: "near", kind: "other", label: "Near", href: long },
          { id: "wide", kind: "other", label: "", href: encoded },
        ],
      },
      sections: [],
    });
    const { latex } = generateBody(shows, links, {});
    const BREAK = "\\allowbreak ";
    const shown = `${long.slice(0, 200)}${BREAK}${long.slice(200, 400)}${BREAK}${long.slice(400)}`;
    expect(latex).toContain(`\\href{${long}}{${shown}}`);
    expect(latex).toContain(`\\href{${long}}{\\rtfield{near.label}{Near}}`);
    // An encoded character sets three characters for each of its bytes, and a break never comes
    // inside it: `é` sets six, `%C3%A9`, so 30 fit after the 20 of the scheme and host, then 33.
    const e = (count: number) => "\\%C3\\%A9".repeat(count);
    const pieces = [`https://example.com/${e(30)}`, e(33), e(33), e(4)];
    expect(latex).toContain(`\\href{https://example.com/${e(100)}}{${pieces.join(BREAK)}}`);
  });

  it("keeps the part of an accented letter the fonts can set: its base, and an accent they have", () => {
    // As pdfTeX's LaTeX sets the base of a letter it has no definition for (`escape.ts`): Roboto
    // has neither ǎ nor the combining caron, and the letter was dropped whole, Xioming.
    const { package: xetex, sample } = INVENTED_XETEX;
    const edited = structuredClone(sample);
    const [summary] = edited.sections;
    if (summary?.kind !== "paragraph") throw new Error("the sample starts with its summary");
    const typed = "Xi\u{1ce}oming and Ka\u{1e69}i";
    summary.text = [{ text: typed }];
    // Neither ǎ nor ṩ, nor the caron or the dot above; the dot below.
    const lacking = ["\u{1ce}", "\u{30c}", "\u{1e69}", "\u{307}"];
    const body = generateBody(xetex, edited, {}, { covers: (char) => !lacking.includes(char) });
    expect(body.latex).toContain("{Xiaoming and Kas\u{323}i}");
    expect(body.dropped).toEqual(["\u{1ce}", "\u{1e69}"]);
    expect(body.texts.get("summary.text")).toBe(typed);
  });

  it("keeps ASCII, spaces and what it escapes, whatever a coverage says", () => {
    const { package: xetex, sample } = INVENTED_XETEX;
    const edited = structuredClone(sample);
    const [summary] = edited.sections;
    if (summary?.kind !== "paragraph") throw new Error("the sample starts with its summary");
    summary.text = [{ text: "A & B\u{a0}{c}_d \u{2019}e" }];
    const body = generateBody(xetex, edited, {}, { covers: () => false });
    expect(body.latex).toContain(String.raw`\rtfield{summary.text}{A \& B~\{c\}\_d e}`);
    // And the en dash the dates are formatted with, which is text the generator sets too.
    expect(body.dropped).toEqual(["\u{2019}", "\u{2013}"]);
  });

  it("refuses a body past MAX_BODY, quickly", () => {
    // The walk stops the moment the body passes MAX_BODY, so a document that sets the sections
    // 100,000 times costs 1.9 to 2.2 times what it costs 10,000 times, both refused at the same
    // size, the difference being the longer snippet's parse; refused only once the body is whole,
    // it cost 10.5 to 10.8 times. So the document is bound by five times itself at a tenth of the
    // repeats, the fastest of five runs of each in the test thread's CPU time (`fastest`), like
    // against like on whatever machine runs the test, rather than in milliseconds, which a slow
    // shared machine may not meet. 1,000 ms stays as a ceiling, should the tenth go slow too.
    const repeated = (count: number) =>
      packageWith((pkg) => {
        pkg.snippets.document = `\\begin{document}\n${"{{sections}}\n".repeat(count)}\\end{document}`;
      });
    const packages = [repeated(10_000), repeated(100_000)];
    for (const each of packages) {
      const error = thrown(() => generateBody(each, resume, {}));
      expect(error).toBeInstanceOf(GenerateError);
      expect(error.message).toContain("MAX_BODY");
      expect(error.message).toContain(String(MAX_BODY));
    }
    const [short = 0, long = 0] = fastest(
      packages.map((each) => () => thrown(() => generateBody(each, resume, {}))),
      5,
    );
    expect(long).toBeLessThan(bound(5, short));
    expect(long).toBeLessThan(1000);
  }, 60_000);

  it("stops a package that repeats lists which render nothing, quickly", () => {
    // No snippet or separator here writes a character, and the controls write a line each, so
    // only the steps of the walk can reach the limit: billions of them, without it. Counted, they
    // stop the package at the limit, where it costs 1.0 to 1.1 times what it costs with a tenth
    // of the repeats; uncounted, the walk grows as the cube of the repeats, took 111 ms at the
    // tenth, and at the whole ran 13 s, until its output outgrew the longest array V8 allows. So
    // the package is bound by three times itself at a tenth, as above, and by 1,000 ms.
    const hollow = (count: number) =>
      packageWith((pkg) => {
        pkg.snippets.document = "{{sections}}".repeat(count);
        pkg.snippets.section = {
          entries: "{{entries}}".repeat(count),
          list: "",
          labelled: "",
          paragraph: "",
        };
        pkg.snippets.entry = "{{bullets}}".repeat(count);
        pkg.snippets.bullet = "";
        pkg.snippets.separators = { sections: "", entries: "", bullets: "" };
      });
    const packages = [hollow(100), hollow(1000)];
    for (const each of packages) {
      const error = thrown(() => generateBody(each, resume, {}));
      expect(error).toBeInstanceOf(GenerateError);
      expect(error.message).toContain("MAX_BODY");
    }
    const [short = 0, long = 0] = fastest(
      packages.map((each) => () => thrown(() => generateBody(each, resume, {}))),
      5,
    );
    expect(long).toBeLessThan(bound(3, short));
    expect(long).toBeLessThan(1000);
  }, 60_000);

  it("renders blocks nested deeper than a call stack goes", () => {
    const depth = 50_000;
    const deep = packageWith((pkg) => {
      pkg.snippets.bullet = `\\item ${"{{#text}}".repeat(depth)}{{text}}${"{{/text}}".repeat(depth)}`;
    });
    const { latex, texts } = generateBody(deep, resume, {});
    expect(latex).toContain(String.raw`\item \rtfield{galley_1.text}{A page editor}`);
    expect(texts.get("fennel-2.text")).toBe("Ran the release train");
  });

  it("decides a field's presence once, so each block that tests a long field costs a step", () => {
    // A summary of 20,000 characters tested by 200,000 blocks costs 0.8 to 1.0 times what the
    // same blocks cost with the summary at 2,000, each block reading the presence its slot was
    // built with. Decided again at each block, by `isBlank` over the summary's text or over its
    // runs joined, it cost 8.0 to 8.2 and 9.1 to 9.3 times: a step per block per character. So
    // the long summary is bound by three times the short, as above, and by 1,000 ms, where 300 ms
    // of elapsed time failed on a shared runner at 305 ms, which is also why its ten runs are
    // given a minute rather than vitest's default five seconds.
    const tested = packageWith((pkg) => {
      pkg.snippets.section.paragraph = "{{#text}}{{/text}}".repeat(200_000);
    });
    const [short = 0, long = 0] = fastest(
      [2_000, 20_000].map((length) => {
        const summarised = withSummary(length);
        return () => {
          try {
            generateBody(tested, summarised, {});
          } catch (error) {
            if (!(error instanceof GenerateError)) throw error;
          }
        };
      }),
      5,
    );
    expect(long).toBeLessThan(bound(3, short));
    expect(long).toBeLessThan(1000);
  }, 60_000);

  it("charges each render of a field its length, so repeating a long field stops", () => {
    const repeated = packageWith((pkg) => {
      pkg.snippets.section.paragraph = "{{text}}".repeat(1000);
    });
    const error = thrown(() => generateBody(repeated, withSummary(2_000), {}));
    expect(error).toBeInstanceOf(GenerateError);
    expect(error.message).toContain("MAX_BODY");
  });
});

/** The resume with only a summary, `length` characters of words, a run for each word. */
function withSummary(length: number): Resume {
  const words = "Builds careful tools for typesetting. ".repeat(Math.ceil(length / 38));
  const text = words.slice(0, length).split(/(?<= )/);
  return Resume.parse({
    ...resume,
    sections: [
      {
        id: "summary",
        kind: "paragraph",
        role: "summary",
        title: "Summary",
        text: text.map((word) => ({ text: word })),
      },
    ],
  });
}

describe("formatName", () => {
  /** The package with no format-bound control, and a preamble of its own. */
  const unbound = (preamble: string) =>
    packageWith((pkg) => {
      pkg.preamble = preamble;
      pkg.controls.fontSize = { default: 11, apply: "" };
    });

  it("is the id and a hash of what is dumped, with a control format-bound or not", () => {
    const name = formatName(unbound("\\documentclass[11pt]{article}"), {});
    expect(name).toMatch(/^plain-[0-9a-f]{8}$/);
    expect(formatName(unbound("\\documentclass[11pt]{article}"), { fontSize: 12 })).toBe(name);
    expect(formatName(pkg, {})).toMatch(/^plain-[0-9a-f]{8}$/);
    expect(generateFormat(pkg, {}).name).toBe(formatName(pkg, {}));
  });

  it("changes with a format-bound value the preamble uses, and not with anything else", () => {
    const name = formatName(pkg, {});
    expect(formatName(pkg, { fontSize: 11 })).toBe(name);
    expect(formatName(pkg, { margins: 0.5, accent: "#000000", dateFormat: "yyyy" })).toBe(name);
    const larger = formatName(pkg, { fontSize: 12 });
    expect(larger).not.toBe(name);
    expect(formatName(pkg, { fontSize: 10.5 })).not.toBe(larger);
    // A format-bound control whose slot the preamble does not use changes nothing dumped.
    const unused = packageWith((pkg) => {
      pkg.controls.margins = {
        default: 0.8,
        apply: "\\geometry{margin={{value}}in}",
        format: true,
      };
    });
    expect(formatName(unused, { margins: 0.5 })).toBe(formatName(unused, { margins: 0.6 }));
  });

  it("differs between packages of one id that dump different preambles or files", () => {
    const name = formatName(unbound("\\documentclass[11pt]{article}"), {});
    expect(formatName(unbound("\\documentclass[12pt]{article}"), {})).not.toBe(name);
    const appended = packageWith((pkg) => {
      pkg.preamble += "\n\\setlength{\\parskip}{6pt}";
    });
    expect(formatName(appended, {})).not.toBe(formatName(pkg, {}));
    const refiled = packageWith((pkg) => {
      pkg.files = { "rtplain.sty": "\\ProvidesPackage{rtplain}\n\\newcommand{\\plainmark}{x}\n" };
    });
    expect(formatName(refiled, {})).not.toBe(formatName(pkg, {}));
    // The same files, listed in another order, are the same dump.
    const listed = (files: Record<string, string>) =>
      packageWith((pkg) => {
        pkg.files = files;
      });
    expect(formatName(listed({ "a.sty": "a", "b.sty": "b" }), {})).toBe(
      formatName(listed({ "b.sty": "b", "a.sty": "a" }), {}),
    );
  });

  it("gives an id shaped like another package's format name a suffix of its own", () => {
    const taken = formatName(pkg, {});
    const lookalike = packageWith((pkg) => {
      pkg.id = taken;
    });
    expect(formatName(lookalike, {})).toMatch(new RegExp(`^${taken}-[0-9a-f]{8}$`));
  });

  it("fits the session's rule for a 64-character id", () => {
    const long = packageWith((pkg) => {
      pkg.id = "a".repeat(64);
    });
    const name = formatName(long, {});
    expect(name).toHaveLength(64);
    expect(name.startsWith(`${"a".repeat(55)}-`)).toBe(true);
    expect(isFormatName(name)).toBe(true);
  });
});

describe("generateFormat", () => {
  it("fills the preamble's slots, appends the prelude and keeps the package's files", () => {
    const format = generateFormat(pkg, { fontSize: 10.5 });
    expect(format.name).toBe(formatName(pkg, { fontSize: 10.5 }));
    expect(format.preamble.startsWith("\\documentclass[10.5pt,dvipdfmx]{article}\n")).toBe(true);
    const last = "\\renewcommand{\\labelitemi}{$\\bullet$}";
    expect(format.preamble.endsWith(`\n${last}\n${PRELUDE}`)).toBe(true);
    expect(format.files).toEqual(input.files);
  });

  it("declares a XeTeX package's fonts by file, after its preamble and before the prelude", () => {
    const xetex = parsePackage({
      ...input,
      engine: "xetex",
      preamble: "\\RequirePackage[OT1]{fontenc}\n\\documentclass{article}",
      fonts: [
        {
          family: "Roboto",
          shapes: { "m/n": "Roboto-Regular.otf", "bx/n": "Roboto-Bold.otf" },
          features: "mapping=tex-text",
        },
        { family: "Icons", shapes: { "m/n": "FontAwesome5Free-Solid-900.otf" } },
      ],
    });
    const declared = [
      "\\DeclareFontFamily{TU}{Roboto}{}",
      '\\DeclareFontShape{TU}{Roboto}{m}{n}{<->"[Roboto-Regular.otf]:mapping=tex-text"}{}',
      '\\DeclareFontShape{TU}{Roboto}{bx}{n}{<->"[Roboto-Bold.otf]:mapping=tex-text"}{}',
      "\\DeclareFontFamily{TU}{Icons}{}",
      '\\DeclareFontShape{TU}{Icons}{m}{n}{<->"[FontAwesome5Free-Solid-900.otf]"}{}',
    ].join("\n");
    expect(fontDeclarations(xetex.fonts ?? [])).toBe(declared);
    expect(generateFormat(xetex, {}).preamble).toBe(
      `\\RequirePackage[OT1]{fontenc}\n\\documentclass{article}\n${declared}\n${PRELUDE}`,
    );
    // The fonts are part of what is dumped, so they name the format too.
    const other = parsePackage({
      ...xetex,
      fonts: [{ family: "Roboto", shapes: { "m/n": "Roboto-Light.otf" } }],
    });
    expect(formatName(other, {})).not.toBe(formatName(xetex, {}));
  });
});

describe("linkAddress", () => {
  it("keeps an address whose scheme is the web's, email's or the phone's, in any case", () => {
    for (const address of [
      "https://quist.example.com",
      "http://quist.example.com/cv",
      "HTTPS://QUIST.EXAMPLE.COM",
      "mailto:mara@example.com",
      "Tel:+14155550132",
    ])
      expect(linkAddress(address), address).toBe(address);
  });

  it("links no other scheme, which hyperref would make a Launch, a GoToR or a script", () => {
    for (const address of [
      "run:calc.exe",
      "RUN:calc.exe",
      "file:///x",
      "javascript:alert(1)",
      "ftp://files.example.com/cv.pdf",
      "data:text/html,x",
    ])
      expect(linkAddress(address), address).toBeUndefined();
  });

  it("gives an email typed without its scheme mailto:", () => {
    expect(linkAddress("mara@example.com")).toBe("mailto:mara@example.com");
    // With a slash it reads as a web address with a user in it.
    expect(linkAddress("mara@example.com/cv")).toBe("https://mara@example.com/cv");
  });

  it("gives an address that begins with // https:, and any other without a scheme https://", () => {
    expect(linkAddress("//host/share/cv.pdf")).toBe("https://host/share/cv.pdf");
    expect(linkAddress("github.com/mara")).toBe("https://github.com/mara");
    expect(linkAddress("quist.example.com")).toBe("https://quist.example.com");
  });

  it("reads the address as escapeUrl writes it, trimmed and without what escapeUrl drops", () => {
    expect(linkAddress("  github.com/mara\n")).toBe("https://github.com/mara");
    expect(linkAddress("\u200bmailto:mara@example.com")).toBe("mailto:mara@example.com");
    expect(linkAddress(" \u200brun:calc.exe")).toBeUndefined();
  });

  it("links neither a blank address nor a name within the document", () => {
    for (const address of ["", "   ", "\u200b", "#Doc-Start", "  #top"])
      expect(linkAddress(address), JSON.stringify(address)).toBeUndefined();
  });
});

/** The glyph texts the aligner accepts for each spelling of a ligature in a field's text. */
const SPELLINGS: Record<string, string[]> = {
  "--": ["--", "\u2013"],
  "---": ["---", "\u2014"],
  "``": ["``", "\u201c"],
  "''": ["''", "\u201d"],
  "`": ["`", "\u2018"],
  "'": ["'", "\u2019"],
};

/** The specials and the three OT1 characters, as a user might type them into a bullet. */
const SPECIALS = "Specials \\ { } $ & # _ % < > | in a row";

/**
 * Bullets, by the last part of their ids, of what pdfTeX sets no glyph for, sets otherwise than
 * the model's text has it, or would read as something else.
 */
const TRICKY = {
  // Characters LaTeX has no definition for, or the generator drops, before words the page aligns.
  emoji: "Led \u{1f680}\u{1f680} launch of the tool",
  cyrillic: "Speaks \u{420}\u{443}\u{441}\u{441}\u{43a}\u{438}\u{439} and English well",
  hidden: "zero\u{200b}\u{200b}\u{200b}\u{200b}width",
  // Characters LaTeX's UTF-8 input defines only for T1, which OT1 has no glyph for.
  t1: "\u{ab} Zarz\u{105}dzanie \u{110} \u{201e}x\u{201c} \u{bb}",
  // A ? before a backtick, which OT1 would set as its inverted question mark; and two backticks
  // and two quotes, which OT1 sets as its double quotes.
  quotes: "Rust's `?` operator",
  doubled: "``x''",
  // An accent typed as a combining mark, which LaTeX has no definition for on its own.
  nfd: "Jose\u{301}",
  // A letter LaTeX has no definition for, as a keyboard composes it and decomposed, which sets
  // its base letter.
  vietnamese: "Nguy\u{1ec5}n",
  decomposed: "Nguye\u{302}\u{303}n",
  // Brackets and a star, which raw text right after \\ or \item would give to the command.
  brackets: "[3 people] led a team*",
};

/**
 * The fields whose glyphs cannot all align with the model's text yet, which the round trip does
 * not count: OT1 sets `ą` as its base letter, which the aligner finds a few letters on; and `ễ` as
 * its base letter alone, which it does not pair with the composed letter.
 */
const MISALIGNED = new Set(["tricky-t1.text", "tricky-vietnamese.text"]);

/**
 * The resume with every character the generator escapes or drops, in several contexts, and with
 * contacts whose addresses need encoding. `dollar` says whether the specials keep their dollar
 * sign, which LaTeX sets from TS1 (see its test), so the page that is drawn is compiled without
 * it.
 */
function specialResume(dollar: boolean): Resume {
  const special = Resume.parse(structuredClone(resume));
  const [summary, work, , , awards] = special.sections;
  if (summary?.kind !== "paragraph" || work?.kind !== "entries" || awards?.kind !== "list")
    throw new Error("the resume's sections moved");
  summary.text = [
    // A tab, a non-breaking space, a zero-width space, and an emoji LaTeX has no definition for.
    { text: "Tab\there, non\u00a0breaking, zero\u200bwidth and ok \u{1f642} done; " },
    { text: "50% & more", bold: true },
    { text: " and " },
    { text: "a_b {c}", italic: true },
    { text: "; see " },
    { text: "notes", href: "https://notes.example/a b?x=1&y=2#top_1" },
    { text: "." },
  ];
  const [first, second] = work.entries[0]?.bullets ?? [];
  const [prize] = awards.items;
  if (!first || !second || !prize) throw new Error("the resume's bullets and items moved");
  first.text = [{ text: dollar ? SPECIALS : SPECIALS.replace("$ ", "") }];
  second.text = [
    { text: "\u201cCurly\u201d and \u2018single\u2019, an en dash \u2013 and -- two" },
  ];
  prize.text = [{ text: "x^y~z" }];
  for (const [key, text] of Object.entries(TRICKY))
    work.entries[0]?.bullets.push({ id: `tricky-${key}`, text: [{ text }] });
  // A display name and a second number, which the addresses built from them percent-encode, and
  // a thin space, which LaTeX has no definition for.
  special.header.email = "Ilse <ilse@example.com>";
  special.header.phone = "+1 555 0100 | +44 20 7946 0000";
  special.header.location = "Paris\u{2009}France";
  return special;
}

/**
 * The package with what the round trip's page cannot also hold: underscore.sty, which makes `_`
 * active; the name and the section titles in \MakeUppercase; a projects bullet in a tabular cell,
 * where TeX cannot break a line; and an education bullet raw, right after \\.
 */
const quirks = packageWith((pkg) => {
  pkg.id = "quirks";
  pkg.preamble += "\n\\usepackage{underscore}";
  pkg.snippets.header =
    "\\begin{center}\n{\\Large\\MakeUppercase{{{first}} {{last}}}}\n\\end{center}";
  pkg.snippets.section.entries = "\\section*{\\MakeUppercase{{{title}}}}\n{{entries}}";
  pkg.snippets.bullet = {
    default: "\\item {{text}}",
    projects: "\\item \\begin{tabular}{l}{{text}}\\end{tabular}",
    education: "\\item x\\\\{{&text}}",
  };
});

/** An invented resume with a bullet for each of the quirks package's bullet snippets. */
const quirksResume = Resume.parse({
  version: 1,
  header: { name: { first: "Ilse", last: "Marrow" }, links: [] },
  sections: [
    {
      id: "work",
      kind: "entries",
      role: "experience",
      title: "Experience",
      entries: [
        {
          id: "fennel",
          title: "Engineer",
          bullets: [{ id: "b_0", text: [{ text: "Cut build times" }] }],
        },
      ],
    },
    {
      id: "projects",
      kind: "entries",
      role: "projects",
      title: "Projects",
      entries: [
        {
          id: "galley",
          title: "Galley",
          bullets: [{ id: "cell", text: [{ text: "Set in a cell" }] }],
        },
      ],
    },
    {
      id: "study",
      kind: "entries",
      role: "education",
      title: "Education",
      entries: [
        {
          id: "quill",
          title: "Quill College",
          bullets: [{ id: "raw", text: [{ text: TRICKY.brackets }] }],
        },
      ],
    },
  ],
});

/**
 * Addresses as a user might type them into a link: a program to run, a file, a script, a name
 * within the document, a share, a web address and an email without their schemes, and a web
 * address in full. Through hyperref as they are, the first four would be a Launch, a GoToR to a
 * file, a URI that runs a script and a GoTo, and the share and the web address GoToR links too.
 */
const TYPED_ADDRESSES = [
  "run:calc.exe",
  "file:///x",
  "javascript:alert(1)",
  "#Doc-Start",
  "//host/share/cv.pdf",
  "github.com/mara",
  "mara@example.com",
  "https://quist.example.com",
];

/** Where the last four of them link once `linkAddress` has read them, in order. */
const LINKED = [
  "https://host/share/cv.pdf",
  "https://github.com/mara",
  "mailto:mara@example.com",
  "https://quist.example.com",
];

/** An invented resume with each typed address as a header link and as a run of the summary. */
const addressed = Resume.parse({
  version: 1,
  header: {
    name: { first: "Mara", last: "Quist" },
    links: TYPED_ADDRESSES.map((href, i) => ({
      id: `link-${i}`,
      kind: "website",
      label: `Link ${i}`,
      href,
    })),
  },
  sections: [
    {
      id: "summary",
      kind: "paragraph",
      role: "summary",
      title: "Summary",
      text: TYPED_ADDRESSES.flatMap((href, i) => [
        ...(i > 0 ? [{ text: ", " }] : []),
        { text: `Address ${i}`, href },
      ]),
    },
  ],
});

/** The keys of the paragraph special, in the order the prelude writes them. */
const PARAGRAPH_KEYS = [
  "hsize",
  "leftskip",
  "rightskip",
  "parfillskip",
  "pretolerance",
  "tolerance",
  "emergencystretch",
  "hangindent",
  "hangafter",
  "parshape",
  "inner",
  "shape",
  "spaceskip",
  "xspaceskip",
];

/** A paragraph special's field id and its parameters, in order. */
function paragraphOf(text: string) {
  const rest = text.slice(PARAGRAPH_MARKER.length);
  const colon = rest.indexOf(":");
  const pairs = rest
    .slice(colon + 1)
    .split(";")
    .map((pair) => pair.split("=") as [string, string]);
  return { id: rest.slice(0, colon), keys: pairs.map(([key]) => key), params: new Map(pairs) };
}

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("the generated LaTeX through the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let body: GeneratedBody;
  let compiled: CompileResult;
  let dollar: CompileResult;
  let drawn: DrawnPage;
  let items: PageItem[];
  beforeAll(async () => {
    session = await startNodeSession();
    const format = generateFormat(pkg, {});
    const dumped = session.dump("pdftex", format.name, format.preamble, format.files);
    if (!dumped.ok) throw new Error(dumped.error);
    body = generateBody(pkg, specialResume(false), {});
    compiled = session.compile("pdftex", format.name, body.latex, { job: "generated" });
    if (!compiled.output) throw new Error(compiled.error);
    const withDollar = generateBody(pkg, specialResume(true), {}).latex;
    dollar = session.compile("pdftex", format.name, withDollar, { job: "dollar" });
    if (!dollar.output) throw new Error(dollar.error);
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    drawn = await drawPage(compiled.output, fonts, body.texts);
    items = parseDvi(compiled.output, () => undefined).pages[0]?.items ?? [];
  }, 60_000);

  it("compiles to one page, with every font drawn and no error in the log", () => {
    expect(compiled.ok).toBe(true);
    expect(compiled.pages).toBe(1);
    expect(drawn.pageCount).toBe(1);
    expect(drawn.missingFonts).toEqual(new Map());
    expect(compiled.log).not.toMatch(/^! /m);
    expect(compiled.log).not.toContain("Undefined control sequence");
    expect(compiled.log).not.toContain("not set up for use with LaTeX");
    // The emoji was left out by the prelude, with a warning, rather than failing the compile.
    expect(compiled.log).toContain("(U+1F642)");
  });

  it("finds every field on the page, each with glyphs", () => {
    const begun = items.flatMap((item) =>
      item.kind === "special" && item.text.startsWith(MARKER_BEGIN)
        ? [item.text.slice(MARKER_BEGIN.length)]
        : [],
    );
    expect([...begun].sort()).toEqual([...body.texts.keys()].sort());
    for (const id of body.texts.keys())
      expect(drawn.fields.get(id)?.glyphs.length, id).toBeGreaterThan(0);
  });

  it("typesets or drops every character, each glyph matching its own character", () => {
    let misaligned = 0;
    for (const field of drawn.fields.values()) {
      const text = body.texts.get(field.id) ?? "";
      if (MISALIGNED.has(field.id)) {
        misaligned += alignGlyphs(field, text);
        continue;
      }
      expect(alignGlyphs(field, text), field.id).toBe(0);
      for (const glyph of field.glyphs) {
        if (glyph.inserted) {
          expect(glyph.text).toBe("-");
          continue;
        }
        if (glyph.text === undefined) continue;
        // A letter TeX set as an accent and a letter reads composed, and a model may hold it
        // decomposed, as typed.
        const spellings = SPELLINGS[glyph.text] ?? [glyph.text, glyph.text.normalize("NFD")];
        expect(
          spellings.some((spelling) => text.startsWith(spelling, glyph.offset)),
          `${field.id} at ${glyph.offset}: glyph "${glyph.text}"`,
        ).toBe(true);
      }
    }
    expect(drawn.unmatched).toBe(misaligned);
  });

  it("leaves out, with a warning, a character the UTF-8 input defines only for T1", () => {
    // In OT1, which has no glyph for them, LaTeX would stop with an error instead.
    for (const command of ["\\guillemetleft", "\\k", "\\DJ", "\\quotedblbase", "\\guillemetright"])
      expect(compiled.log).toContain(`Command ${command} unavailable in encoding OT1;`);
    // The symbols set nothing, and the letter with the ogonek its base letter.
    const glyphs = drawn.fields.get("tricky-t1.text")?.glyphs ?? [];
    expect(glyphs.map((glyph) => glyph.text).join("")).toBe("Zarzadzaniex``");
  });

  it("aligns the words after a run of characters pdfTeX drops, however long", () => {
    for (const key of ["emoji", "cyrillic", "hidden"] as const) {
      const field = drawn.fields.get(`tricky-${key}.text`);
      expect(field && alignGlyphs(field, TRICKY[key]), key).toBe(0);
    }
    const emoji = drawn.fields.get("tricky-emoji.text")?.glyphs ?? [];
    expect(emoji[3]?.offset).toBe(TRICKY.emoji.indexOf("launch"));
  });

  it("sets a thin space as a space between the words", () => {
    const boxes = drawn.glyphs.filter((box) => box.field === "header.location");
    const s = boxes.find((box) => box.offset === "Paris".length - 1);
    const f = boxes.find((box) => box.offset === "Paris ".length);
    if (!s || !f) throw new Error("the location's glyphs moved");
    expect(f.left - s.right).toBeGreaterThan(1);
  });

  it("keeps a ? before a backtick from OT1's ligature, and composes a decomposed accent", () => {
    // Quote left, question mark, quote left: no inverted question mark, which reads as "?`".
    const quotes = drawn.fields.get("tricky-quotes.text")?.glyphs ?? [];
    expect(quotes.map((glyph) => glyph.text)).toEqual([..."Rust's`?`operator"]);
    // The combining acute reaches LaTeX composed with its e, so nothing is left out: OT1 sets it
    // as the accent over the e, which the page reads as one é, drawn by both glyphs.
    expect(compiled.log).not.toContain("U+0301");
    const nfd = drawn.fields.get("tricky-nfd.text")?.glyphs ?? [];
    expect(nfd.map((glyph) => glyph.text)).toEqual(["J", "o", "s", "é"]);
    expect(nfd.at(-1)?.items).toHaveLength(1);
  });

  it("sets two backticks and two quotes as OT1's double quotes", () => {
    const glyphs = drawn.fields.get("tricky-doubled.text")?.glyphs ?? [];
    expect(glyphs.map((glyph) => glyph.text)).toEqual(["``", "x", "''"]);
    const codes = glyphs.map((glyph) => {
      const item = items[glyph.item];
      return item?.kind === "glyph" ? item.code : undefined;
    });
    // OT1's quotedblleft and quotedblright, where ASCII has \ and ".
    expect(codes).toEqual([92, 120, 34]);
  });

  it("sets the base letter of a letter LaTeX has no definition for, typed either way", () => {
    // ễ reaches LaTeX as an e and two combining marks, which the prelude leaves out.
    for (const key of ["vietnamese", "decomposed"]) {
      const glyphs = drawn.fields.get(`tricky-${key}.text`)?.glyphs ?? [];
      expect(glyphs.map((glyph) => glyph.text).join(""), key).toBe("Nguyen");
    }
    expect(compiled.log).toMatch(/\(U\+0302\)\s+is left out/);
    expect(compiled.log).toMatch(/\(U\+0303\)\s+is left out/);
    expect(compiled.log).not.toContain("U+1EC5");
  });

  it("sets a caret and a tilde as OT1's accent glyphs, which read as the characters", () => {
    // OT1 has no ASCII caret or tilde, so LaTeX sets \textasciicircum and \textasciitilde as the
    // circumflex and tilde accents, codes 94 and 126, which `glyphs.ts` reads as the characters.
    const glyphs = drawn.fields.get("prize.text")?.glyphs ?? [];
    expect(glyphs.map((glyph) => glyph.text)).toEqual(["x", "^", "y", "~", "z"]);
    const codes = glyphs
      .filter((glyph) => glyph.text === "^" || glyph.text === "~")
      .map((glyph) => {
        const item = items[glyph.item];
        return item?.kind === "glyph" ? item.code : undefined;
      });
    expect(codes).toEqual([94, 126]);
  });

  it("sets an underscore as the rule OT1 draws for it", () => {
    const at = (text: string) =>
      items.findIndex((item) => item.kind === "special" && item.text === text);
    const begin = at(`${MARKER_BEGIN}fennel-1.text`);
    const end = at(`${MARKER_END}fennel-1.text`);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(items.slice(begin, end).some((item) => item.kind === "rule")).toBe(true);
  });

  it("sets a dollar sign from TS1, which the page cannot draw yet", () => {
    // LaTeX 2023 sets \textdollar, like its itemize bullet, from the TS1 encoding even in an OT1
    // document, since OT1 italic has a pound sign where the dollar goes. The engine tree has the
    // metrics of Computer Modern's TS1 fonts but no Type 1 outlines for them, so the page that is
    // drawn goes without it; here it is found in the DVI.
    expect(dollar.log).not.toMatch(/^! /m);
    const doc = parseDvi(dollar.output as Uint8Array, () => undefined);
    const page = doc.pages[0];
    if (!page) throw new Error("no page");
    const glyphs = collectFields(page, () => undefined).get("fennel-1.text")?.glyphs ?? [];
    const ts1 = glyphs.flatMap((glyph) => {
      const item = page.items[glyph.item];
      const font = item?.kind === "glyph" ? doc.fonts.get(item.font)?.name : undefined;
      return item?.kind === "glyph" && font?.startsWith("tc") ? [`${font} ${item.code}`] : [];
    });
    expect(ts1).toEqual(["tcrm1095 36"]);
  });

  it("writes each field's paragraph right after its begin marker", () => {
    let fields = 0;
    items.forEach((item, index) => {
      if (item.kind !== "special" || !item.text.startsWith(MARKER_BEGIN)) return;
      fields++;
      const id = item.text.slice(MARKER_BEGIN.length);
      const next = items[index + 1];
      expect(next?.kind === "special" && next.text.startsWith(PARAGRAPH_MARKER), id).toBe(true);
      if (next?.kind !== "special") return;
      const paragraph = paragraphOf(next.text);
      expect(paragraph.id).toBe(id);
      expect(paragraph.keys, id).toEqual(PARAGRAPH_KEYS);
      expect(paragraph.params.get("hsize"), id).toMatch(/^\d+(\.\d+)?pt$/);
      expect(paragraph.params.get("parfillskip"), id).toMatch(/^[\d.]+pt( plus [\d.]+fil+)?/);
      expect(paragraph.params.get("tolerance"), id).toMatch(/^-?\d+$/);
      expect(paragraph.params.get("inner"), id).toMatch(/^[01]$/);
    });
    expect(fields).toBe(body.texts.size);

    const paragraph = (id: string) => {
      const item = items.find(
        (item) => item.kind === "special" && item.text.startsWith(`${PARAGRAPH_MARKER}${id}:`),
      );
      return item?.kind === "special" ? paragraphOf(item.text).params : new Map<string, string>();
    };
    // A bullet sits in the itemize's one-line shape, indented by the list's margin.
    const bullet = paragraph("fennel-1.text");
    expect(bullet.get("parshape")).toBe("1");
    expect(bullet.get("inner")).toBe("0");
    const [indent, length, ...more] = (bullet.get("shape") ?? "").split(/[,|]/);
    expect(more).toEqual([]);
    expect(Number.parseFloat(indent ?? "")).toBeGreaterThan(0);
    expect(Number.parseFloat(length ?? "")).toBeGreaterThan(0);
    // A paragraph outside any list has no shape.
    expect(paragraph("summary.text").get("parshape")).toBe("0");
    expect(paragraph("summary.text").get("shape")).toBe("");
    // The email is set in \underline's box, restricted horizontal mode, where TeX cannot break.
    expect(paragraph("header.email").get("inner")).toBe("1");
  });

  it("links through hyperref with the addresses as they were typed, encoded", () => {
    const addresses = items.flatMap((item) => {
      if (item.kind !== "special" || !item.text.startsWith("pdf:bann")) return [];
      const uri = /\/URI\(((?:\\.|[^\\)])*)\)/.exec(item.text);
      return uri ? [uri[1]] : [];
    });
    expect(addresses).toContain("https://notes.example/a%20b?x=1&y=2#top_1");
    // A contact links through the address the generator builds from it, percent-encoded.
    expect(addresses).toContain("mailto:Ilse%20%3Cilse@example.com%3E");
    expect(addresses).toContain("tel:+15550100%7C+442079460000");
    expect(addresses).toContain("https://code.example/ilse");
  });

  describe("with a package that sets the name in the PDF's author, and the links twice", () => {
    let result: CompileResult;
    let page: DrawnPage;
    let pageItems: PageItem[];
    beforeAll(async () => {
      // The header is all that differs, so the format is the one the page above compiled from.
      const twiceBody = generateBody(twice, resume, {});
      result = session.compile("pdftex", generateFormat(twice, {}).name, twiceBody.latex, {
        job: "twice",
      });
      if (!result.output) throw new Error(result.error);
      page = await drawPage(result.output, fonts, twiceBody.texts);
      pageItems = parseDvi(result.output, () => undefined).pages[0]?.items ?? [];
    }, 60_000);

    /** Where the page begins a copy of a field. */
    const begins = (id: string) =>
      pageItems.flatMap((item, index) =>
        item.kind === "special" && item.text === `${MARKER_BEGIN}${id}` ? [index] : [],
      );

    it("finds the name at the copy the page shows, after one in the author with no markers", () => {
      expect(result.log).not.toMatch(/^! /m);
      expect(begins("header.first")).toHaveLength(1);
      const field = page.fields.get("header.first");
      expect(field?.glyphs.map((glyph) => glyph.text).join("")).toBe("Ilse");
      expect(field && alignGlyphs(field, "Ilse")).toBe(0);
      expect(page.unmatched).toBe(0);
    });

    it("finds a link set twice once, with its first copy's glyphs", () => {
      const [first = -1, second = -1, ...more] = begins("code.label");
      expect(more).toEqual([]);
      expect(second).toBeGreaterThan(first);
      const glyphs = page.fields.get("code.label")?.glyphs ?? [];
      expect(glyphs).toHaveLength("code.example/ilse".length);
      expect(glyphs.every((glyph) => glyph.item > first && glyph.item < second)).toBe(true);
    });
  });

  describe("with a package that uppercases, makes _ active and sets a field in a cell", () => {
    let quirked: GeneratedBody;
    let result: CompileResult;
    let page: DrawnPage;
    let specials: string[];
    let glyphCodes: number[];
    beforeAll(async () => {
      const format = generateFormat(quirks, {});
      const dumped = session.dump("pdftex", format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(dumped.error);
      quirked = generateBody(quirks, quirksResume, {});
      result = session.compile("pdftex", format.name, quirked.latex, { job: "quirks" });
      if (!result.output) throw new Error(result.error);
      page = await drawPage(result.output, fonts, quirked.texts);
      const pageItems = parseDvi(result.output, () => undefined).pages[0]?.items ?? [];
      specials = pageItems.flatMap((item) => (item.kind === "special" ? [item.text] : []));
      glyphCodes = pageItems.flatMap((item) => (item.kind === "glyph" ? [item.code] : []));
    }, 60_000);

    it("compiles, and finds a field whose id holds a character underscore.sty makes active", () => {
      expect(result.ok).toBe(true);
      expect(result.log).not.toMatch(/^! /m);
      // The id reaches the marker as its characters, not as what the active _ expands to.
      expect(specials).toContain(`${MARKER_BEGIN}b_0.text`);
      const field = page.fields.get("b_0.text");
      expect(field && alignGlyphs(field, quirked.texts.get("b_0.text") ?? "")).toBe(0);
    });

    it("finds a field set in \\MakeUppercase, whose glyphs are the uppercased letters", () => {
      // The case change reaches the markers, which the page reads whatever their case.
      expect(specials).toContain("RT:B:WORK.TITLE");
      for (const id of [
        "header.first",
        "header.last",
        "work.title",
        "projects.title",
        "study.title",
      ]) {
        const glyphs = page.fields.get(id)?.glyphs ?? [];
        const text = quirked.texts.get(id) ?? "";
        expect(glyphs.map((glyph) => glyph.text).join(""), id).toBe(text.toUpperCase());
      }
    });

    it("says whether TeX can break a field's lines", () => {
      const inner = (id: string) => {
        const special = specials.find((text) => text.startsWith(`${PARAGRAPH_MARKER}${id}:`));
        return special && paragraphOf(special).params.get("inner");
      };
      // A tabular cell is restricted horizontal mode, where TeX never breaks a line.
      expect(inner("cell.text")).toBe("1");
      expect(inner("b_0.text")).toBe("0");
    });

    it("sets brackets and a star right after \\\\ as text, never as the command's argument", () => {
      // The raw bullet has no field, so its glyphs are read off the page, where OT1 codes these
      // characters as ASCII does.
      expect(String.fromCharCode(...glyphCodes)).toContain("x[3people]ledateam*");
    });
  });

  describe("with addresses of every kind, through this package and Jake's", () => {
    const jake = curated("jake");
    const cases: [string, TemplatePackage, ControlValues][] = [
      ["plain", pkg, {}],
      ["jake", jake.package, defaultControls(jake.package)],
    ];
    const compiled = new Map<
      string,
      { body: GeneratedBody; result: CompileResult; page: DrawnPage; banns: string[] }
    >();
    beforeAll(async () => {
      for (const [name, each, values] of cases) {
        const format = generateFormat(each, values);
        // This package's format was dumped above; Jake's is dumped here.
        if (each !== pkg) {
          const dumped = session.dump(each.engine, format.name, format.preamble, format.files);
          if (!dumped.ok) throw new Error(dumped.error);
        }
        const body = generateBody(each, addressed, values);
        const result = session.compile(each.engine, format.name, body.latex, {
          job: `addresses-${name}`,
        });
        if (!result.output) throw new Error(result.error);
        const page = await drawPage(result.output, fonts, body.texts);
        const banns = parseDvi(result.output, () => undefined)
          .pages.flatMap(({ items }) => items)
          .flatMap((item) =>
            item.kind === "special" && item.text.startsWith("pdf:bann") ? [item.text] : [],
          );
        compiled.set(name, { body, result, page, banns });
      }
    }, 60_000);

    it("makes each link a URI to the web, an email or a phone, and the others no link", () => {
      expect([...compiled.keys()]).toEqual(["plain", "jake"]);
      for (const [name, { result, banns }] of compiled) {
        expect(result.log, name).not.toMatch(/^! /m);
        // No Launch, no GoToR to a file and no GoTo within the document.
        for (const bann of banns) expect(bann, name).not.toMatch(/\/S\/(Launch|GoToR|GoTo)\b/);
        const uris = banns.map((bann) => /\/S\/URI\/URI\(((?:\\.|[^\\)])*)\)/.exec(bann)?.[1]);
        // The four that link, in the header and again in the summary, and nothing for the rest.
        expect(uris, name).toEqual([...LINKED, ...LINKED]);
      }
    });

    it("still sets the label or the text of an address it does not link", () => {
      for (const [name, { body, page }] of compiled) {
        for (const id of ["link-0.label", "link-1.label", "link-2.label", "link-3.label"])
          expect(body.texts.get(id), `${name} ${id}`).toBe(`Link ${id.charAt(5)}`);
        expect(body.texts.get("summary.text"), name).toContain("Address 0, Address 1");
        for (const [id, text] of body.texts) {
          const field = page.fields.get(id);
          expect(field?.glyphs.length, `${name} ${id}`).toBeGreaterThan(0);
          expect(field && alignGlyphs(field, text), `${name} ${id}`).toBe(0);
        }
        expect(page.unmatched, name).toBe(0);
      }
    });
  });
});
