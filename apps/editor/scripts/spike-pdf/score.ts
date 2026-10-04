/**
 * The PDF spike's measure of a reading (item 3): "fields right", defined once, against the truth,
 * the resume a PDF was made from. The fields are the name, the email, the phone and each link; each
 * section's title and role; each entry's title, place and dates; and each bullet's exact text. A
 * field counts when the truth has it. Texts compare as two readings of one page do (`normalise`):
 * the dashes and quotes TeX makes of what was typed are what was typed. Names, titles and places
 * compare without case, since a template may set them in capitals; a bullet's text compares with it.
 */

import type { Dates, Entry, Resume } from "@resume-tools/resume-model";
import { normalise } from "./text.ts";

export const FIELD_KINDS = [
  "name",
  "email",
  "phone",
  "link",
  "section title",
  "section role",
  "entry title",
  "entry place",
  "entry dates",
  "bullet",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** One field of the truth, and whether the reading has it right. */
export interface FieldResult {
  kind: FieldKind;
  right: boolean;
  truth: string;
  read?: string;
}

export interface Tally {
  total: number;
  right: number;
}

export interface Score {
  fields: FieldResult[];
  all: Tally;
  byKind: Record<FieldKind, Tally>;
  /** Entries whose title, place and dates are all right, each where the truth has it. */
  entries: Tally;
  /** The same, a title and a subtitle swapped counted right, as a template may set them. */
  entriesSwapped: Tally;
  /** Whether the name, email, phone and every link are right. */
  headerExact: boolean;
  /** Whether every section's title and role are right. */
  sectionsExact: boolean;
  /** Whether every bullet is right. */
  bulletsExact: boolean;
}

const caseless = (text: string | undefined) => normalise(text ?? "").toLowerCase();
const exact = (text: string | undefined) => normalise(text ?? "");
const digits = (text: string | undefined) => (text ?? "").replace(/\D/g, "");

/** An address as two readings compare it: no scheme's case, no `www.`, no closing slash. */
export const address = (href: string | undefined) =>
  (href ?? "")
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();

const datesText = (dates: Dates | undefined) =>
  dates === undefined ? "" : `${dates.start}${dates.end === undefined ? "" : ` – ${dates.end}`}`;

const sameDates = (a: Dates | undefined, b: Dates | undefined) =>
  a !== undefined && b !== undefined && a.start === b.start && a.end === b.end;

const richText = (runs: readonly { text: string }[]) => runs.map((run) => run.text).join("");

/** Every entry of a resume, with the section it is in. */
function entriesOf(resume: Resume): Entry[] {
  return resume.sections.flatMap((section) => (section.kind === "entries" ? section.entries : []));
}

/** How alike two entries are, to pair the truth's with the reading's. */
function likeness(truth: Entry, read: Entry): number {
  let score = 0;
  const [tt, ts, rt, rs] = [truth.title, truth.subtitle, read.title, read.subtitle].map(caseless);
  if (tt !== "" && tt === rt) score += 3;
  if (ts !== "" && ts === rs) score += 2;
  if (tt !== "" && (tt === rs || (ts !== "" && ts === rt))) score += 2;
  if (sameDates(truth.dates, read.dates)) score += 1;
  if (truth.place !== undefined && caseless(truth.place) === caseless(read.place)) score += 1;
  const words = (entry: Entry) =>
    new Set(
      entry.bullets.flatMap((bullet) => caseless(richText(bullet.text)).split(" ")).filter(Boolean),
    );
  const a = words(truth);
  const b = words(read);
  if (a.size > 0 && b.size > 0) {
    const shared = [...a].filter((word) => b.has(word)).length;
    score += (2 * shared) / (a.size + b.size);
  }
  // Words of the head anywhere in the other's head.
  const head = (entry: Entry) =>
    new Set(caseless(`${entry.title} ${entry.subtitle ?? ""}`).split(" "));
  const ha = head(truth);
  const hb = head(read);
  const sharedHead = [...ha].filter((word) => word !== "" && hb.has(word)).length;
  score += sharedHead / Math.max(1, ha.size);
  return score;
}

/** The truth's entries paired with the reading's, the most alike pairs first, each once. */
function pairEntries(truth: readonly Entry[], read: readonly Entry[]): Map<Entry, Entry> {
  const pairs: { t: Entry; r: Entry; score: number }[] = [];
  for (const t of truth) for (const r of read) pairs.push({ t, r, score: likeness(t, r) });
  pairs.sort((a, b) => b.score - a.score);
  const paired = new Map<Entry, Entry>();
  const used = new Set<Entry>();
  for (const { t, r, score } of pairs) {
    if (score < 1 || paired.has(t) || used.has(r)) continue;
    paired.set(t, r);
    used.add(r);
  }
  return paired;
}

/** Score a reading against its truth, field by field. */
export function scoreResume(truth: Resume, read: Resume): Score {
  const fields: FieldResult[] = [];
  const add = (kind: FieldKind, right: boolean, truthText: string, readText?: string) =>
    fields.push({
      kind,
      right,
      truth: truthText,
      ...(readText === undefined ? {} : { read: readText }),
    });

  // The header.
  const name = `${truth.header.name.first} ${truth.header.name.last}`.trim();
  const readName = `${read.header.name.first} ${read.header.name.last}`.trim();
  if (name !== "") add("name", caseless(name) === caseless(readName), name, readName);
  if (truth.header.email !== undefined)
    add(
      "email",
      caseless(truth.header.email) === caseless(read.header.email),
      truth.header.email,
      read.header.email,
    );
  if (truth.header.phone !== undefined)
    add(
      "phone",
      digits(truth.header.phone) !== "" && digits(truth.header.phone) === digits(read.header.phone),
      truth.header.phone,
      read.header.phone,
    );
  const readLinks = [...read.header.links];
  for (const link of truth.header.links) {
    const found = readLinks.findIndex(
      (each) =>
        address(each.href) === address(link.href) && caseless(each.label) === caseless(link.label),
    );
    const right = found >= 0;
    if (right) readLinks.splice(found, 1);
    add("link", right, `${link.label} <${link.href}>`);
  }

  // The sections, paired by title.
  const unpaired = [...read.sections];
  for (const section of truth.sections) {
    if (section.kind === "locked") continue;
    const found = unpaired.findIndex((each) => caseless(each.title) === caseless(section.title));
    const match = found >= 0 ? unpaired.splice(found, 1)[0] : undefined;
    add("section title", match !== undefined, section.title);
    add(
      "section role",
      match !== undefined && match.role === section.role,
      section.role,
      match?.role,
    );
  }

  // The entries, paired across the whole resume, and their bullets.
  const truthEntries = entriesOf(truth);
  const pairs = pairEntries(truthEntries, entriesOf(read));
  const entries: Tally = { total: 0, right: 0 };
  const entriesSwapped: Tally = { total: 0, right: 0 };
  for (const entry of truthEntries) {
    const match = pairs.get(entry);
    const titleRight = match !== undefined && caseless(match.title) === caseless(entry.title);
    const swapped =
      match !== undefined &&
      caseless(match.title) === caseless(entry.subtitle) &&
      caseless(match.subtitle) === caseless(entry.title);
    add("entry title", titleRight, entry.title, match?.title);
    let placeRight = true;
    if (entry.place !== undefined) {
      placeRight = match !== undefined && caseless(match.place) === caseless(entry.place);
      add("entry place", placeRight, entry.place, match?.place);
    }
    let datesRight = true;
    if (entry.dates !== undefined) {
      datesRight = match !== undefined && sameDates(match.dates, entry.dates);
      add("entry dates", datesRight, datesText(entry.dates), datesText(match?.dates));
    }
    entries.total++;
    entriesSwapped.total++;
    if (titleRight && placeRight && datesRight) entries.right++;
    if ((titleRight || swapped) && placeRight && datesRight) entriesSwapped.right++;
    const readBullets = (match?.bullets ?? []).map((bullet) => exact(richText(bullet.text)));
    for (const bullet of entry.bullets) {
      const text = richText(bullet.text);
      const found = readBullets.indexOf(exact(text));
      if (found >= 0) readBullets.splice(found, 1);
      add("bullet", found >= 0, text);
    }
  }

  const byKind = Object.fromEntries(
    FIELD_KINDS.map((kind) => {
      const of = fields.filter((field) => field.kind === kind);
      return [kind, { total: of.length, right: of.filter((field) => field.right).length }];
    }),
  ) as Record<FieldKind, Tally>;
  const allRight = (kinds: readonly FieldKind[]) =>
    fields.filter((field) => kinds.includes(field.kind)).every((field) => field.right);
  return {
    fields,
    all: { total: fields.length, right: fields.filter((field) => field.right).length },
    byKind,
    entries,
    entriesSwapped,
    headerExact: allRight(["name", "email", "phone", "link"]),
    sectionsExact: allRight(["section title", "section role"]),
    bulletsExact: allRight(["bullet"]),
  };
}
