/**
 * Reading a LaTeX document's source as far as collecting the corpus needs (decision 0017): which
 * family it belongs to, whether it looks like a resume, how much of it is Latin script, and whether
 * it is a copy of another text or only a few lines from one. Whether it is a whole document, its
 * class and which files it loads are read by `src/import/source.ts`, which the import pipeline's
 * intake reads uploads with too. They are pure functions over text, so that they can be tested on
 * invented documents; none of them keeps or returns a document's text.
 *
 * Everything but the hashes and the line comparison reads the source with its comments taken out,
 * so that a commented-out `\documentclass` or `\input` counts for nothing, as it does for TeX.
 */

import { createHash } from "node:crypto";
import { documentClass, withoutComments } from "../src/import/source.ts";
import type { Family } from "./corpus-manifest.ts";

/** A file's bytes as text, for reading. A byte that is not UTF-8 becomes U+FFFD, not an error. */
export const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * The SHA-256 of a file's bytes with its line endings normalised, CRLF and a lone CR to LF, which
 * is what "byte-identical" compares: a copy saved on Windows is still a copy.
 */
export function normalisedHash(bytes: Uint8Array): string {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    if (byte === 13) {
      out[length++] = 10;
      if (bytes[i + 1] === 10) i++;
    } else out[length++] = byte;
  }
  return sha256(out.subarray(0, length));
}

/** A macro's name right after one of these is being defined, not called. */
const DEFINES =
  /\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand)\*?\s*\{?\s*$|\\(?:[gex]?def|let)\s*$/;

/**
 * Whether the source calls `\resumeSubheading`, the entry macro of Jake's Resume and of
 * sb2nov/resume before it; defining it is not calling it.
 */
export function callsResumeSubheading(tex: string): boolean {
  const text = withoutComments(tex);
  for (const match of text.matchAll(/\\resumeSubheading(?![A-Za-z@])/g))
    if (!DEFINES.test(text.slice(Math.max(0, match.index - 40), match.index))) return true;
  return false;
}

/** Classes that name their family. */
const CLASS_FAMILIES: Readonly<Record<string, Family>> = {
  altacv: "altacv",
  "awesome-cv": "awesome-cv",
  moderncv: "moderncv",
  europecv: "europecv",
};

/**
 * The family a main file belongs to: its class's when the class is AltaCV, Awesome-CV, moderncv or
 * europecv; `jake` when it calls `\resumeSubheading`; `other` for anything else.
 */
export function classify(tex: string): Family {
  const cls = documentClass(tex);
  if (cls !== undefined && Object.hasOwn(CLASS_FAMILIES, cls))
    return CLASS_FAMILIES[cls] ?? "other";
  return callsResumeSubheading(tex) ? "jake" : "other";
}

/** Whether the source is a slide deck: a beamer class, or one of LaTeX's older slide classes. */
export function isSlides(tex: string): boolean {
  const cls = documentClass(tex) ?? "";
  return /beamer/i.test(cls) || ["slides", "powerdot", "prosper", "seminar", "foils"].includes(cls);
}

/** Words that name a document as a resume, in a repository's name or a file's path. */
const RESUME_NAMES = new Set([
  "resume",
  "resumes",
  "résumé",
  "resumé",
  "cv",
  "cvs",
  "vita",
  "vitae",
  "curriculum",
  "curriculo",
  "currículo",
  "lebenslauf",
  "europass",
  "europasscv",
]);

/**
 * Whether a repository's name and a file's path name the file as a resume: one of `RESUME_NAMES`
 * as a word of its own, words being split at anything but a letter and where a lower-case letter
 * meets a capital, so that `MyCV` and `cv_2024` count and `opencv` and `resumen` do not.
 */
export function namedAsResume(place: string): boolean {
  return place
    .split(/[^\p{L}]+|(?<=\p{Ll})(?=\p{Lu})/u)
    .some((word) => RESUME_NAMES.has(word.toLowerCase()));
}

/** The headings a resume has, in the languages the corpus meets. */
const HEADINGS = new RegExp(
  `(?<!\\p{L})(${[
    ...["experience", "education", "skills", "employment", "projects", "publications", "awards"],
    ...["honors", "honours", "certifications", "certificates", "languages", "interests"],
    ...["internship", "internships", "volunteering", "achievements", "qualifications"],
    ...["coursework", "berufserfahrung", "ausbildung", "kenntnisse", "sprachen", "studium"],
    ...["expérience", "expériences", "formation", "compétences", "langues", "diplômes"],
    ...["experiencia", "formación", "educación", "habilidades", "idiomas", "estudios"],
    ...["esperienza", "esperienze", "istruzione", "competenze", "lingue", "experiência"],
    ...["formação", "educação", "competências", "werkervaring", "ervaring", "opleiding"],
    ...["vaardigheden", "talen", "doświadczenie", "wykształcenie", "umiejętności", "języki"],
    ...["erfarenhet", "utbildning", "erfaring", "uddannelse", "utdanning", "deneyim", "eğitim"],
    ...["beceriler", "pengalaman", "pendidikan", "keahlian"],
  ].join("|")})(?!\\p{L})`,
  "giu",
);

/**
 * How many different headings of a resume the sources name, education and experience among them,
 * with their comments taken out. A thesis or a paper that names a curriculum vitae names few.
 */
export function resumeHeadings(sources: readonly string[]): number {
  const found = new Set<string>();
  for (const source of sources)
    for (const match of withoutComments(source).matchAll(HEADINGS))
      found.add((match[1] ?? "").toLowerCase());
  return found.size;
}

/**
 * The share of the source's letters that are not Latin script, from 0 to 1: Cyrillic, Greek, CJK
 * and so on. Command names are Latin letters and count, as the rest of the source does.
 */
export function nonLatinShare(tex: string): number {
  const text = withoutComments(tex);
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(/(?!\p{Script=Latin})\p{L}/gu)?.length ?? 0) / letters;
}

/**
 * A text's lines as the fork rule compares them: line endings normalised, trailing spaces
 * dropped, blank lines left out.
 */
export function comparableLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
}

/**
 * Whether two texts' lines differ by more than `limit` lines: whether the shortest edit script
 * from one to the other adds more than `limit` lines or removes more than `limit`, a changed line
 * being one of each. For a script of `d` lines between texts whose lengths differ by `skew`, the
 * larger of the two is `(d + skew) / 2`, so the edit script is searched only as far as that bound
 * allows, which keeps comparing a file with many versions cheap.
 */
export function differsByMoreThan(
  a: readonly string[],
  b: readonly string[],
  limit: number,
): boolean {
  const skew = Math.abs(a.length - b.length);
  if (skew > limit) return true;
  return editDistance(a, b, 2 * limit - skew) === undefined;
}

/**
 * The length of the shortest edit script between two lists of lines, lines added plus lines
 * removed, or undefined when it is longer than `most`. Myers' algorithm, stopped at `most`.
 */
export function editDistance(
  a: readonly string[],
  b: readonly string[],
  most: number,
): number | undefined {
  const offset = most + 1;
  // The furthest index into `a` reached on each diagonal k = x - y, at offset + k.
  const furthest = new Array<number>(2 * most + 3).fill(0);
  for (let d = 0; d <= most; d++) {
    for (let k = -d; k <= d; k += 2) {
      const below = furthest[offset + k - 1] ?? 0;
      const above = furthest[offset + k + 1] ?? 0;
      let x = k === -d || (k !== d && below < above) ? above : below + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++;
        y++;
      }
      furthest[offset + k] = x;
      if (x >= a.length && y >= b.length) return d;
    }
  }
  return undefined;
}
