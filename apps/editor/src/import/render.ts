/**
 * The body of an imported document, composed from the generator's own renders (milestone 3 item 7,
 * decision 0026), until the generator renders locked sections and raw extras slots itself.
 *
 * TODO(merge): part A of item 7 teaches `generateBody` the `locked` section kind and the
 * `{{&x.<key>}}` slot on sections and entries. Once it has, `renderImported` is `generateBody` and
 * this module goes: the checks call the generator directly, and the harness's session loses the
 * substitution `validate.ts` makes through it.
 *
 * Until then, the generator as it is reads `{{&x.<key>}}` as text and passes it through, so the
 * body is composed from renders of each part: the header alone, each section alone, and each entry
 * alone inside a section that sets only its entries, every `{{&x.<key>}}` in a part's render
 * replaced by the extra of the node the part is; then each section's own render with its entries
 * standing in as numbered marks, and the document's with its header and sections standing in, the
 * marks replaced by the parts' renders. A locked section's render is its LaTeX. Each part renders
 * through the package's own snippets, separators, date format and escaping, so the composed body is
 * the one the generator will make, and a field's text is the one it will mark.
 */

import type { Entry, Header, Section } from "@resume-tools/resume-model";
import { type BodyOptions, type GeneratedBody, generateBody } from "../templates/generate";
import type { ControlValues, TemplatePackage } from "../templates/package";
import { EXTRAS_SLOT, extraOf, type ImportedResume, isLocked } from "./imported";

/** The character the composition marks where a part goes, which escaped text never holds. */
const MARK = "\u0001";

/** A header with nothing in it, which renders nothing through any header snippet's fields. */
const EMPTY_HEADER: Header = { name: { first: "", last: "" }, links: [] };

/** What the parts of a composition gather: their fields' texts and what their escaping dropped. */
interface Gathered {
  texts: Map<string, string>;
  dropped: Set<string>;
  surplus: Set<string>;
}

/** A part's render, and what it marks, kept until the composition shows the part is used. */
interface Part {
  latex: string;
  body: GeneratedBody;
  more: Part[];
}

/** The generator's render of a document with no controls but the date format, its newline off. */
function renderPart(
  pkg: TemplatePackage,
  snippets: Partial<TemplatePackage["snippets"]>,
  resume: { header: Header; sections: Section[] },
  values: ControlValues,
  options: BodyOptions,
): GeneratedBody {
  const part: TemplatePackage = {
    ...pkg,
    controls: {},
    snippets: { ...pkg.snippets, ...snippets },
  };
  const body = generateBody(part, { version: 1, ...resume }, values, options);
  return { ...body, latex: body.latex.endsWith("\n") ? body.latex.slice(0, -1) : body.latex };
}

/** A render's extras slots, each replaced by the extra of the node the render is, as `kept` writes it. */
const withExtras = (latex: string, node: { extras?: Record<string, unknown> }) =>
  latex.replace(EXTRAS_SLOT, (_, key: string) => kept(extraOf(node, key)));

/**
 * Kept LaTeX as part A's generator writes an extra: as it is, with a line's end after it when its
 * last line holds a comment, which the comment then takes, so that the snippet's text after the slot
 * is read (decision 0025).
 */
export function kept(latex: string): string {
  const last = latex.slice(Math.max(latex.lastIndexOf("\n"), latex.lastIndexOf("\r")) + 1);
  for (let at = 0; at < last.length; at++) {
    if (last[at] === "\\") at++;
    else if (last[at] === "%") return `${latex}\n`;
  }
  return latex;
}

/**
 * What the body defines until part A's prelude does (TODO(merge)): `\rtlocked`, which part A's
 * prelude defines to write a lock marker either side of a locked section's LaTeX, here without the
 * markers, which the comparison of glyph streams leaves out anyway (decision 0019), so that a part
 * is read as an argument, as it will be.
 */
export const LOCKED_SHIM = "\\providecommand{\\rtlocked}[2]{#2}\n";

/**
 * The body `generateBody` will make of an imported document once it renders locked sections and
 * extras slots (TODO(merge)): controls, then the document snippet, with the header, the sections and
 * their entries composed from their own renders.
 */
export function renderImported(
  pkg: TemplatePackage,
  resume: ImportedResume,
  values: ControlValues = {},
  options: BodyOptions = {},
): GeneratedBody {
  const dateFormat = values.dateFormat ?? pkg.controls.dateFormat?.default ?? "MMM yyyy";
  const chosen: ControlValues = { ...values, dateFormat };
  const only = { document: "{{sections}}" };

  const header = renderPart(
    pkg,
    { document: "{{header}}" },
    { header: resume.header, sections: [] },
    chosen,
    options,
  );
  const headerPart: Part = {
    latex: withExtras(header.latex, resume.header),
    body: header,
    more: [],
  };

  const sectionParts = resume.sections.map((section): Part => {
    if (isLocked(section))
      return {
        latex: `\\rtlocked{${section.id}}{${section.latex}\n}`,
        body: { latex: "", texts: new Map(), dropped: [], surplus: [] },
        more: [],
      };
    if (section.kind !== "entries") {
      const body = renderPart(
        pkg,
        only,
        { header: EMPTY_HEADER, sections: [section] },
        chosen,
        options,
      );
      return { latex: withExtras(body.latex, section), body, more: [] };
    }
    const entries = section.entries.map((entry): Part => {
      const body = renderPart(
        pkg,
        {
          ...only,
          section: { entries: "{{entries}}", list: "", labelled: "", paragraph: "" },
        },
        { header: EMPTY_HEADER, sections: [{ ...section, title: "", entries: [entry] }] },
        chosen,
        options,
      );
      return { latex: withExtras(body.latex, entry), body, more: [] };
    });
    const frame = renderPart(
      pkg,
      { ...only, entry: `${MARK}E{{&title}}${MARK}` },
      {
        header: EMPTY_HEADER,
        sections: [
          {
            ...section,
            entries: section.entries.map(
              (entry, at): Entry => ({ id: entry.id, title: String(at), bullets: [] }),
            ),
          },
        ],
      },
      chosen,
      options,
    );
    const used: Part[] = [];
    const latex = withExtras(frame.latex, section).replace(
      new RegExp(`${MARK}E(\\d+)${MARK}`, "g"),
      (_, at: string) => {
        const entry = entries[Number(at)];
        if (entry === undefined) return "";
        used.push(entry);
        return entry.latex;
      },
    );
    return { latex, body: frame, more: used };
  });

  const placeholder = `${MARK}S{{&title}}${MARK}`;
  const document = generateBody(
    {
      ...pkg,
      snippets: {
        ...pkg.snippets,
        header: `${MARK}H${MARK}`,
        section: {
          entries: placeholder,
          list: placeholder,
          labelled: placeholder,
          paragraph: placeholder,
        },
      },
    },
    {
      version: 1,
      header: EMPTY_HEADER,
      sections: resume.sections.map(
        (section, at): Section => ({
          kind: "paragraph",
          id: section.id,
          title: String(at),
          role: "other",
          text: [],
        }),
      ),
    },
    chosen,
    options,
  );
  const gathered: Gathered = { texts: new Map(), dropped: new Set(), surplus: new Set() };
  const gather = (part: Part) => {
    for (const [id, text] of part.body.texts) gathered.texts.set(id, text);
    for (const each of part.body.dropped) gathered.dropped.add(each);
    for (const each of part.body.surplus) gathered.surplus.add(each);
    for (const each of part.more) gather(each);
  };
  gather({ latex: "", body: document, more: [] });
  const latex = document.latex.replace(
    new RegExp(`${MARK}([HS])(\\d*)${MARK}`, "g"),
    (_, what: string, at: string) => {
      const part = what === "H" ? headerPart : sectionParts[Number(at)];
      if (part === undefined) return "";
      gather(part);
      return part.latex;
    },
  );
  const locks = resume.sections.some(isLocked);
  return {
    latex: locks ? `${LOCKED_SHIM}${latex}` : latex,
    texts: gathered.texts,
    dropped: [...gathered.dropped],
    surplus: [...gathered.surplus],
  };
}
