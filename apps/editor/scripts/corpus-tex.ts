/**
 * Reading a LaTeX document's source as far as collecting the corpus needs (decision 0017): whether
 * it is a whole document, which family it belongs to, whether it looks like a resume, how much of
 * it is Latin script, which files it loads, and whether it is a copy of another text or only a few
 * lines from one. They are pure functions over text, so that they can be tested on invented
 * documents; none of them keeps or returns a document's text beyond the names of the files it
 * loads.
 *
 * Everything but the hashes and the line comparison reads the source with its comments taken out,
 * so that a commented-out `\documentclass` or `\input` counts for nothing, as it does for TeX.
 */

import { createHash } from "node:crypto";
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

/** The source with TeX's comments taken out: from a `%` that no backslash escapes to its line's end. */
export function withoutComments(tex: string): string {
  return tex.replace(/(^|[^\\])((?:\\\\)*)%.*$/gm, "$1$2");
}

/** Whether the source is a whole document: `\documentclass`, `\begin{document}`, `\end{document}`. */
export function isWholeDocument(tex: string): boolean {
  const text = withoutComments(tex);
  return (
    /\\documentclass(?![A-Za-z@])/.test(text) &&
    /\\begin\s*\{document\}/.test(text) &&
    /\\end\s*\{document\}/.test(text)
  );
}

/** The class the source's first `\documentclass` names, if any. */
export function documentClass(tex: string): string | undefined {
  const text = withoutComments(tex);
  const match = /\\documentclass(?![A-Za-z@])/.exec(text);
  if (!match) return undefined;
  return argument(text, match.index + match[0].length)?.trim();
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
 * A file a document loads, by the name it gives: a class through `\documentclass` or `\LoadClass`,
 * a package through `\usepackage` or `\RequirePackage`, a source through `\input`, `\include`,
 * `\subfile`, `\InputIfFileExists`, `\import` or `\subimport`, or a bibliography through
 * `\bibliography` or `\addbibresource`. `\subimport` names its file from the folder of the file
 * that calls it, where the others name theirs from the main file's, as TeX's working folder is.
 */
export interface Reference {
  kind: "class" | "package" | "input" | "bibliography";
  name: string;
  fromCaller?: boolean;
}

const COMMANDS =
  /\\(documentclass|LoadClass|LoadClassWithOptions|usepackage|RequirePackage|RequirePackageWithOptions|input|include|subfile|InputIfFileExists|import|subimport|bibliography|addbibresource)(?![A-Za-z@])/g;

/**
 * The files a source loads, in the order it names them. A name built by a macro, holding a
 * backslash or a `#`, cannot be read without running TeX and is left out, and so is one whose
 * brackets do not close within WINDOW characters, which keeps the time this takes linear in the
 * source's length however its brackets are laid out.
 */
export function references(tex: string): Reference[] {
  const text = withoutComments(tex);
  const found: Reference[] = [];
  const add = (kind: Reference["kind"], names: string[], fromCaller = false) => {
    for (const raw of names) {
      const name = raw.trim();
      if (name !== "" && !/[\\#]/.test(name))
        found.push(fromCaller ? { kind, name, fromCaller } : { kind, name });
    }
  };
  for (const match of text.matchAll(COMMANDS)) {
    const command = match[1] ?? "";
    const at = match.index + match[0].length;
    switch (command) {
      case "documentclass":
      case "LoadClass":
      case "LoadClassWithOptions":
        add("class", [argument(text, at) ?? ""]);
        break;
      case "usepackage":
      case "RequirePackage":
      case "RequirePackageWithOptions":
        add("package", (argument(text, at) ?? "").split(","));
        break;
      case "input": {
        // LaTeX's \input takes a group; TeX's primitive takes a name that ends at a space.
        const braced = group(text, at);
        BARE_NAME.lastIndex = at;
        add("input", [braced?.value ?? BARE_NAME.exec(text)?.[1] ?? ""]);
        break;
      }
      case "include":
      case "subfile":
      case "InputIfFileExists":
        add("input", [group(text, at)?.value ?? ""]);
        break;
      case "import":
      case "subimport": {
        const folder = group(text, at);
        const file = folder && group(text, folder.end);
        if (folder && file) {
          const path = folder.value.trim().replace(/\/?$/, "/") + file.value.trim();
          add("input", [path.replace(/^\//, "")], command === "subimport");
        }
        break;
      }
      case "bibliography":
        add("bibliography", (group(text, at)?.value ?? "").split(","));
        break;
      case "addbibresource":
        add("bibliography", [argument(text, at) ?? ""]);
        break;
    }
  }
  return found;
}

/** TeX's primitive `\input` name: spaces, then everything up to a space, a brace or a comment. */
const BARE_NAME = /\s+([^\s{}\\%]+)/y;

/**
 * How many characters past where it starts an argument is looked for: a bracket that has not
 * closed by then is taken never to, so that reading one command's arguments costs at most this
 * much, and reading a source costs at most this much for each command in it.
 */
export const WINDOW = 8_192;

/** The index after any spaces at `at`, looking no further than `stop`. */
function skipSpace(text: string, at: number, stop: number): number {
  while (at < stop && /\s/.test(text[at] ?? "")) at++;
  return at;
}

/**
 * The index after any `[...]` optional arguments at `at` and the spaces around them, or undefined
 * when they do not end within WINDOW characters of `at`.
 */
function skipOptional(text: string, at: number): number | undefined {
  const stop = Math.min(text.length, at + WINDOW);
  for (;;) {
    at = skipSpace(text, at, stop);
    if (at >= stop) return stop === text.length ? at : undefined;
    if (text[at] !== "[") return at;
    let depth = 0;
    let i = at + 1;
    for (; i < stop; i++) {
      const char = text[i];
      if (char === "\\") i++;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === "]" && depth <= 0) break;
    }
    if (i >= stop) return undefined;
    at = i + 1;
  }
}

/**
 * The braced group at `at`, after any spaces, and the index after it; undefined if there is none,
 * or it does not close within WINDOW characters of `at`.
 */
export function group(text: string, at: number): { value: string; end: number } | undefined {
  const stop = Math.min(text.length, at + WINDOW);
  const start = skipSpace(text, at, stop);
  if (start >= stop || text[start] !== "{") return undefined;
  let depth = 0;
  for (let i = start; i < stop; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
  }
  return undefined;
}

/** A command's mandatory argument at `at`, after its optional ones; undefined if unreadable. */
function argument(text: string, at: number): string | undefined {
  const after = skipOptional(text, at);
  return after === undefined ? undefined : group(text, after)?.value;
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
