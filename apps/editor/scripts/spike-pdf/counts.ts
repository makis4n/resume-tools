/**
 * What the PDF spike keeps of a corpus document (item 3, its second set): counts only, by the
 * document's id, never a line, a word or a field of it. `countsOf` makes them from a reading; the
 * corpus pool writes them, one file a document, under `.corpus/spike-pdf/`.
 */

import { SECTION_ROLES, type SectionRole } from "@resume-tools/resume-model";
import { type Filed, UNFILED_ID } from "./file.ts";
import type { Layout } from "./layout.ts";
import { ROLES, type Role } from "./roles.ts";

/** What became of a document: read, or why not, and how much of it. Counts only. */
export interface CorpusCounts {
  /**
   * `read`; or the reference compile's refusal reason; `no-pdf` when xdvipdfmx made none; the
   * reader's refusal; `failed`, `timeout` or `crashed`.
   */
  outcome: string;
  /** For `failed`, the kind of error, its class's name alone. */
  failure?: string;
  /** For `no-pdf`, why xdvipdfmx made none, by its kind (`pdfErrorKind`). */
  pdfError?: string;
  engine?: string;
  compileMs?: number;
  pdfBytes?: number;
  readMs?: number;
  rulesMs?: number;
  pages?: number;
  /** The most columns found side by side on a page, and the pages with more than one. */
  columns?: number;
  multiColumnPages?: number;
  lines?: number;
  roles?: Record<Role, number>;
  /** The sections the filing made, the catch-all not among them, and by their role. */
  sections?: number;
  sectionRoles?: Record<SectionRole, number>;
  entries?: number;
  bullets?: number;
  /**
   * Words read; those the resume holds; those in the catch-all; and those in a recognised place;
   * and the letters and digits read, held and in the catch-all, by which nothing read is dropped.
   */
  words?: {
    read: number;
    landed: number;
    unfiled: number;
    recognised: number;
    chars?: { read: number; landed: number; unfiled: number };
  };
  icons?: number;
  hyphenJoins?: number;
  flags?: { dateAsText: number; unfiled: number };
  /** Whether the header found a name, an email and a phone, and how many links. */
  header?: { name: boolean; email: boolean; phone: boolean; links: number };
}

/**
 * Why xdvipdfmx made no PDF, by its kind, from the session's error, which may name a font or a
 * file and is never kept: a special it refuses to run, by the special's command; a font it has no
 * outline for, or cannot find; its abort; or another failure.
 */
export function pdfErrorKind(error: string | undefined): string {
  if (error === undefined) return "no reason given";
  const special = /reads a file or reconfigures xdvipdfmx: (\S+(?: [A-Za-z]+)?)/.exec(error)?.[1];
  if (special !== undefined)
    return /^[A-Za-z:]+=?(?: [A-Za-z]+)?$/.test(special) ? `a special, ${special}` : "a special";
  if (/without \.vf or "physical" font/i.test(error)) return "a font with no outline";
  if (/could not (?:locate|find)[^\n]*font|font[^\n]*not found/i.test(error))
    return "a font it cannot find";
  if (/has no output/.test(error)) return "no output";
  if (/aborted/.test(error)) return "xdvipdfmx aborted";
  if (/exited with/.test(error)) return "xdvipdfmx failed";
  return "another reason";
}

/** A reading's counts. */
export function countsOf(layout: Layout, roles: readonly Role[], filed: Filed): CorpusCounts {
  const roleCounts = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<Role, number>;
  for (const role of roles) roleCounts[role]++;
  const sections = filed.resume.sections.filter((section) => section.id !== UNFILED_ID);
  const sectionRoles = Object.fromEntries(SECTION_ROLES.map((role) => [role, 0])) as Record<
    SectionRole,
    number
  >;
  for (const section of sections) sectionRoles[section.role]++;
  const entries = sections.flatMap((section) =>
    section.kind === "entries" ? section.entries : [],
  );
  const { header } = filed.resume;
  return {
    outcome: "read",
    pages: layout.pages.length,
    columns: Math.max(1, ...layout.pages.map((page) => page.columns)),
    multiColumnPages: layout.pages.filter((page) => page.columns > 1).length,
    lines: layout.lines.length,
    roles: roleCounts,
    sections: sections.length,
    sectionRoles,
    entries: entries.length,
    bullets: entries.reduce((sum, entry) => sum + entry.bullets.length, 0),
    words: {
      read: filed.words.read,
      landed: filed.words.landed,
      unfiled: filed.words.unfiled,
      recognised: filed.words.landed - filed.words.unfiled,
      chars: filed.words.chars,
    },
    icons: layout.icons,
    hyphenJoins: layout.hyphenJoins,
    flags: {
      dateAsText: filed.flags.filter((flag) => flag.kind === "date-as-text").length,
      unfiled: filed.flags.filter((flag) => flag.kind === "unfiled").length,
    },
    header: {
      name: `${header.name.first}${header.name.last}`.trim() !== "",
      email: header.email !== undefined,
      phone: header.phone !== undefined,
      links: header.links.length,
    },
  };
}
