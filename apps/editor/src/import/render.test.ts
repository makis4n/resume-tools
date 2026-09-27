import type { Resume } from "@resume-tools/resume-model";
import { describe, expect, test } from "vitest";
import { generateBody } from "../templates/generate";
import { parsePackage, type TemplatePackage } from "../templates/package";
import type { ImportedResume } from "./imported";
import { kept, LOCKED_SHIM, renderImported } from "./render";

// Every package and resume here is invented for these tests.

const PACKAGE: TemplatePackage = parsePackage({
  version: 1,
  id: "import-000000000001",
  name: "Invented",
  engine: "pdftex",
  source: { url: "cv.tex", license: "", attribution: "" },
  files: {},
  preamble: "\\documentclass{article}\n",
  controls: {
    pageSize: { default: "letter", apply: { letter: "", a4: "\\geometry{a4paper}" } },
    dateFormat: { default: "MMM yyyy" },
  },
  snippets: {
    document: "{{header}}\n\\begin{document}\n{{sections}}\n\\end{document}",
    header: "\\cvname{{{first}}{{&x.c1-first}}}\\cvextra{{&x.n1}}",
    link: { other: "\\href{{{&href}}}{{{label}}}" },
    section: {
      entries:
        "{{&x.lead}}\\cvsection{{{title}}{{&x.title}}}{{&x.before}}{{#entries}}\\begin{cvlist}{{entries}}\\end{cvlist}{{/entries}}{{&x.entries}}{{&x.after}}",
      list: "{{&x.lead}}\\cvsection{{{title}}}{{#items}}\\begin{itemize}{{items}}\\end{itemize}{{/items}}",
      labelled: "\\cvsection{{{title}}}{{items}}",
      paragraph: "{{&x.lead}}\\cvsection{{{title}}}{{#text}}{{text}}\\par{{/text}}{{&x.text}}",
    },
    entry:
      "\\cventry{{{title}}{{&x.title}}}{{{dates}}{{&x.dates}}}{{#bullets}}\\begin{itemize}{{bullets}}\\end{itemize}{{/bullets}}{{&x.bullets}}",
    bullet: "\\item {{text}}",
    item: "\\item {{text}}",
    labelledItem: "\\item[{{label}}] {{text}}",
    separators: {
      sections: "",
      links: "\n",
      contacts: "\n",
      entries: "\n",
      bullets: "\n",
      items: "\n",
    },
  },
});

const RESUME: Resume = {
  version: 1,
  header: { name: { first: "Quill", last: "" }, links: [] },
  sections: [
    {
      kind: "entries",
      id: "sec-a",
      title: "Invented work",
      role: "experience",
      entries: [
        {
          id: "ent-a",
          title: "Invented role",
          dates: { start: "2020-01", end: "present" },
          bullets: [{ id: "bul-a", text: [{ text: "Invented " }, { text: "bold", bold: true }] }],
        },
        { id: "ent-b", title: "Second role", bullets: [] },
      ],
    },
    { kind: "paragraph", id: "sec-b", title: "Invented summary", role: "summary", text: [] },
  ],
};

describe("the composed body", () => {
  test("is the generator's own for a resume with no extras and no locked section", () => {
    // The generator of this branch reads an extras slot as text: without the slots, it sets what
    // the composition sets for a resume that has no extras.
    const bare = JSON.parse(
      JSON.stringify(PACKAGE).replace(/\{\{&x\.[a-z0-9-]+\}\}/g, ""),
    ) as TemplatePackage;
    const composed = renderImported(PACKAGE, RESUME, {});
    const generated = generateBody(bare, RESUME, {});
    expect(composed.latex).toBe(generated.latex);
    expect([...composed.texts]).toEqual([...generated.texts]);
  });

  test("writes each node's extras where its snippet names them, and nothing where it has none", () => {
    const resume: ImportedResume = structuredClone(RESUME);
    resume.header.extras = { "c1-first": "", n1: "{Invented kept}" };
    const [work, summary] = resume.sections;
    if (work?.kind !== "entries" || summary?.kind !== "paragraph") throw new Error("the fixture");
    work.extras = { lead: "\n\n", before: "\n\\vspace{2pt}\n" };
    const [first, second] = work.entries;
    if (first === undefined || second === undefined) throw new Error("the fixture");
    first.title = "";
    first.extras = { title: "\\textsc{Invented}" };
    second.extras = { bullets: "\\begin{itemize}\\item kept\\end{itemize}" };
    summary.extras = { text: "Invented \\emph{kept} words" };
    const { latex, texts } = renderImported(PACKAGE, resume, {});
    expect(latex).toContain("\\cvname{\\rtfield{header.first}{Quill}}\\cvextra{Invented kept}");
    expect(latex).toContain("\\cvsection{\\rtfield{sec-a.title}{Invented work}}\n\\vspace{2pt}\n");
    expect(latex).toContain("\\cventry{\\textsc{Invented}}");
    expect(latex).toContain(
      "\\cventry{\\rtfield{ent-b.title}{Second role}}{}\\begin{itemize}\\item kept",
    );
    expect(latex).toContain("Invented \\emph{kept} words");
    // The lead goes before the section, and the first section has none.
    expect(latex).toContain("\\begin{document}\n\n\n\\cvsection{\\rtfield{sec-a.title}");
    expect(texts.has("ent-a.title")).toBe(false);
    expect(texts.get("ent-a.dates")).toBe("Jan 2020 – Present");
    expect(texts.get("bul-a.text")).toBe("Invented bold");
    expect(latex).not.toContain("{{&x.");
  });

  test("writes a locked section in `\\rtlocked`, with a line's end, and the shim that defines it", () => {
    const resume: ImportedResume = {
      ...RESUME,
      sections: [
        { kind: "locked", id: "lock-a", title: "", role: "other", latex: "\\vspace{3pt}%" },
        ...RESUME.sections,
      ],
    };
    const { latex, texts } = renderImported(PACKAGE, resume, {});
    expect(latex.startsWith(LOCKED_SHIM)).toBe(true);
    expect(latex).toContain("\\begin{document}\n\\rtlocked{lock-a}{\\vspace{3pt}%\n}\\cvsection{");
    expect(texts.has("sec-a.title")).toBe(true);
  });

  test("applies the controls once, before the document, as the generator does", () => {
    const { latex } = renderImported(PACKAGE, RESUME, { pageSize: "a4" });
    expect(latex.startsWith("\\geometry{a4paper}\n{{header}}")).toBe(false);
    expect(latex.startsWith("\\geometry{a4paper}\n\\cvname")).toBe(true);
    expect(latex.match(/\\geometry/g)?.length).toBe(1);
  });
});

describe("kept LaTeX", () => {
  test("gets a line's end after it when its last line holds a comment, as part A's generator writes it", () => {
    expect(kept("a % note")).toBe("a % note\n");
    expect(kept("a\\% b")).toBe("a\\% b");
    expect(kept("% note\nb")).toBe("% note\nb");
  });
});
