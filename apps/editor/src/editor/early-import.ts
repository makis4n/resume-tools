/**
 * An imported resume open before its import's checks end (decision 0071): what the editor says
 * while it waits on them, and the document the person has as the outcome comes, given the marks the
 * checks found. The document opens on its page as soon as the outline sets it, its fields locked
 * (`locked`); its fields open once checks 1 and 2 have settled them (`fields`), while its groups
 * take no step until check 3 has tried them; and a partial import then waits for the person's
 * Continue, Stop or move, its report above the page (`deciding`). Nothing of it is kept until the
 * outcome is a success or the person continues.
 */

import type { OutlineFixed, OutlinePart } from "@resume-tools/resume-model";
import type { Document } from "./document";
import { outlineOf } from "./outline";

/** Where an import open before its checks end has got to (the module's comment). */
export type EarlyPhase = "locked" | "fields" | "deciding";

/** What the editor says above the page while its fields are locked. */
export const FIELDS_LOCKED =
  "This is your resume's page. Its fields open as soon as they have been checked.";

/** What it says once they are open and the checks of its entries still run. */
export const FIELDS_OPEN =
  "Its fields are open. Your changes reach the page, and entries can be added, removed and moved, once the checks end.";

/** Why a step on an entry is refused while the checks still run. */
export const UNITS_WAIT =
  "Entries can be added, removed and moved once the import's checks end, which try each kind.";

/**
 * The document the person has, `present`, with the marks the import's outcome gives `final`: each
 * group fixed, and why, as `final` has it, and each field required as it is there. Its fields' texts
 * stay the person's, since checks 1 and 2 settled every field before they could be typed in, and no
 * unit was added, removed or moved meanwhile, which the editor refuses until the outcome. `final`
 * itself where the two then agree, or where `present` holds no outline.
 */
export function withOutcomeMarks(present: Document, final: Document): Document {
  const outline = outlineOf(final.resume);
  if (present === final || outline === undefined || outlineOf(present.resume) === undefined)
    return final;
  const fixed = new Map<string, OutlineFixed>();
  const required = new Set<string>();
  const read = (parts: readonly OutlinePart[]) => {
    for (const part of parts)
      if (part.kind === "group") {
        if (part.fixed !== undefined) fixed.set(part.id, part.fixed);
        for (const unit of part.units) read(unit.parts);
      } else if ((part.kind === "text" || part.kind === "rich") && part.required === true)
        required.add(part.id);
  };
  read(outline.parts);
  const mark = (parts: readonly OutlinePart[]): OutlinePart[] =>
    parts.map((part): OutlinePart => {
      if (part.kind === "group") {
        const { fixed: _was, ...rest } = part;
        const why = fixed.get(part.id);
        return {
          ...rest,
          ...(why === undefined ? {} : { fixed: why }),
          units: part.units.map((unit) => ({ ...unit, parts: mark(unit.parts) })),
        };
      }
      if (part.kind === "text" || part.kind === "rich") {
        const { required: _was, ...rest } = part;
        return required.has(part.id) ? { ...rest, required: true } : rest;
      }
      return part;
    });
  const marked: Document = {
    ...present,
    resume: {
      ...present.resume,
      sections: present.resume.sections.map((section) =>
        section.kind === "outline" ? { ...section, parts: mark(section.parts) } : section,
      ),
    },
  };
  return JSON.stringify(marked) === JSON.stringify(final) ? final : marked;
}
