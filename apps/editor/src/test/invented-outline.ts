/**
 * An invented resume as a `.tex` import's outline holds it (decision 0049), for the tests of typing
 * in an outline (the second pass's item 7): a heading kept whole, a section's title, a group of two
 * roles each with a group of bullets, a paragraph kept whole, and after a page break a second
 * section with one bullet, so that the page has fields on its first page and on its last. Every
 * word is invented.
 */

import { type OutlinePart, type OutlineUnit, Resume } from "@resume-tools/resume-model";
import type { Document } from "../editor/document";
import { OUTLINE_ID, outlinePackage } from "../import/outline";
import type { TemplatePackage } from "../templates/package";

/** The preamble an invented upload brings, which defines its one command. */
export const OUTLINE_PREAMBLE = [
  "\\documentclass[11pt]{article}",
  "\\usepackage[margin=0.8in]{geometry}",
  "\\pagestyle{empty}",
  "\\setlength{\\parindent}{0pt}",
  "\\newcommand{\\role}[2]{\\textbf{#1} \\hfill #2\\par}",
].join("\n");

const kept = (latex: string): OutlinePart => ({ kind: "kept", latex });
const plain = (id: string, text: string): OutlinePart => ({ kind: "text", id, text });
const rich = (id: string, text: string): OutlinePart => ({ kind: "rich", id, text: [{ text }] });
const unit = (id: string, gap: string, parts: OutlinePart[]): OutlineUnit => ({ id, gap, parts });

/** A role: its call, two fields, and its bullets, a group of their own. */
function role(id: string, gap: string, company: string, dates: string, bullets: string[]) {
  return unit(id, gap, [
    kept("\\role{"),
    plain(`${id}-company`, company),
    kept("}{"),
    plain(`${id}-dates`, dates),
    kept("}\n\\begin{itemize}\n  "),
    {
      kind: "group",
      id: `${id}-bullets`,
      units: bullets.map((text, b) =>
        unit(`${id}-${b + 1}`, "\n  ", [kept("\\item "), rich(`${id}-${b + 1}-text`, text)]),
      ),
    },
    kept("\n\\end{itemize}"),
  ]);
}

/** The outline's parts, `extra` kept text before `\end{document}`. */
export function outlineParts(extra = ""): OutlinePart[] {
  return [
    kept(
      "\\begin{document}\n\\begin{center}\n{\\LARGE\\bfseries Quill Wrenfield}\\\\\nHarbour City, Eastmere\n\\end{center}\n\n\\section*{",
    ),
    rich("work", "Experience"),
    kept("}\n"),
    {
      kind: "group",
      id: "roles",
      units: [
        role("lantern", "\n\n", "Lantern Works", "2021 -- 2024", [
          "Set careful type for forty journals",
          "Kept the press running through the winter",
        ]),
        role("mill", "\n\n", "Mill and Sons", "2019", ["Cut half of the waste in the shop"]),
      ],
    },
    kept(
      "\n\n\\section*{Hobbies}\nRowing on the river most weekends, and reading old atlases.\n\n\\newpage\n\\section*{",
    ),
    rich("projects", "Projects"),
    kept("}\n\\begin{itemize}\n  \\item "),
    rich("orrery", "Built a brass orrery that keeps time"),
    kept(`\n\\end{itemize}\n${extra}\\end{document}`),
  ];
}

/**
 * What a preamble adds whose fonts cannot set a Cyrillic letter: it sets Ж in a Cyrillic font
 * encoding the engine's tree does not have, so that the letter typed stops the compile.
 */
export const NO_CYRILLIC =
  "\\DeclareUnicodeCharacter{0416}{{\\fontencoding{T2A}\\selectfont\\CYRZH}}";

/** The invented outline's package and document, with `parts` for its outline. */
export async function inventedOutline(
  parts: OutlinePart[] = outlineParts(),
  preamble = OUTLINE_PREAMBLE,
): Promise<{ pkg: TemplatePackage; document: Document }> {
  const pkg = await outlinePackage({
    engine: "pdftex",
    preamble,
    files: {},
    reference: { log: "" },
  });
  const resume = Resume.parse({
    version: 1,
    header: { name: { first: "", last: "" }, links: [] },
    sections: [{ kind: "outline", id: OUTLINE_ID, title: "", role: "other", parts }],
  });
  return { pkg, document: { version: 1, template: pkg.id, resume, controls: {} } };
}
