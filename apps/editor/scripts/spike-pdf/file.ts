/**
 * The PDF spike's filing step (item 3, a first cut of item 12's second step): the labelled lines
 * filed into the resume model the built-in templates use. The header takes the name and the
 * contacts, with links' addresses from the PDF's own links; each heading starts a section, with the
 * role its words give it; entries take their title, place, dates and bullets; and lists, labelled
 * lists and paragraphs take the rest. A date the model cannot hold stays as text in its entry and
 * is flagged. What fits nowhere goes to a last section and is flagged, so nothing is dropped: the
 * words read are counted against the words the resume holds.
 */

import {
  type Bullet,
  type Dates,
  type Entry,
  type Header,
  type Link,
  type LinkKind,
  Resume,
  type Section,
  type SectionRole,
} from "@resume-tools/resume-model";
import { joinParts, type Layout, type Line, type Part } from "./layout.ts";
import { LABEL, type Role, trailingDate } from "./roles.ts";
import {
  countChars,
  countWords,
  emailIn,
  hasEmail,
  headingRole,
  isEmail,
  isPhone,
  isPlace,
  isUrl,
  looksLikeDate,
  parseDates,
  phoneIn,
} from "./text.ts";

/** Why a line was flagged: a date kept as text, or a line filed in the last section. */
export type FlagKind = "date-as-text" | "unfiled";

export interface Flag {
  kind: FlagKind;
  line: number;
}

/**
 * The words read, those the resume holds, and those it holds in its last, catch-all section; and
 * the same of the letters and digits, which no cutting of a line into fields can count twice, as
 * `a|b`, one word read, is two words filed. Nothing read is dropped when as many letters and
 * digits land as were read.
 */
export interface WordCount {
  read: number;
  landed: number;
  unfiled: number;
  chars: { read: number; landed: number; unfiled: number };
}

export interface Filed {
  resume: Resume;
  flags: Flag[];
  words: WordCount;
}

/** The sections whose entries have places: jobs and schools, and the sections no word names. */
const PLACED = new Set<SectionRole>(["experience", "education", "other"]);

/** The title of the last section, which holds what fits nowhere else. */
export const UNFILED_TITLE = "Unsorted";
export const UNFILED_ID = "unsorted";

/** What a link's address says it is. */
export function linkKind(href: string): LinkKind {
  const host = href.toLowerCase();
  if (/linkedin\.com/.test(host)) return "linkedin";
  if (/github\.com/.test(host)) return "github";
  if (/(?:^|[/.])(?:twitter|x)\.com/.test(host)) return "twitter";
  if (/orcid\.org/.test(host)) return "orcid";
  if (/^https?:\/\//.test(host) || isUrl(host)) return "website";
  return "other";
}

/** The separators contacts are set apart with on one line. */
const CONTACT_SEPARATORS = /\s*(?:[|•·⋅◦∙⋄◆♦]|\s[–—]\s|\s\/\s)\s*/u;

/** The labels a contact may stand behind, which are no contact's text. */
const CONTACT_LABEL =
  /^(?:e-?mail|phone|tel(?:ephone)?|mobile|mob|cell|address|web(?:site)?|site|linkedin|github|portfolio|homepage)\s*[:.]\s*/iu;

/** A line's text cut where its parts are, with each part's box, so a stretch's box can be found. */
interface Span {
  start: number;
  end: number;
  x0: number;
  x1: number;
}

/** Where each of a one-row line's parts stands in its text, as `joinParts` joined them. */
function spansOf(line: Line): Span[] | undefined {
  if (line.rows !== 1) return undefined;
  const spans: Span[] = [];
  let from = 0;
  for (const part of line.parts) {
    const at = line.text.indexOf(part.text, from);
    if (at < 0) return undefined;
    spans.push({ start: at, end: at + part.text.length, x0: part.x0, x1: part.x1 });
    from = at + part.text.length;
  }
  return spans;
}

/** The horizontal stretch of a line a stretch of its text covers, a character's share a character. */
function stretchOf(spans: readonly Span[], start: number, end: number): [number, number] {
  const xAt = (offset: number) => {
    const span =
      spans.find((each) => offset >= each.start && offset <= each.end) ??
      spans.find((each) => each.start >= offset) ??
      spans.at(-1);
    if (span === undefined) return 0;
    const share = span.end === span.start ? 0 : (offset - span.start) / (span.end - span.start);
    return span.x0 + Math.max(0, Math.min(1, share)) * (span.x1 - span.x0);
  };
  return [xAt(start), xAt(end)];
}

/** A contact line's items, each with the address of the link over most of it, if any. */
function contactItems(line: Line, layout: Layout): { text: string; href?: string }[] {
  const spans = spansOf(line);
  const links = layout.links.filter(
    (link) =>
      link.page === line.page &&
      link.x0 < line.x1 &&
      link.x1 > line.x0 &&
      link.y0 < line.bottom + 1 &&
      link.y1 > line.top - 1,
  );
  const items: { text: string; href?: string }[] = [];
  const pattern = new RegExp(CONTACT_SEPARATORS.source, "gu");
  let from = 0;
  const cuts: [number, number][] = [];
  for (const match of line.text.matchAll(pattern)) {
    cuts.push([from, match.index]);
    from = match.index + match[0].length;
  }
  cuts.push([from, line.text.length]);
  for (const [start, end] of cuts) {
    const text = line.text.slice(start, end).trim();
    if (text === "") continue;
    let href: string | undefined;
    if (spans !== undefined) {
      const [x0, x1] = stretchOf(spans, start, end);
      const width = Math.max(1, x1 - x0);
      href = links.find(
        (link) => Math.min(link.x1, x1) - Math.max(link.x0, x0) >= 0.5 * width,
      )?.url;
    } else if (links.length === 1) href = links[0]?.url;
    items.push(href === undefined ? { text } : { text, href });
  }
  return items;
}

/** A link's address as the model keeps it: `mailto:` and `tel:` are no links. */
const webAddress = (href: string | undefined) =>
  href === undefined || /^(?:mailto|tel):/i.test(href) ? undefined : href;

/** Parts of a line in its leading style: the bold ones it starts with, and the rest. */
function leadingBold(parts: readonly Part[]): { bold: string; rest: string } | undefined {
  const first = parts.findIndex((part) => !part.bold);
  if (first <= 0 || first === parts.length) return undefined;
  const bold = joinParts(parts.slice(0, first)).trim();
  const rest = joinParts(parts.slice(first))
    .replace(/^[\s,|:–—·•-]+/u, "")
    .trim();
  if (bold === "" || rest === "" || countWords(bold) === 0) return undefined;
  return { bold, rest };
}

/** The separators a title and its company are set apart with on one line. */
const HEAD_SEPARATOR = /\s+[—–|·•@]\s+/u;

/**
 * A head line cut in two where it holds both a title and what it is at: `Charge Nurse — Westfold
 * General Hospital`, `Operations Manager, Kettleby Foods`, at a spaced dash, bar or dot, or else at
 * a comma before a capital.
 */
export function splitHead(text: string): { title: string; subtitle: string } | undefined {
  const separator = HEAD_SEPARATOR.exec(text);
  if (separator) {
    const title = text.slice(0, separator.index).trim();
    const subtitle = text.slice(separator.index + separator[0].length).trim();
    if (countWords(title) > 0 && countWords(subtitle) > 0) return { title, subtitle };
  }
  const comma = /,\s+(?=\p{Lu})/u.exec(text);
  if (comma) {
    const title = text.slice(0, comma.index).trim();
    const subtitle = text.slice(comma.index + comma[0].length).trim();
    if (countWords(title) > 0 && countWords(subtitle) > 0) return { title, subtitle };
  }
  return undefined;
}

/** A word that is one capitalised word, or two: a town standing alone, `Bergen`. */
const TOWN = /^\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?$/u;

/**
 * A head line's place at its end, cut off: after a spaced separator, `Studio · Lisbon, Portugal`;
 * or its last two comma's parts where they name a place, `Institute, Galway, Ireland`; or its last
 * part where that is a town's name, `Upper School, Bergen`.
 */
export function trailingPlace(text: string): { rest: string; place: string } | undefined {
  const parts = text.split(/\s+[—–|·•]\s+/u);
  if (parts.length > 1) {
    const place = parts.at(-1)?.trim() ?? "";
    if (isPlace(place) || TOWN.test(place))
      return { rest: parts.slice(0, -1).join(" · ").trim(), place };
  }
  const commas = text.split(/,\s*/u);
  if (commas.length >= 3) {
    const place = commas.slice(-2).join(", ");
    if (isPlace(place)) return { rest: commas.slice(0, -2).join(", "), place };
  }
  if (commas.length >= 2) {
    const place = commas.at(-1)?.trim() ?? "";
    if (TOWN.test(place)) return { rest: commas.slice(0, -1).join(", "), place };
  }
  return undefined;
}

/** Ids for the resume's nodes, unique, as the model wants them. */
class Ids {
  private used = new Set<string>();
  next(prefix: string): string {
    let n = 1;
    while (this.used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    this.used.add(id);
    return id;
  }
}

const runOf = (text: string) => [{ text }];

/**
 * File labelled lines into the resume model: `roles[i]` is the role of `layout.lines[i]`. Every
 * line's text lands once; what fits nowhere lands in the last section, and is flagged.
 */
export function fileLines(layout: Layout, roles: readonly Role[]): Filed {
  const { lines } = layout;
  const ids = new Ids();
  const flags: Flag[] = [];
  const unfiled: { line: number; text: string }[] = [];
  let dateWords = 0;
  let dateChars = 0;
  const header: Header = { name: { first: "", last: "" }, links: [] };
  const sections: Section[] = [];
  const toUnfiled = (line: Line, text = line.text) => {
    if (countWords(text) === 0) return;
    unfiled.push({ line: line.id, text });
    flags.push({ kind: "unfiled", line: line.id });
  };

  // The header: the name, the contacts, and running text as its headline.
  let named = false;
  const fileContact = (line: Line) => {
    for (const item of contactItems(line, layout)) {
      const label = CONTACT_LABEL.exec(item.text)?.[0];
      const text = label === undefined ? item.text : item.text.slice(label.length).trim();
      if (label !== undefined) toUnfiled(line, label);
      const href = item.href;
      if ((isEmail(text) || href?.startsWith("mailto:")) && header.email === undefined) {
        const email = emailIn(text);
        header.email = email ?? text;
        const rest = email === undefined ? "" : text.replace(email, "").trim();
        if (rest !== "") toUnfiled(line, rest);
      } else if ((isPhone(text) || href?.startsWith("tel:")) && header.phone === undefined)
        header.phone = text;
      else if (webAddress(href) !== undefined || isUrl(text)) {
        const address = webAddress(href) ?? (/^https?:\/\//i.test(text) ? text : `https://${text}`);
        const link: Link = {
          id: ids.next("link"),
          kind: linkKind(address),
          label: text,
          href: address,
        };
        header.links.push(link);
      } else if (isPlace(text) && header.location === undefined) header.location = text;
      else if (hasEmail(text) && header.email === undefined) {
        header.email = emailIn(text) ?? text;
        const rest = text.replace(emailIn(text) ?? "", "").trim();
        if (rest !== "") toUnfiled(line, rest);
      } else if (phoneIn(text) !== undefined && header.phone === undefined) {
        header.phone = phoneIn(text) ?? text;
        const rest = text.replace(header.phone, "").trim();
        if (rest !== "") toUnfiled(line, rest);
      } else if (header.location === undefined && countWords(text) <= 4 && !/\d{3}/.test(text))
        header.location = text;
      else toUnfiled(line, text);
    }
  };

  // Each section's lines, from its heading on.
  type Open = { heading?: Line; lines: Line[] };
  const opened: Open[] = [];
  let current: Open | undefined;
  for (const line of lines) {
    const role = roles[line.id] ?? "running text";
    if (role === "section heading") {
      current = { heading: line, lines: [] };
      opened.push(current);
      continue;
    }
    if (role === "name") {
      if (!named) {
        const words = line.text.split(/\s+/).filter((word) => word !== "");
        header.name =
          words.length <= 1
            ? { first: words[0] ?? "", last: "" }
            : { first: words.slice(0, -1).join(" "), last: words.at(-1) ?? "" };
        named = true;
      } else toUnfiled(line);
      continue;
    }
    if (role === "contact") {
      fileContact(line);
      continue;
    }
    if (current === undefined) {
      // Before any heading: running text is the headline, or a summary; the rest fits nowhere.
      if (role === "running text" && header.headline === undefined && countWords(line.text) <= 15)
        header.headline = line.text;
      else if (role === "running text") {
        current = { lines: [line] };
        opened.push(current);
      } else toUnfiled(line);
      continue;
    }
    current.lines.push(line);
  }

  for (const open of opened) {
    const title = open.heading?.text ?? "";
    const role: SectionRole =
      open.heading === undefined ? "summary" : (headingRole(title) ?? "other");
    const id = ids.next("s");
    const body = open.lines;
    const roleOf = (line: Line) => roles[line.id] ?? "running text";
    const hasEntries = body.some((line) => {
      const each = roleOf(line);
      return each === "entry head" || each === "date" || each === "place";
    });
    if (hasEntries) {
      /** An entry being filed: its head's lines so far, and whether its body began. */
      interface Open {
        entry: Entry;
        heads: number;
        bodied: boolean;
      }
      const entries: Entry[] = [];
      /** The dates each entry keeps as text, which join its subtitle once its head is filed. */
      const datesAsText = new Map<Entry, string>();
      let open: Open | undefined;
      const start = (): Open => {
        open = {
          entry: { id: ids.next(`${id}-e`), title: "", bullets: [] },
          heads: 0,
          bodied: false,
        };
        entries.push(open.entry);
        return open;
      };
      for (const line of body) {
        const each = roleOf(line);
        if (each === "entry head") {
          const at = open === undefined || open.bodied || open.heads >= 2 ? start() : open;
          const split = at.heads === 0 ? leadingBold(line.parts) : undefined;
          if (split !== undefined) {
            at.entry.title = split.bold;
            at.entry.subtitle = split.rest;
            at.heads = 2;
          } else if (at.heads === 0) {
            at.entry.title = line.text;
            at.heads = 1;
          } else {
            at.entry.subtitle = line.text;
            at.heads = 2;
          }
        } else if (each === "date") {
          const taken =
            open !== undefined && (open.entry.dates !== undefined || datesAsText.has(open.entry));
          const at = open === undefined || open.bodied || taken ? start() : open;
          const dates: Dates | undefined = parseDates(line.text);
          if (dates !== undefined) {
            at.entry.dates = dates;
            dateWords += countWords(line.text);
            dateChars += countChars(line.text);
          } else {
            // A date the model cannot hold stays in its entry, as text, flagged.
            flags.push({ kind: "date-as-text", line: line.id });
            datesAsText.set(at.entry, line.text);
          }
        } else if (each === "place") {
          const taken = open !== undefined && open.entry.place !== undefined;
          const at = open === undefined || open.bodied || taken ? start() : open;
          at.entry.place = line.text;
        } else if (open === undefined) toUnfiled(line);
        else {
          const bullet: Bullet = { id: ids.next(`${open.entry.id}-b`), text: runOf(line.text) };
          open.entry.bullets.push(bullet);
          open.bodied = true;
        }
      }
      // What an entry's head holds on one line: a date at its end, a title and its company, and
      // a place at its end, for jobs and schools. Then a date kept as text joins the subtitle.
      for (const entry of entries) {
        const line = body.find((each) => each.text.includes(entry.title)) ?? body[0];
        if (entry.dates === undefined)
          for (const field of ["subtitle", "title"] as const) {
            const text = entry[field];
            const found = text === undefined ? undefined : trailingDate(text);
            if (found === undefined) continue;
            const dates = parseDates(found.date);
            if (dates !== undefined) {
              entry[field] = found.rest;
              entry.dates = dates;
              dateWords += countWords(found.date);
              dateChars += countChars(found.date);
            } else if (line !== undefined) flags.push({ kind: "date-as-text", line: line.id });
            break;
          }
        if (entry.subtitle === undefined) {
          const split = splitHead(entry.title);
          if (split !== undefined) {
            entry.title = split.title;
            entry.subtitle = split.subtitle;
          }
        }
        if (entry.place === undefined && PLACED.has(role))
          for (const field of ["subtitle", "title"] as const) {
            const text = entry[field];
            const found = text === undefined ? undefined : trailingPlace(text);
            if (found === undefined) continue;
            entry[field] = found.rest;
            entry.place = found.place;
            break;
          }
        const dateText = datesAsText.get(entry);
        if (dateText !== undefined)
          entry.subtitle =
            entry.subtitle === undefined ? dateText : `${entry.subtitle} · ${dateText}`;
      }
      sections.push({ kind: "entries", id, title, role, entries });
      continue;
    }
    const labelled = body.filter(
      (line) => LABEL.test(line.text) || leadingBold(line.parts) !== undefined,
    );
    if (body.length > 0 && labelled.length >= Math.ceil(body.length / 2) && labelled.length > 0) {
      sections.push({
        kind: "labelled",
        id,
        title,
        role,
        items: body.map((line) => {
          const colon = LABEL.exec(line.text);
          const bold = leadingBold(line.parts);
          const label =
            colon !== null && (bold === undefined || bold.bold.length >= (colon[1]?.length ?? 0))
              ? (colon[1] ?? "").trim()
              : (bold?.bold ?? "").replace(/:$/, "").trim();
          const text =
            colon !== null && label === (colon[1] ?? "").trim()
              ? (colon[2] ?? "").trim()
              : (bold?.rest ?? line.text).trim();
          return { id: ids.next(`${id}-i`), label, text: runOf(text) };
        }),
      });
      continue;
    }
    const listy =
      body.length > 0 &&
      (body.some((line) => roleOf(line) === "bullet") || body.some((line) => line.rowSize > 1));
    if (listy) {
      sections.push({
        kind: "list",
        id,
        title,
        role,
        items: body.map((line) => ({ id: ids.next(`${id}-i`), text: runOf(line.text) })),
      });
      continue;
    }
    sections.push({
      kind: "paragraph",
      id,
      title,
      role,
      text: runOf(body.map((line) => line.text).join(" ")),
    });
  }
  if (unfiled.length > 0)
    sections.push({
      kind: "list",
      id: UNFILED_ID,
      title: UNFILED_TITLE,
      role: "other",
      items: unfiled.map(({ text }) => ({ id: ids.next("unsorted-"), text: runOf(text) })),
    });
  const resume = Resume.parse({ version: 1, header, sections });
  const sum = (texts: readonly string[], count: (text: string) => number) =>
    texts.reduce((total, text) => total + count(text), 0);
  const read = lines.map((line) => line.text);
  const held = textsIn(resume);
  const left = unfiled.map((item) => item.text);
  return {
    resume,
    flags,
    words: {
      read: sum(read, countWords),
      landed: sum(held, countWords) + dateWords,
      unfiled: sum(left, countWords),
      chars: {
        read: sum(read, countChars),
        landed: sum(held, countChars) + dateChars,
        unfiled: sum(left, countChars),
      },
    },
  };
}

/** The words a resume holds in its text (`textsIn`). */
export const wordsIn = (resume: Resume): number =>
  textsIn(resume).reduce((sum, text) => sum + countWords(text), 0);

/**
 * The texts a resume holds: its header's, its titles', and every field's; not the title of the
 * last section, which the filing step gives it and no PDF had.
 */
export function textsIn(resume: Resume): string[] {
  const texts: string[] = [];
  const { header } = resume;
  texts.push(header.name.first, header.name.last);
  for (const text of [header.headline, header.email, header.phone, header.location])
    if (text !== undefined) texts.push(text);
  for (const link of header.links) texts.push(link.label);
  const rich = (runs: readonly { text: string }[]) => runs.map((run) => run.text).join("");
  for (const section of resume.sections) {
    if (section.id !== UNFILED_ID) texts.push(section.title);
    if (section.kind === "entries")
      for (const entry of section.entries) {
        texts.push(entry.title, entry.subtitle ?? "", entry.place ?? "");
        for (const bullet of entry.bullets) texts.push(rich(bullet.text));
      }
    else if (section.kind === "list") for (const item of section.items) texts.push(rich(item.text));
    else if (section.kind === "labelled")
      for (const item of section.items) texts.push(item.label, rich(item.text));
    else if (section.kind === "paragraph") texts.push(rich(section.text));
  }
  return texts;
}
