import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { EngineManifest } from "../engine/manifest";
import { isFormatName } from "../engine/names";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { CompileResult } from "../engine/session";
import { type DrawnPage, drawPage } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { type PageItem, parseDvi } from "../tex/dvi";
import { alignGlyphs, collectFields, MARKER_BEGIN, MARKER_END } from "../tex/fields";
import {
  formatName,
  type GeneratedBody,
  GenerateError,
  generateBody,
  generateFormat,
  MAX_BODY,
} from "./generate";
import { parsePackage, type TemplatePackage } from "./package";
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
      phone: "{{text}}",
      email: "\\href{mailto:{{&text}}}{{{text}}}",
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

  it("joins the contacts that are there with their separator, then the links", () => {
    const { latex } = generateBody(pkg, resume, {});
    const contacts = [
      String.raw`\rtfield{header.phone}{+1 555 0100}`,
      String.raw`\href{mailto:ilse\_m@example.com}{\rtfield{header.email}{ilse\_m@example.com}}`,
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
          entries: [{ id: "x", title: "R&D", dates: { start: "2020" }, bullets: [] }],
        },
      ],
    });
    const { latex, texts } = generateBody(raw, tricky, {});
    expect(latex).toContain(String.raw`\textbf{C \& C\#}: \textbf{50\%}\par`);
    expect(latex).toContain(String.raw`R\&D (2020)`);
    expect([...texts.keys()].filter((id) => /^(langs|x)\./.test(id))).toEqual([]);
  });

  it("refuses a body past MAX_BODY, quickly", () => {
    const repeated = packageWith((pkg) => {
      pkg.snippets.document = `\\begin{document}\n${"{{sections}}\n".repeat(100_000)}\\end{document}`;
    });
    const started = performance.now();
    const error = thrown(() => generateBody(repeated, resume, {}));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(error).toBeInstanceOf(GenerateError);
    expect(error.message).toContain("MAX_BODY");
    expect(error.message).toContain(String(MAX_BODY));
  });

  it("stops a package that repeats lists which render nothing, quickly", () => {
    // No snippet or separator here writes a character, and the controls write a line each, so
    // only the steps of the walk can reach the limit: billions of them, without it.
    const hollow = packageWith((pkg) => {
      pkg.snippets.document = "{{sections}}".repeat(1000);
      pkg.snippets.section = {
        entries: "{{entries}}".repeat(1000),
        list: "",
        labelled: "",
        paragraph: "",
      };
      pkg.snippets.entry = "{{bullets}}".repeat(1000);
      pkg.snippets.bullet = "";
      pkg.snippets.separators = { sections: "", entries: "", bullets: "" };
    });
    const started = performance.now();
    const error = thrown(() => generateBody(hollow, resume, {}));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(error).toBeInstanceOf(GenerateError);
    expect(error.message).toContain("MAX_BODY");
  });

  it("renders blocks nested deeper than a call stack goes", () => {
    const depth = 50_000;
    const deep = packageWith((pkg) => {
      pkg.snippets.bullet = `\\item ${"{{#text}}".repeat(depth)}{{text}}${"{{/text}}".repeat(depth)}`;
    });
    const { latex, texts } = generateBody(deep, resume, {});
    expect(latex).toContain(String.raw`\item \rtfield{galley_1.text}{A page editor}`);
    expect(texts.get("fennel-2.text")).toBe("Ran the release train");
  });
});

describe("formatName", () => {
  it("is the package id when no control is format-bound", () => {
    const unbound = packageWith((pkg) => {
      pkg.preamble = "\\documentclass[11pt]{article}";
      pkg.controls.fontSize = { default: 11, apply: "" };
    });
    expect(formatName(unbound, { fontSize: 12 })).toBe("plain");
  });

  it("changes with a format-bound value, and not with anything else", () => {
    const name = formatName(pkg, {});
    expect(name).toMatch(/^plain-[0-9a-f]{8}$/);
    expect(formatName(pkg, { fontSize: 11 })).toBe(name);
    expect(formatName(pkg, { margins: 0.5, accent: "#000000", dateFormat: "yyyy" })).toBe(name);
    const larger = formatName(pkg, { fontSize: 12 });
    expect(larger).toMatch(/^plain-[0-9a-f]{8}$/);
    expect(larger).not.toBe(name);
    expect(formatName(pkg, { fontSize: 10.5 })).not.toBe(larger);
  });

  it("fits the session's rule for a 64-character id, and tells apart ids that begin alike", () => {
    const long = (last: string) =>
      packageWith((pkg) => {
        pkg.id = `${"a".repeat(63)}${last}`;
      });
    const name = formatName(long("1"), {});
    expect(name).toHaveLength(64);
    expect(name.startsWith(`${"a".repeat(55)}-`)).toBe(true);
    expect(isFormatName(name)).toBe(true);
    expect(formatName(long("2"), {})).not.toBe(name);
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
 * The resume with every character the generator escapes or drops, in several contexts. `dollar`
 * says whether the specials keep their dollar sign, which LaTeX sets from TS1 (see its test), so
 * the page that is drawn is compiled without it.
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
  return special;
}

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
  "shape",
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
  let body: GeneratedBody;
  let compiled: CompileResult;
  let dollar: CompileResult;
  let drawn: DrawnPage;
  let items: PageItem[];
  beforeAll(async () => {
    const session = await startNodeSession();
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
    const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
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
    for (const field of drawn.fields.values()) {
      const text = body.texts.get(field.id) ?? "";
      expect(alignGlyphs(field, text), field.id).toBe(0);
      for (const glyph of field.glyphs) {
        if (glyph.inserted) {
          expect(glyph.text).toBe("-");
          continue;
        }
        if (glyph.text === undefined) continue;
        const spellings = SPELLINGS[glyph.text] ?? [glyph.text];
        expect(
          spellings.some((spelling) => text.startsWith(spelling, glyph.offset)),
          `${field.id} at ${glyph.offset}: glyph "${glyph.text}"`,
        ).toBe(true);
      }
    }
    expect(drawn.unmatched).toBe(0);
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
    // document, since OT1 italic has a pound sign where the dollar goes. The engine tree has no
    // Type 1 font for TS1, and `tfm.ts` refuses its TFMs, which are padded past the length their
    // header gives, so the page that is drawn goes without it; here it is found in the DVI.
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
    const [indent, length, ...more] = (bullet.get("shape") ?? "").split(/[,|]/);
    expect(more).toEqual([]);
    expect(Number.parseFloat(indent ?? "")).toBeGreaterThan(0);
    expect(Number.parseFloat(length ?? "")).toBeGreaterThan(0);
    // A paragraph outside any list has no shape.
    expect(paragraph("summary.text").get("parshape")).toBe("0");
    expect(paragraph("summary.text").get("shape")).toBe("");
  });

  it("links through hyperref with the addresses as they were typed, encoded", () => {
    const addresses = items.flatMap((item) => {
      if (item.kind !== "special" || !item.text.startsWith("pdf:bann")) return [];
      const uri = /\/URI\(((?:\\.|[^\\)])*)\)/.exec(item.text);
      return uri ? [uri[1]] : [];
    });
    expect(addresses).toContain("https://notes.example/a%20b?x=1&y=2#top_1");
    expect(addresses).toContain("mailto:ilse_m@example.com");
    expect(addresses).toContain("https://code.example/ilse");
  });
});
