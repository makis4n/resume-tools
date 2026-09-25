/**
 * An invented XeTeX template and resume, which the tests share: the harness passes it with no
 * findings, the page draws it, the overlay sets its fields, and its PDF is compared with a whole
 * compile's (decision 0014). It is set as a XeTeX port is (item 22): `fontenc` in OT1 before the
 * class, so that the format holds no native font; no fontspec; the text in Roboto, the headings in
 * Source Sans and one icon in the header from Font Awesome, each declared by file; and hyperref,
 * which takes its own XeTeX driver, since it refuses dvipdfmx under XeTeX, with no bookmarks, as
 * decision 0008 has every port. It is not curated: the curated XeTeX template is Awesome-CV's
 * port (item 22, decision 0015), and this one stays the tests' own, small and free to change.
 * Every name and word in it is invented.
 */

import { Resume } from "@resume-tools/resume-model";
import type { Curated } from "./curated";
import { parsePackage } from "./package";

export const INVENTED_XETEX: Curated = {
  package: parsePackage({
    version: 1,
    id: "invented-xetex",
    name: "Invented XeTeX template",
    engine: "xetex",
    source: {
      url: "https://example.com/invented-xetex",
      license: "MIT",
      attribution: "Invented for the editor's tests",
    },
    fonts: [
      {
        family: "Roboto",
        shapes: {
          "m/n": "Roboto-Regular.otf",
          "m/it": "Roboto-Italic.otf",
          "b/n": "Roboto-Bold.otf",
          "bx/n": "Roboto-Bold.otf",
          "b/it": "Roboto-BoldItalic.otf",
          "bx/it": "Roboto-BoldItalic.otf",
        },
        features: "mapping=tex-text",
      },
      {
        family: "SourceSans",
        shapes: { "b/n": "SourceSansPro-Bold.otf", "bx/n": "SourceSansPro-Bold.otf" },
        features: "mapping=tex-text",
      },
      { family: "FontAwesome", shapes: { "m/n": "FontAwesome5Free-Solid-900.otf" } },
    ],
    preamble: [
      "\\RequirePackage[OT1]{fontenc}",
      "\\documentclass[11pt]{article}",
      "\\usepackage[letterpaper,margin=0.8in]{geometry}",
      "\\usepackage{xcolor}",
      "\\usepackage[hidelinks,bookmarks=false]{hyperref}",
      "\\pagestyle{empty}",
      "\\setlength{\\parindent}{0pt}",
      "\\definecolor{rtaccent}{HTML}{1F4E79}",
      "\\renewcommand{\\encodingdefault}{TU}",
      "\\renewcommand{\\rmdefault}{Roboto}",
      "\\newcommand{\\heading}[1]{\\par\\medskip",
      "  {\\fontfamily{SourceSans}\\bfseries\\large\\color{rtaccent}#1}\\par\\smallskip}",
      '\\newcommand{\\mailicon}{{\\fontfamily{FontAwesome}\\fontseries{m}\\fontshape{n}\\selectfont\\symbol{"F0E0}}}',
    ].join("\n"),
    controls: {
      margins: { default: 0.8, apply: "\\geometry{margin={{value}}in}" },
      accent: { default: "#1F4E79", apply: "\\definecolor{rtaccent}{HTML}{{{value}}}" },
    },
    snippets: {
      document: "\\begin{document}\n{{header}}\n{{sections}}\n\\end{document}",
      header: [
        "{\\LARGE\\bfseries {{first}}{{#last}} {{last}}{{/last}}}\\par\\smallskip",
        "{{#headline}}{\\itshape {{headline}}}\\par{{/headline}}",
        "{{contacts}}\\par",
      ].join("\n"),
      contact: {
        phone: "{{text}}",
        email: "\\mailicon~\\href{{{&href}}}{{{text}}}",
        location: "{{text}}",
      },
      link: {
        other: "{{#href}}\\href{{{&href}}}{{{label}}}{{/href}}{{^href}}{{label}}{{/href}}",
      },
      section: {
        entries: "\\heading{{{title}}}\n{{entries}}",
        list: "\\heading{{{title}}}\n{{items}}",
        labelled: "\\heading{{{title}}}\n{{items}}",
        paragraph: "\\heading{{{title}}}\n{{text}}\\par",
      },
      entry: [
        "{\\bfseries {{title}}}{{#place}}, {{place}}{{/place}}\\hfill {{dates}}\\par",
        "{{#subtitle}}{\\itshape {{subtitle}}}\\par{{/subtitle}}",
        "{{#bullets}}",
        "\\begin{itemize}",
        "{{bullets}}",
        "\\end{itemize}",
        "{{/bullets}}",
      ].join("\n"),
      bullet: "\\item {{text}}",
      item: "{{text}}\\par",
      labelledItem: "{\\bfseries {{label}}:} {{text}}\\par",
      separators: { contacts: " \\textbullet{} " },
    },
  }),
  sample: Resume.parse({
    version: 1,
    header: {
      name: { first: "Petra", last: "Lindqvist" },
      headline: "Typesetting engineer",
      email: "petra@example.com",
      phone: "555-0142",
      links: [
        {
          id: "site",
          kind: "website",
          label: "lindqvist.example.com",
          href: "https://lindqvist.example.com",
        },
      ],
    },
    sections: [
      {
        id: "summary",
        kind: "paragraph",
        role: "summary",
        title: "Summary",
        text: [
          {
            text: "Engineer who builds document pipelines for small presses, from the first proof to the finished book.",
          },
        ],
      },
      {
        id: "work",
        kind: "entries",
        role: "experience",
        title: "Experience",
        entries: [
          {
            id: "harbor",
            title: "Harbor Lane Press",
            subtitle: "Senior engineer",
            place: "Bergen",
            dates: { start: "2021-03", end: "present" }, // formatted with an en dash
            bullets: [
              {
                id: "harbor-1",
                text: [
                  {
                    text: "Rebuilt the office's typesetting service -- the one every title goes through -- and cut a proof's turnaround from a day to forty minutes.",
                  },
                ],
              },
              {
                id: "harbor-2",
                text: [{ text: 'Wrote the style guide the "house rules" come from.' }],
              },
            ],
          },
          {
            id: "gull",
            title: "Gull Street Books",
            subtitle: "Engineer",
            place: "Trondheim",
            dates: { start: "2018-08", end: "2021-02" },
            bullets: [
              {
                id: "gull-1",
                text: [{ text: "Moved the backlist of 1,200 titles into one searchable archive." }],
              },
            ],
          },
        ],
      },
      {
        id: "skills",
        kind: "labelled",
        role: "skills",
        title: "Skills",
        items: [
          { id: "languages", label: "Languages", text: [{ text: "TypeScript, Rust, Python" }] },
          { id: "tools", label: "Tools", text: [{ text: "XeTeX, fontforge, HarfBuzz" }] },
        ],
      },
    ],
  }),
};
