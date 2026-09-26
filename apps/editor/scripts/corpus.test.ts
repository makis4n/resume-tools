import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { bound, fastest } from "../src/test/timing";
import {
  assetsOf,
  type CollectOptions,
  candidateKey,
  collect,
  joinPath,
  judgeMain,
  mainOrder,
  mayBeMain,
  resolveReference,
  type Upstream,
} from "./corpus-collect";
import { fetchCorpus, PINNED } from "./corpus-fetch";
import { type Fetch, GitHub, Limiter, readBody, SEARCH_INTERVAL_MS } from "./corpus-github";
import {
  type CorpusDocument,
  collision,
  FAMILIES,
  type Family,
  FetchReport,
  firstCounters,
  formatJson,
  isLive,
  isSafePath,
  type LiveDocument,
  Manifest,
  matchingEntries,
  printable,
  temporaryName,
} from "./corpus-manifest";
import {
  classify,
  comparableLines,
  differsByMoreThan,
  editDistance,
  isSlides,
  isWholeDocument,
  namedAsResume,
  nonLatinShare,
  normalisedHash,
  references,
  resumeHeadings,
  WINDOW,
  withoutComments,
} from "./corpus-tex";

// Every document here is invented for these tests, under `example/` repositories: a class, a few
// macros and lines of filler that say so. Nothing is taken from a real resume or template.

/** A line of filler; a document is made of enough of them to pass 1 KB. */
const FILLER = "Invented line of a document that exists only in these tests.";

/** An invented document: a class, a preamble, a body, and `lines` lines of filler. */
function invented(
  cls: string,
  { preamble = [] as string[], body = [] as string[], lines = 30 } = {},
): string {
  return [
    `\\documentclass[11pt]{${cls}}`,
    ...preamble,
    "\\begin{document}",
    ...body,
    ...Array.from({ length: lines }, (_, i) => `${FILLER} ${i}`),
    "\\end{document}",
    "",
  ].join("\n");
}

/** An invented document in the style of Jake's Resume: it defines and calls `\resumeSubheading`. */
const jakeLike = (changed = 0) =>
  invented("article", {
    preamble: ["\\newcommand{\\resumeSubheading}[4]{#1 #2 #3 #4}"],
    body: [
      "\\resumeSubheading{Invented Role}{2020}{Invented Place}{Nowhere}",
      ...Array.from({ length: 20 }, (_, i) => (i < changed ? `Changed line ${i}` : `Kept ${i}`)),
    ],
  });

/** An invented `other` document naming the headings given, and more lines of filler than 30. */
const resume = (headings: string[], lines = 30) =>
  invented("article", { body: headings.map((heading) => `\\section{${heading}}`), lines });

const utf8 = (text: string) => new TextEncoder().encode(text);
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const live = (manifest: Manifest) => manifest.documents.filter(isLive);
/** Whether a line holds a control character, as a hostile name would put there. */
const controlled = (line: string) => /\p{Cc}/u.test(line);

describe("the manifest", () => {
  const doc = (changes: Partial<LiveDocument> = {}): LiveDocument => ({
    id: "jake-0001",
    family: "jake",
    repo: "example/example",
    repoId: 1,
    commit: "a".repeat(40),
    license: null,
    main: "resume.tex",
    files: [{ path: "resume.tex", sha256: "b".repeat(64), bytes: 4321 }],
    assets: ["fonts/Invented-Regular.ttf"],
    images: 1,
    ...changes,
  });
  const counters = { ...firstCounters(), jake: 2, other: 8 };
  const parse = (...documents: CorpusDocument[]) =>
    Manifest.safeParse({ version: 1, collected: "2026-09-26", counters, documents });

  test("takes a document as the brief's example has it, with its repository's number", () => {
    expect(
      parse(doc(), doc({ id: "other-0007", family: "other", repo: "example/b", repoId: 2 }))
        .success,
    ).toBe(true);
  });

  test.each([
    "../resume.tex",
    "a/../resume.tex",
    "/resume.tex",
    "a\\resume.tex",
    "a//resume.tex",
    "./resume.tex",
    "a/",
    "",
    "res\u0000ume.tex",
    "res\nume.tex",
    "res\u007fume.tex",
    "res\u0085ume.tex",
  ])("refuses the path %j", (path) => {
    expect(isSafePath(path)).toBe(false);
    const file = { path, sha256: "b".repeat(64), bytes: 1 };
    expect(parse(doc({ files: [doc().files[0]!, file] })).success).toBe(false);
    expect(parse(doc({ assets: [path] })).success).toBe(false);
  });

  test("takes paths with spaces and letters beyond ASCII", () => {
    expect(isSafePath("Lebenslauf Müller/cv.tex")).toBe(true);
  });

  test.each([
    ["an id that is not its family's", { id: "other-0001" }],
    ["an id without four digits", { id: "jake-1" }],
    ["a main file that is not first", { main: "cv.tex" }],
    ["a licence of NOASSERTION", { license: "NOASSERTION" }],
    ["a commit that is not 40 hex digits", { commit: "main" }],
    [
      "a file the corpus does not fetch",
      { files: [doc().files[0]!, { path: "x.png", sha256: "c".repeat(64), bytes: 1 }] },
    ],
    ["a file listed twice", { files: [doc().files[0]!, doc().files[0]!] }],
    ["an asset that is not a font", { assets: ["notes.txt"] }],
    ["an image named rather than counted", { assets: ["photo.jpg"] }],
    ["a count of images that is not one", { images: -1 }],
    [
      "files over 2 MB",
      { files: [{ path: "resume.tex", sha256: "b".repeat(64), bytes: 2_000_001 }] },
    ],
    ["a repository that is not owner/name", { repo: "example" }],
    ["a repository without its number", { repoId: 0 }],
  ] as const)("refuses %s", (_, changes) => {
    expect(parse(doc(changes as Partial<LiveDocument>)).success).toBe(false);
  });

  test("refuses an id used twice, and two documents of one repository by name or number", () => {
    expect(parse(doc(), doc({ repo: "example/b", repoId: 2 })).success).toBe(false);
    expect(parse(doc(), doc({ id: "jake-0002", repo: "Example/Example", repoId: 2 })).success).toBe(
      false,
    );
    // A repository renamed since: another name, the same number.
    expect(parse(doc(), doc({ id: "jake-0002", repo: "example/renamed" })).success).toBe(false);
  });

  test("refuses two files that are one on a disk that ignores case or normalisation", () => {
    const file = (path: string) => ({ path, sha256: "c".repeat(64), bytes: 1 });
    const cased = [doc().files[0]!, file("parts/Skills.tex"), file("parts/skills.tex")];
    expect(parse(doc({ files: cased })).success).toBe(false);
    const composed = [doc().files[0]!, file("parts/r\u00e9sum\u00e9.tex")];
    const decomposed = [...composed, file("parts/re\u0301sume\u0301.tex")];
    expect(parse(doc({ files: composed })).success).toBe(true);
    expect(parse(doc({ files: decomposed })).success).toBe(false);
    expect(collision(["a/B.tex", "c.tex", "a/b.tex"])).toBe("a/b.tex");
    expect(collision(["a/b.tex", "a/c.tex"])).toBeUndefined();
  });

  test("gives each family a counter past every id of it, withdrawn or not", () => {
    const withdrawn = { id: "other-0007", family: "other" as const, withdrawn: true as const };
    expect(parse(doc(), withdrawn).success).toBe(true);
    // The counter must be past the ids: jake-0002 is at jake's counter of 2.
    expect(parse(doc({ id: "jake-0002" })).success).toBe(false);
    expect(parse(doc(), { ...withdrawn, id: "other-0008" }).success).toBe(false);
    const missing = { ...counters } as Partial<Record<Family, number>>;
    delete missing.europecv;
    expect(
      Manifest.safeParse({ version: 1, collected: "2026-09-26", counters: missing, documents: [] })
        .success,
    ).toBe(false);
  });

  test("takes a withdrawn document as its id and family, and nothing more", () => {
    const withdrawn = { id: "jake-0001", family: "jake" as const, withdrawn: true as const };
    expect(parse(withdrawn).success).toBe(true);
    expect(parse({ ...withdrawn, repo: "example/example" } as CorpusDocument).success).toBe(false);
    // A withdrawn document's repository is not held against a document of it taken again.
    expect(parse(withdrawn, doc({ id: "jake-0002" })).success).toBe(false);
    expect(
      Manifest.safeParse({
        version: 1,
        collected: "2026-09-26",
        counters: { ...counters, jake: 3 },
        documents: [withdrawn, doc({ id: "jake-0002" })],
      }).success,
    ).toBe(true);
  });

  test("keeps a report's entry only while it is about the document the manifest has", () => {
    const manifest = Manifest.parse({
      version: 1,
      collected: "2026-09-26",
      counters,
      documents: [doc(), doc({ id: "other-0007", family: "other", repo: "example/b", repoId: 2 })],
    });
    const entry = (id: string, repo: string, commit = "a".repeat(40)) =>
      ({ id, repo, commit, state: "unavailable" }) as const;
    const entries = matchingEntries(manifest, {
      version: 1,
      documents: [
        entry("jake-0001", "example/example"),
        entry("other-0007", "example/earlier"),
        entry("other-0007", "example/b", "c".repeat(40)),
        entry("moderncv-0001", "example/example"),
      ],
    });
    expect([...entries.keys()]).toEqual(["jake-0001"]);
  });

  test("is written as Biome writes JSON, so that pnpm format leaves it be", () => {
    const fits = "x".repeat(100 - 4 - '"k": [""],'.length);
    const text = formatJson({
      a: { k: [fits], z: 1 },
      b: { k: [`${fits}x`], z: 1 },
      c: { k: [], o: {}, n: [1, 2], files: [{ path: "a.tex", bytes: 1 }] },
    });
    const lines = text.split("\n");
    expect(lines).toContain(`    "k": ["${fits}"],`);
    expect(lines).toContain(`    "k": [`);
    expect(lines).toContain(`      "${fits}x"`);
    expect(text).toContain('"k": [],\n    "o": {},\n    "n": [1, 2],\n    "files": [\n      {\n');
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("writes each file under a temporary name of its own", () => {
    const names = new Set(Array.from({ length: 50 }, () => temporaryName("/x/cv.tex")));
    expect(names.size).toBe(50);
    for (const name of names) expect(name.startsWith("/x/cv.tex.")).toBe(true);
  });

  test("writes a control character as its code point, so that the terminal is given none", () => {
    expect(printable("cv\u001b]0;title\u0007.tex\nnext\u009b")).toBe(
      "cv\\u001b]0;title\\u0007.tex\\u000anext\\u009b",
    );
    expect(printable("Lebenslauf Müller/cv.tex")).toBe("Lebenslauf Müller/cv.tex");
  });
});

describe("reading a document's source", () => {
  test("takes out comments, but not an escaped percent sign", () => {
    expect(withoutComments("a % b\n50\\% c % d\n\\\\% e\n% f")).toBe("a \n50\\% c \n\\\\\n");
  });

  test("knows a whole document, whatever comments say", () => {
    expect(isWholeDocument(invented("article"))).toBe(true);
    expect(isWholeDocument("\\section{Invented}\nNo class here.")).toBe(false);
    expect(isWholeDocument("% \\documentclass{article}\n\\begin{document}\\end{document}")).toBe(
      false,
    );
  });

  test.each([
    ["altacv", "altacv"],
    ["awesome-cv", "awesome-cv"],
    ["moderncv", "moderncv"],
    ["europecv", "europecv"],
    ["article", "other"],
    ["AltaCV", "other"],
  ] as const)("classifies the class %s as %s", (cls, family) => {
    expect(classify(invented(cls))).toBe(family);
  });

  test("classifies by \\resumeSubheading when the class names no family, and a call only", () => {
    expect(classify(jakeLike())).toBe("jake");
    const defined = invented("article", {
      preamble: ["\\newcommand{\\resumeSubheading}[4]{#1}", "\\def\\resumeSubheadingList{}"],
    });
    expect(classify(defined)).toBe("other");
    expect(classify(invented("article", { body: ["% \\resumeSubheading{a}{b}{c}{d}"] }))).toBe(
      "other",
    );
    // The class decides first.
    expect(classify(jakeLike().replace("{article}", "{moderncv}"))).toBe("moderncv");
  });

  test("counts the letters outside Latin script", () => {
    expect(nonLatinShare("Invented, façon, naïve, Łódź")).toBe(0);
    expect(nonLatinShare("abcdefghij αβ")).toBeCloseTo(2 / 12);
    expect(nonLatinShare("% αβγ\nabc")).toBe(0);
  });

  test("lists the files a source loads, in its order, and leaves out what a macro names", () => {
    const source = String.raw`\documentclass[a4paper,
  11pt]{quiltcv}
\usepackage[utf8]{inputenc}\usepackage{alpha, beta}
\RequirePackage[opt={x]}]{gamma}[2020/01/01]
\LoadClass{basequilt}
\input{sections/one}\input two.tex
\include{three}\subfile{parts/four}\InputIfFileExists{five}{}{}
\import{chapters/}{six}\subimport{here}{seven}
\bibliography{refs, more}\addbibresource[label=x]{extra.bib}
\input{\macro/x}\input{#1}\includegraphics{photo}\includeonly{x}\inputencoding{latin1}
% \usepackage{commented}`;
    expect(references(source)).toEqual([
      { kind: "class", name: "quiltcv" },
      { kind: "package", name: "inputenc" },
      { kind: "package", name: "alpha" },
      { kind: "package", name: "beta" },
      { kind: "package", name: "gamma" },
      { kind: "class", name: "basequilt" },
      { kind: "input", name: "sections/one" },
      { kind: "input", name: "two.tex" },
      { kind: "input", name: "three" },
      { kind: "input", name: "parts/four" },
      { kind: "input", name: "five" },
      { kind: "input", name: "chapters/six" },
      { kind: "input", name: "here/seven", fromCaller: true },
      { kind: "bibliography", name: "refs" },
      { kind: "bibliography", name: "more" },
      { kind: "bibliography", name: "extra.bib" },
    ]);
  });

  test("takes a bracket that has not closed within the window as never closing", () => {
    const far = "x".repeat(WINDOW);
    expect(references(`\\usepackage[${far}]{late}\\usepackage[near]{near}`)).toEqual([
      { kind: "package", name: "near" },
    ]);
    expect(references(`\\input{${far}}\\input{near}`)).toEqual([{ kind: "input", name: "near" }]);
    expect(references(`\\documentclass[${"y".repeat(WINDOW - 10)}]{quiltcv}`)).toEqual([
      { kind: "class", name: "quiltcv" },
    ]);
  });

  test("reads a source in time linear in its length, however its brackets are laid out", () => {
    // Brackets that never close, from every command: looking for each one's close to the end of
    // the source made reading it take time that grows as the square of its length.
    const hostile = (bytes: number) =>
      "\\usepackage[".repeat(bytes / 24) + "\\input{".repeat(bytes / 14);
    const small = hostile(20_160);
    const large = hostile(201_600);
    const [short = 0, long = 0] = fastest([() => references(small), () => references(large)], 3);
    expect(long).toBeLessThan(bound(20, short));
    expect(long).toBeLessThan(2_000);
  }, 60_000);

  test("names a resume by a word of its repository or path", () => {
    for (const place of ["example/cv/main.tex", "example/x/MyCV.tex", "example/x/cv_2024.tex"])
      expect(namedAsResume(place)).toBe(true);
    for (const place of ["example/x/Resume-EN.tex", "example/lebenslauf/main.tex"])
      expect(namedAsResume(place)).toBe(true);
    for (const place of ["example/opencv/doc.tex", "example/x/resumen.tex", "example/x/cvpr.tex"])
      expect(namedAsResume(place)).toBe(false);
  });

  test("counts a resume's headings over its sources, once each", () => {
    expect(resumeHeadings(["\\section{Education}", "\\section{Work Experience}"])).toBe(2);
    expect(resumeHeadings(["\\section{EDUCATION} \\section{Education}"])).toBe(1);
    expect(resumeHeadings(["\\section{Ausbildung} \\section{Compétences}"])).toBe(2);
    expect(resumeHeadings(["% \\section{Skills}\n\\section{Experiments}"])).toBe(0);
  });

  test("knows slides", () => {
    expect(isSlides(invented("beamer"))).toBe(true);
    expect(isSlides(invented("inventedbeamer"))).toBe(true);
    expect(isSlides(invented("article"))).toBe(false);
  });

  test("compares texts by the lines that differ, a changed line counting once", () => {
    const base = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const change = (n: number) => base.map((line, i) => (i < n ? `changed ${i}` : line));
    expect(differsByMoreThan(change(10), base, 10)).toBe(false);
    expect(differsByMoreThan(change(11), base, 10)).toBe(true);
    expect(differsByMoreThan([...base, ...base.slice(0, 10)], base, 10)).toBe(false);
    expect(differsByMoreThan([...base, ...base.slice(0, 11)], base, 10)).toBe(true);
    expect(differsByMoreThan(base.slice(11), base, 10)).toBe(true);
    expect(editDistance(change(3), base, 20)).toBe(6);
    expect(editDistance(change(11), base, 20)).toBeUndefined();
  });

  test("hashes a copy saved with other line endings as the same file", () => {
    const text = invented("article");
    expect(normalisedHash(utf8(text.replaceAll("\n", "\r\n")))).toBe(normalisedHash(utf8(text)));
    expect(normalisedHash(utf8(text.replaceAll("\n", "\r")))).toBe(normalisedHash(utf8(text)));
    expect(normalisedHash(utf8(`${text} `))).not.toBe(normalisedHash(utf8(text)));
  });
});

describe("a document's main file and what it loads", () => {
  const known = { hashes: new Set<string>() };
  const other = resume(["Education", "Skills"]);

  test("qualifies a whole document of 1 KB to 200 KB in Latin script", () => {
    expect(judgeMain(utf8(other), known, "example/cv/cv.tex")).toMatchObject({ family: "other" });
    expect(judgeMain(utf8("\\section{Invented}"), known, "example/cv/cv.tex")).toEqual({
      reason: "no-document",
    });
    expect(judgeMain(utf8(invented("article", { lines: 5 })), known, "example/cv/cv.tex")).toEqual({
      reason: "too-small",
    });
    expect(
      judgeMain(utf8(invented("article", { lines: 3300 })), known, "example/cv/cv.tex"),
    ).toEqual({ reason: "too-large" });
    const greek = invented("article", { body: ["αβγδεζηθικλμνξοπρστυφχψω".repeat(20)] });
    expect(judgeMain(utf8(greek), known, "example/cv/cv.tex")).toEqual({ reason: "not-latin" });
  });

  test("refuses a copy of a file already known, and a fork within ten lines of a version", () => {
    const hashes = new Set([normalisedHash(utf8(jakeLike()))]);
    expect(judgeMain(utf8(jakeLike().replaceAll("\n", "\r\n")), { hashes }, "a/b/r.tex")).toEqual({
      reason: "duplicate",
    });
    const versions = [comparableLines(jakeLike(0))];
    expect(judgeMain(utf8(jakeLike(10)), { hashes: new Set(), versions }, "a/b/r.tex")).toEqual({
      reason: "unmodified-fork",
    });
    expect(
      judgeMain(utf8(jakeLike(11)), { hashes: new Set(), versions }, "a/b/r.tex"),
    ).toMatchObject({ family: "jake" });
  });

  test("takes an other document only when its name says resume and it is not slides", () => {
    expect(judgeMain(utf8(other), known, "example/thesis/thesis.tex")).toEqual({
      reason: "not-a-resume",
    });
    expect(
      judgeMain(utf8(other.replace("{article}", "{beamer}")), known, "example/cv/cv.tex"),
    ).toEqual({
      reason: "not-a-resume",
    });
    // A family of its own needs no name.
    expect(judgeMain(utf8(jakeLike()), known, "example/thesis/main.tex")).toMatchObject({
      family: "jake",
    });
  });

  test("takes as a main file only a path the manifest may hold", () => {
    expect(mayBeMain("cv/resume.tex")).toBe(true);
    for (const path of ["cv\\resume.tex", "cv\u0007.tex", "cv\u001b]0;title\u0007.tex", "a//b.tex"])
      expect(mayBeMain(path)).toBe(false);
    expect(mayBeMain("coverletter.tex")).toBe(false);
    expect(mayBeMain("texmf/tex/latex/sample.tex")).toBe(false);
  });

  test("joins paths inside the repository only", () => {
    expect(joinPath("a/b", "../c.tex")).toBe("a/c.tex");
    expect(joinPath("a", "./b/./c.tex")).toBe("a/b/c.tex");
    expect(joinPath("", "../c.tex")).toBeUndefined();
    expect(joinPath("a", "../../c.tex")).toBeUndefined();
  });

  test("resolves what a file loads as TeX would, from the repository's files", () => {
    const files = new Set([
      "examples/resume.tex",
      "examples/sections/one.tex",
      "examples/here/seven.tex",
      "quiltcv.cls",
      "deep/down/quilthelp.sty",
      "other/quilthelp.sty",
      "styles/quilthelp.sty",
      "examples/refs.bib",
      "examples/notes.cfg",
    ]);
    const at = (
      kind: "class" | "package" | "input" | "bibliography",
      name: string,
      caller = "examples/resume.tex",
    ) => resolveReference({ kind, name }, caller, "examples/resume.tex", files);
    // A class from the folders above the main file's.
    expect(at("class", "quiltcv")).toBe("quiltcv.cls");
    // A package from anywhere, the shallowest first, then by path.
    expect(at("package", "quilthelp")).toBe("other/quilthelp.sty");
    // A source from the main file's folder, whoever loads it.
    expect(at("input", "sections/one", "examples/sections/one.tex")).toBe(
      "examples/sections/one.tex",
    );
    expect(at("input", "sections/one.tex")).toBe("examples/sections/one.tex");
    expect(
      resolveReference(
        { kind: "input", name: "here/seven", fromCaller: true },
        "examples/resume.tex",
        "examples/resume.tex",
        files,
      ),
    ).toBe("examples/here/seven.tex");
    expect(at("bibliography", "refs")).toBe("examples/refs.bib");
    // What the repository lacks is TeX Live's, and what the corpus does not fetch is left out.
    expect(at("package", "geometry")).toBeUndefined();
    expect(at("input", "notes.cfg")).toBeUndefined();
    expect(at("input", "../../outside")).toBeUndefined();
  });

  test("finds a class anywhere in the repository only at a path the manifest may hold", () => {
    const main = "cv.tex";
    const at = (files: string[]) =>
      resolveReference({ kind: "class", name: "quilt" }, main, main, new Set([main, ...files]));
    // A folder named with a backslash, as a Windows zip unpacked elsewhere leaves it.
    expect(at(["template\\class/quilt.cls"])).toBeUndefined();
    expect(at(["template\\class/quilt.cls", "zz/quilt.cls"])).toBe("zz/quilt.cls");
    expect(at(["bad\u0007/quilt.cls"])).toBeUndefined();
  });

  test("names the fonts beside the main file and counts its images, not the document compiled", () => {
    const files = [
      "cv/resume.tex",
      "cv/resume.pdf",
      "cv/photo.JPG",
      "cv/fonts/Invented-Regular.otf",
      "cv/notes.txt",
      "elsewhere.png",
    ];
    expect(assetsOf(files, "cv/resume.tex")).toEqual({
      assets: ["cv/fonts/Invented-Regular.otf"],
      images: 1,
    });
    expect(assetsOf(files, "top.tex")).toEqual({
      assets: ["cv/fonts/Invented-Regular.otf"],
      images: 3,
    });
    const fonts = Array.from({ length: 250 }, (_, i) => `f/${String(i).padStart(3, "0")}.ttf`);
    const images = Array.from({ length: 250 }, (_, i) => `img/${String(i).padStart(3, "0")}.png`);
    const many = assetsOf([...fonts, ...images], "cv.tex");
    expect(many.assets).toHaveLength(200);
    expect(many.images).toBe(250);
  });

  test("tries the shallowest main file first, then one named as a resume", () => {
    expect(["b/cv.tex", "main.tex", "resume.tex", "a/x.tex"].sort(mainOrder)).toEqual([
      "resume.tex",
      "main.tex",
      "b/cv.tex",
      "a/x.tex",
    ]);
  });
});

/** An invented repository: its files at its head commit, and older versions of some of them. */
interface FakeRepo {
  files: Record<string, string>;
  links?: Record<string, string>;
  license?: string;
  source?: string;
  /** Older contents of a path, oldest first; the file's head content is the latest. */
  history?: Record<string, string[]>;
  fork?: { created: string; pushed: string };
  /** GitHub's number for it, which a rename keeps; one made from its name unless said. */
  id?: number;
  /** Public unless said; GitHub serves a private repository's files only to a token. */
  visibility?: "public" | "private" | "internal";
  /** What GitHub answers about it, as for a repository it has blocked. */
  status?: number;
  /** The commit its default branch is at, when not the one made from its files. */
  commit?: string;
}

/** GitHub as far as the corpus asks it, over invented repositories, answering an injected fetch. */
class FakeGitHub {
  readonly repos = new Map<string, FakeRepo>();
  /** Old names, in lower case, and the names their repositories have now. */
  readonly renamed = new Map<string, string>();
  readonly search = new Map<string, { repo: string; path: string; private?: boolean }[]>();
  readonly forks = new Map<string, string[]>();
  readonly requests: string[] = [];
  /** The requests that carried a token. */
  readonly withToken: string[] = [];

  /** A repository's name now: GitHub answers for an old name as for the new one. */
  current(name: string) {
    return this.renamed.get(name.toLowerCase()) ?? name;
  }

  head(name: string) {
    const repo = this.repos.get(name);
    return repo?.commit ?? sha1(`${name}:${JSON.stringify(repo?.files)}`);
  }

  idOf(name: string) {
    return this.repos.get(name)?.id ?? Number.parseInt(sha1(name).slice(0, 7), 16) + 1;
  }

  /** A path's content at a ref of a repository: its head, HEAD, or an older version's commit. */
  private contentAt(name: string, ref: string, path: string): string | undefined {
    const repo = this.repos.get(name);
    if (!repo) return undefined;
    if (ref === "HEAD" || ref === this.head(name)) return repo.files[path] ?? repo.links?.[path];
    const versions = repo.history?.[path] ?? [];
    return versions.find((_, i) => sha1(`${name}:${path}:${i}`) === ref);
  }

  readonly fetch: Fetch = async (url, init) => {
    this.requests.push(url);
    const token = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (token !== undefined) this.withToken.push(url);
    const { host, pathname, searchParams } = new URL(url);
    const json = (body: unknown) => Response.json(body);
    const missing = () => new Response("Not Found", { status: 404 });
    const blocked = (status: number) =>
      new Response(JSON.stringify({ message: "Repository access blocked" }), { status });
    const visible = (repo: FakeRepo) => (repo.visibility ?? "public") === "public";
    if (host === "raw.githubusercontent.com") {
      const [, owner, name, ref, ...rest] = pathname.split("/");
      const full = this.current(`${owner}/${name}`);
      const repo = this.repos.get(full);
      if (repo?.status) return blocked(repo.status);
      if (repo && !visible(repo) && token === undefined) return missing();
      const content = this.contentAt(full, ref ?? "", rest.map(decodeURIComponent).join("/"));
      return content === undefined ? missing() : new Response(content);
    }
    if (pathname === "/search/code") {
      const hits = this.search.get(searchParams.get("q") ?? "") ?? [];
      const page = Number(searchParams.get("page"));
      const items = hits.slice((page - 1) * 100, page * 100).map((hit) => {
        const repo = this.repos.get(hit.repo);
        const hidden = hit.private ?? (repo !== undefined && !visible(repo));
        return { path: hit.path, repository: { full_name: hit.repo, private: hidden } };
      });
      return json({ total_count: hits.length, items });
    }
    const [, , owner, name, what, ...rest] = pathname.split("/");
    const full = this.current(`${owner}/${name}`);
    const repo = this.repos.get(full);
    if (what === "forks") {
      const page = Number(searchParams.get("page"));
      const forks = (this.forks.get(full) ?? []).slice((page - 1) * 100, page * 100);
      return json(
        forks.map((fork) => ({
          full_name: fork,
          created_at: this.repos.get(fork)?.fork?.created,
          pushed_at: this.repos.get(fork)?.fork?.pushed,
        })),
      );
    }
    if (!repo) return missing();
    if (repo.status) return blocked(repo.status);
    if (what === undefined) {
      const visibility = repo.visibility ?? "public";
      return json({
        id: this.idOf(full),
        full_name: full,
        private: visibility !== "public",
        visibility,
        default_branch: "main",
        license: repo.license ? { spdx_id: repo.license } : null,
        ...(repo.source ? { source: { full_name: repo.source } } : {}),
      });
    }
    const head = this.head(full);
    if (what === "branches" && rest[0] === "main")
      return json({ commit: { sha: head, commit: { tree: { sha: sha1(`tree:${head}`) } } } });
    if (what === "git" && rest[0] === "trees" && rest[1] === sha1(`tree:${head}`))
      return json({
        truncated: false,
        tree: [
          ...Object.entries(repo.files).map(([path, content]) => ({
            path,
            mode: "100644",
            type: "blob",
            size: utf8(content).length,
          })),
          ...Object.keys(repo.links ?? {}).map((path) => ({
            path,
            mode: "120000",
            type: "blob",
            size: 9,
          })),
          { path: "folder", mode: "040000", type: "tree" },
        ],
      });
    if (what === "commits" && rest.length === 0) {
      const path = searchParams.get("path") ?? "";
      const older = (repo.history?.[path] ?? []).map((_, i) => ({
        sha: sha1(`${full}:${path}:${i}`),
      }));
      return json(repo.files[path] === undefined ? older : [{ sha: head }, ...older.reverse()]);
    }
    return missing();
  };

  client() {
    return new GitHub({ fetch: this.fetch, token: "invented-token", sleep: async () => {} });
  }

  /** Whether anything was asked of the API about a repository. */
  asked(name: string) {
    return this.requests.some((url) => url.startsWith(`https://api.github.com/repos/${name}`));
  }
}

/** An upstream whose sample is `jakeLike(0)`, for a world with no forks. */
function upstreamOnly(fake: FakeGitHub) {
  fake.repos.set("example/upstream", { files: { "resume.tex": jakeLike(0) } });
}

/**
 * A world of invented repositories that covers every way a candidate is taken or refused. The
 * candidates are considered in the order of their names' SHA-256: epsilon, fork-quiet, fork-taken,
 * fork-old, thesis, alpha, greek, upstream, omega, letter, fork-slight, beta, zeta, sections,
 * delta, tiny, gone, gamma, duplicate.
 */
function world() {
  const fake = new FakeGitHub();
  // An old version of the upstream's sample, which a fork made then and barely edited still holds.
  const upstreamOld = jakeLike(0).replace(/Kept (\d+)/g, "Old $1");
  fake.repos.set("example/upstream", {
    files: { "resume.tex": jakeLike(0), "README.md": "Invented." },
    history: { "resume.tex": [upstreamOld] },
  });
  const fork = (content: string, pushed = "2021-01-01T00:00:00Z"): FakeRepo => ({
    files: { "resume.tex": content },
    source: "example/upstream",
    fork: { created: "2020-01-01T00:00:00Z", pushed },
  });
  fake.repos.set("example/fork-quiet", fork(jakeLike(30), "2019-01-01T00:00:00Z"));
  fake.repos.set(
    "example/fork-old",
    fork(upstreamOld.replace("Old 0\n", "Mine 0\n").replace("Old 1\n", "Mine 1\n")),
  );
  fake.repos.set("example/fork-slight", fork(jakeLike(3)));
  fake.repos.set("example/fork-taken", fork(jakeLike(15)));
  fake.forks.set("example/upstream", [
    "example/fork-quiet",
    "example/fork-old",
    "example/fork-slight",
    "example/fork-taken",
  ]);
  const alpha = invented("quilt", { body: ["\\section{Education}", "\\input{sections/one}"] });
  fake.repos.set("example/alpha", {
    license: "MIT",
    files: {
      "cv/resume.tex": alpha,
      "cv/sections/one.tex": "\\section{Experience}\n\\input{sections/two}\n",
      "cv/sections/two.tex": "Invented.\n\\input{sections/three}\n",
      "cv/sections/three.tex": "Invented.\n\\input{sections/four}\n",
      "cv/sections/four.tex": "Invented, too deep to follow.\n",
      "quilt.cls": "\\LoadClass{article}\n\\RequirePackage{quilthelp}\n",
      "styles/quilthelp.sty": "\\RequirePackage{xcolor}\n",
      "cv/photo.jpg": "not an image",
      "cv/fonts/Invented-Regular.otf": "not a font",
      "cv/resume.pdf": "not a PDF",
      "elsewhere.png": "not an image",
    },
    // A symbolic link holds the path it points to, and is never taken for the class.
    links: { "cv/quilt.cls": "../quilt.cls" },
  });
  fake.repos.set("example/beta", {
    license: "NOASSERTION",
    files: { "main.tex": invented("altacv") },
  });
  fake.repos.set("example/duplicate", {
    files: { "resume.tex": alpha.replaceAll("\n", "\r\n") },
  });
  fake.repos.set("example/delta", { files: { "cv.tex": invented("moderncv", { lines: 31 }) } });
  fake.repos.set("example/epsilon", { files: { "cv.tex": invented("moderncv", { lines: 32 }) } });
  fake.repos.set("example/gamma", { files: { "resume.tex": resume(["Education"]) } });
  fake.repos.set("example/greek", {
    files: { "cv.tex": invented("article", { body: ["αβγδεζηθικλμνξοπρστυφχψω".repeat(20)] }) },
  });
  fake.repos.set("example/letter", { files: { "coverletter.tex": invented("moderncv") } });
  fake.repos.set("example/omega", { files: { "cv.tex": resume(["Skills", "Awards"]) } });
  fake.repos.set("example/sections", { files: { "resume-part.tex": "\\section{Education}\n" } });
  fake.repos.set("example/thesis", {
    files: { "thesis.tex": resume(["Education", "Experience"]) },
  });
  fake.repos.set("example/tiny", { files: { "cv.tex": invented("article", { lines: 2 }) } });
  fake.repos.set("example/zeta", { files: { "cv.tex": invented("europecv") } });
  const hits = (repo: string, ...paths: string[]) => paths.map((path) => ({ repo, path }));
  fake.search.set("invented query", [
    ...hits("example/upstream", "resume.tex"),
    ...hits("example/alpha", "cv/resume.tex", "cv/sections/one.tex"),
    ...hits("example/beta", "main.tex"),
    ...hits("example/duplicate", "resume.tex"),
    ...hits("example/delta", "cv.tex"),
    ...hits("example/epsilon", "cv.tex"),
    ...hits("example/gamma", "resume.tex"),
    ...hits("example/gone", "cv.tex"),
    ...hits("example/greek", "cv.tex"),
    ...hits("example/letter", "coverletter.tex"),
    ...hits("example/omega", "cv.tex"),
    ...hits("example/sections", "resume-part.tex"),
    ...hits("example/thesis", "thesis.tex"),
    ...hits("example/tiny", "cv.tex"),
    ...hits("example/zeta", "cv.tex"),
  ]);
  fake.search.set("another query", hits("example/alpha", "cv/resume.tex"));
  return fake;
}

const UPSTREAM: Upstream = { repo: "example/upstream", family: "jake" };
const ONE_EACH = Object.fromEntries(FAMILIES.map((family) => [family, 1])) as Record<
  Family,
  number
>;
const NONE = Object.fromEntries(FAMILIES.map((family) => [family, 0])) as Record<Family, number>;

function options(
  fake: FakeGitHub,
  lines: string[],
  more: Partial<CollectOptions> = {},
): CollectOptions {
  return {
    github: fake.client(),
    log: (line) => lines.push(line),
    today: "2026-09-26",
    upstreams: [UPSTREAM],
    queries: ["invented query", "another query"],
    caps: { ...ONE_EACH, jake: 2 },
    total: 6,
    ...more,
  };
}

describe("collect", () => {
  test("takes each family's candidates in their names' hash order up to its cap", async () => {
    const fake = world();
    const lines: string[] = [];
    const saved: Manifest[] = [];
    const result = await collect(options(fake, lines, { save: (next) => saved.push(next) }));
    const taken = live(result.manifest).map((doc) => `${doc.id} ${doc.repo} ${doc.main}`);
    expect(taken).toEqual([
      "moderncv-0001 example/epsilon cv.tex",
      "jake-0001 example/fork-taken resume.tex",
      "other-0001 example/alpha cv/resume.tex",
      "altacv-0001 example/beta main.tex",
      "europecv-0001 example/zeta cv.tex",
      // awesome-cv has no candidate and jake one, so other takes their room from what it passed
      // over for being full.
      "other-0002 example/omega cv.tex",
    ]);
    expect(Manifest.parse(result.manifest)).toEqual(result.manifest);
    expect(result.manifest.counters).toEqual({
      ...firstCounters(),
      jake: 2,
      other: 3,
      moderncv: 2,
      altacv: 2,
      europecv: 2,
    });
    expect(saved.map((next) => next.documents.length)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const next of saved) expect(Manifest.safeParse(next).success).toBe(true);
    // gamma, other and naming one heading, was read ahead while other had room, so is examined,
    // and is no resume; delta, read ahead while moderncv had room, is examined and found full.
    expect(result.rejected).toEqual({
      upstream: 1,
      "never-pushed": 1,
      "unmodified-fork": 2,
      duplicate: 1,
      unavailable: 1,
      "not-latin": 1,
      "no-document": 2,
      "too-small": 1,
      "not-a-resume": 2,
    });
    expect(result.full).toBe(1);
    expect(result.short).toEqual({ "awesome-cv": 1, jake: 1 });
    expect(result.candidates).toEqual({ search: 15, forks: 4 });

    const [, , alpha, beta] = live(result.manifest);
    expect(alpha?.files.map((file) => file.path)).toEqual([
      "cv/resume.tex",
      "quilt.cls",
      "cv/sections/one.tex",
      "styles/quilthelp.sty",
      "cv/sections/two.tex",
      "cv/sections/three.tex",
    ]);
    const content = fake.repos.get("example/alpha")?.files["cv/resume.tex"] ?? "";
    expect(alpha?.files[0]).toEqual({
      path: "cv/resume.tex",
      sha256: sha256(content),
      bytes: utf8(content).length,
    });
    // Fonts are named and images only counted: photo.jpg, not resume.pdf, which is the document
    // compiled, nor elsewhere.png, which is not beside it.
    expect(alpha?.assets).toEqual(["cv/fonts/Invented-Regular.otf"]);
    expect(alpha?.images).toBe(1);
    expect(alpha?.license).toBe("MIT");
    expect(alpha?.commit).toBe(fake.head("example/alpha"));
    expect(alpha?.repoId).toBe(fake.idOf("example/alpha"));
    expect(beta?.license).toBeNull();

    // Files are read at the pinned commit, never a branch.
    const pinned = fake.requests.filter((url) =>
      url.includes("raw.githubusercontent.com/example/alpha/"),
    );
    expect(pinned.some((url) => url.includes(`/${fake.head("example/alpha")}/quilt.cls`))).toBe(
      true,
    );
    expect(pinned.some((url) => url.includes("/main/"))).toBe(false);
    // And nothing of any document's text is printed.
    for (const text of [FILLER, "Invented Role", "\\section", "\\documentclass"])
      expect(lines.join("\n")).not.toContain(text);
  });

  test("considers candidates in the order of their names' SHA-256, not of the names", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    for (const name of ["example/cv-c", "example/cv-d"])
      fake.repos.set(name, { files: { "cv.tex": resume(["Education", "Skills", name]) } });
    fake.search.set("q", [
      { repo: "example/cv-c", path: "cv.tex" },
      { repo: "example/cv-d", path: "cv.tex" },
    ]);
    expect(candidateKey("example/cv-d") < candidateKey("example/cv-c")).toBe(true);
    expect(candidateKey("Example/CV-D")).toBe(candidateKey("example/cv-d"));
    const result = await collect(
      options(fake, [], { queries: ["q"], caps: { ...NONE, other: 1 }, total: 1 }),
    );
    expect(result.added.map((doc) => doc.repo)).toEqual(["example/cv-d"]);
  });

  test("leaves out what code search finds in a repository that is not public, unread", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    fake.repos.set("example/secret-cv", {
      visibility: "private",
      files: { "cv.tex": resume(["Education", "Skills"]) },
    });
    // Public when code search listed it, private when its file is read: raw.githubusercontent.com
    // is asked without a token, so it cannot serve the file.
    fake.repos.set("example/stale-cv", {
      visibility: "private",
      files: { "cv.tex": resume(["Education", "Skills", "Awards"]) },
    });
    fake.repos.set("example/public-cv", { files: { "cv.tex": resume(["Skills", "Awards"]) } });
    fake.search.set("q", [
      { repo: "example/secret-cv", path: "cv.tex" },
      { repo: "example/stale-cv", path: "cv.tex", private: false },
      { repo: "example/public-cv", path: "cv.tex" },
    ]);
    const lines: string[] = [];
    const result = await collect(
      options(fake, lines, { queries: ["q"], caps: { ...NONE, other: 3 }, total: 3 }),
    );
    expect(result.added.map((doc) => doc.repo)).toEqual(["example/public-cv"]);
    expect(result.hidden).toBe(1);
    expect(result.rejected).toEqual({ unavailable: 1 });
    expect(fake.requests.some((url) => url.includes("example/secret-cv"))).toBe(false);
    expect(fake.withToken.some((url) => url.startsWith("https://raw."))).toBe(false);
    expect(lines).toContain(
      "  q: 2 files, 2 repositories not seen before, 1 file in repositories not public left out",
    );
  });

  test("takes no repository GitHub does not say is public", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    // Its files are served, as if by a token, but GitHub says it is internal: not public.
    fake.repos.set("example/other-cv", {
      visibility: "internal",
      files: { "cv.tex": resume(["Education", "Skills"]) },
    });
    fake.search.set("q", [{ repo: "example/other-cv", path: "cv.tex", private: false }]);
    const client = new GitHub({
      fetch: (url, init) =>
        fake.fetch(url, { ...init, headers: { ...(init?.headers as object), Authorization: "x" } }),
      sleep: async () => {},
    });
    const result = await collect(
      options(fake, [], { github: client, queries: ["q"], caps: { ...NONE, other: 1 }, total: 1 }),
    );
    expect(result.added).toEqual([]);
    expect(result.rejected).toEqual({ unavailable: 1 });
  });

  test("finds a repository's document before it asks whether its family is full", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    // Taken first, and fills other.
    fake.repos.set("example/other-cv", { files: { "cv.tex": resume(["Education", "Skills"]) } });
    // Its first main file is other but names one heading, so is no resume; its second is moderncv.
    fake.repos.set("example/b-mixed", {
      files: { "cv.tex": resume(["Education"], 31), "resume.tex": invented("moderncv") },
    });
    fake.repos.set("example/c-moderncv", {
      files: { "cv.tex": invented("moderncv", { lines: 35 }) },
    });
    fake.search.set("q", [
      { repo: "example/other-cv", path: "cv.tex" },
      { repo: "example/b-mixed", path: "cv.tex" },
      { repo: "example/b-mixed", path: "resume.tex" },
      { repo: "example/c-moderncv", path: "cv.tex" },
    ]);
    const result = await collect(
      options(fake, [], { queries: ["q"], caps: { ...NONE, moderncv: 1, other: 1 }, total: 2 }),
    );
    expect(live(result.manifest).map((doc) => `${doc.id} ${doc.repo} ${doc.main}`)).toEqual([
      "other-0001 example/other-cv cv.tex",
      "moderncv-0001 example/b-mixed resume.tex",
    ]);
  });

  test("examines no candidate every main file of which is of a full family", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    fake.repos.set("example/c-moderncv", { files: { "cv.tex": invented("moderncv") } });
    fake.search.set("q", [{ repo: "example/c-moderncv", path: "cv.tex" }]);
    const settings = { queries: ["q"], caps: { ...NONE, moderncv: 1, other: 2 }, total: 3 };
    const first = await collect(options(fake, [], settings));
    // moderncv is full before the run starts, so every screen finds it so.
    fake.repos.set("example/next-cv", { files: { "cv.tex": invented("moderncv", { lines: 36 }) } });
    fake.repos.set("example/plain-cv", { files: { "cv.tex": resume(["Skills", "Awards"]) } });
    fake.search
      .get("q")
      ?.push(
        { repo: "example/next-cv", path: "cv.tex" },
        { repo: "example/plain-cv", path: "cv.tex" },
      );
    const second = await collect(options(fake, [], { ...settings, manifest: first.manifest }));
    expect(second.added.map((doc) => doc.repo)).toEqual(["example/plain-cv"]);
    expect(second.full).toBe(1);
    expect(fake.asked("example/next-cv")).toBe(false);
  });

  test("refuses a document two of whose files are one on a disk that ignores case", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    fake.repos.set("example/cased-cv", {
      files: {
        "cv.tex": resume(["Education", "Skills"]).replace(
          "\\begin{document}",
          "\\begin{document}\n\\input{parts/Skills}\n\\input{parts/skills}",
        ),
        "parts/Skills.tex": "Invented upper-case part.\n",
        "parts/skills.tex": "Invented lower-case part.\n",
      },
    });
    fake.search.set("q", [{ repo: "example/cased-cv", path: "cv.tex" }]);
    const result = await collect(
      options(fake, [], { queries: ["q"], caps: { ...NONE, other: 1 }, total: 1 }),
    );
    expect(result.added).toEqual([]);
    expect(result.rejected).toEqual({ collision: 1 });
  });

  test("skips a document the manifest's schema refuses, saying why, and saves only what it takes", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    // Its branch is at a commit that is not 40 hex digits, which the schema refuses.
    fake.repos.set("example/bad-commit", {
      commit: "Z".repeat(40),
      files: { "cv.tex": resume(["Education", "Skills"]) },
    });
    fake.repos.set("example/plain-cv", { files: { "cv.tex": resume(["Skills", "Awards"]) } });
    fake.search.set("q", [
      { repo: "example/bad-commit", path: "cv.tex" },
      { repo: "example/plain-cv", path: "cv.tex" },
    ]);
    const lines: string[] = [];
    const saved: unknown[] = [];
    const result = await collect(
      options(fake, lines, {
        queries: ["q"],
        caps: { ...NONE, other: 2 },
        total: 2,
        save: (next) => saved.push(next),
      }),
    );
    expect(result.added.map((doc) => doc.repo)).toEqual(["example/plain-cv"]);
    expect(result.rejected).toEqual({ invalid: 1 });
    expect(lines).toContain(
      "  example/bad-commit cv.tex: the manifest's schema refuses it: a commit is 40 lower-case hex digits at documents.0.commit",
    );
    expect(saved).toHaveLength(1);
    for (const next of saved) expect(Manifest.safeParse(next).success).toBe(true);
  });

  test("reads no main file whose path the manifest may not hold, and prints no control character", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    const hostile = "cv\u001b]0;invented title\u0007.tex";
    fake.repos.set("example/hostile", { files: { [hostile]: invented("europecv") } });
    fake.search.set("q", [{ repo: "example/hostile", path: hostile }]);
    const lines: string[] = [];
    const result = await collect(
      options(fake, lines, { queries: ["q"], caps: { ...NONE, europecv: 1 }, total: 1 }),
    );
    expect(result.added).toEqual([]);
    expect(result.rejected).toEqual({ "no-document": 1 });
    expect(
      fake.requests.some((url) => url.startsWith("https://raw.") && url.includes("hostile")),
    ).toBe(false);
    expect(lines.filter(controlled)).toEqual([]);
  });

  test("refuses a main file past 200 KB before it has read more of it", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    fake.repos.set("example/big-cv", {
      files: { "cv.tex": invented("europecv", { lines: 3400 }) },
    });
    fake.search.set("q", [{ repo: "example/big-cv", path: "cv.tex" }]);
    const result = await collect(
      options(fake, [], { queries: ["q"], caps: { ...NONE, europecv: 1 }, total: 1 }),
    );
    expect(result.rejected).toEqual({ "too-large": 1 });
  });

  test("appends to a manifest, keeping its ids, and a copy of a main file it has is a duplicate", async () => {
    const fake = world();
    const first = await collect(options(fake, []));
    // Full as it is: nothing is added, and the day it was collected stays.
    const again = await collect(
      options(fake, [], { manifest: first.manifest, today: "2026-10-01" }),
    );
    expect(again.manifest).toEqual(first.manifest);

    // With room for one more, a fork made since is appended under jake's next id; a copy of a main
    // file the manifest has, found by code search since, is a duplicate, though collected before.
    fake.repos.set("example/fork-new", {
      files: { "resume.tex": jakeLike(18) },
      source: "example/upstream",
      fork: { created: "2020-01-01T00:00:00Z", pushed: "2022-01-01T00:00:00Z" },
    });
    fake.forks.get("example/upstream")?.push("example/fork-new");
    fake.repos.set("example/twin", {
      files: { "resume.tex": fake.repos.get("example/alpha")?.files["cv/resume.tex"] ?? "" },
    });
    fake.search.get("invented query")?.push({ repo: "example/twin", path: "resume.tex" });
    const refilled = await collect(
      options(fake, [], { manifest: first.manifest, today: "2026-10-01", total: 7 }),
    );
    expect(refilled.manifest.documents.slice(0, 6)).toEqual(first.manifest.documents);
    expect(refilled.added.map((doc) => `${doc.id} ${doc.repo}`)).toEqual([
      "jake-0002 example/fork-new",
    ]);
    expect(refilled.manifest.collected).toBe("2026-10-01");
    expect(refilled.rejected.duplicate).toBe(1);
  });

  test("withdraws a document the last fetch found unavailable, and fills its place under a new id", async () => {
    const fake = world();
    const first = await collect(options(fake, []));
    const beta = live(first.manifest).find((doc) => doc.repo === "example/beta");
    if (!beta) throw new Error("the world has no document of example/beta");
    const report: FetchReport = {
      version: 1,
      documents: live(first.manifest).map(({ id, repo, commit }) => ({
        id,
        repo,
        commit,
        state: id === beta.id ? "unavailable" : "fetched",
      })),
    };
    fake.repos.set("example/kappa", { files: { "cv.tex": invented("altacv", { lines: 34 }) } });
    fake.search.get("invented query")?.push({ repo: "example/kappa", path: "cv.tex" });
    const lines: string[] = [];
    const saved: Manifest[] = [];
    const next = await collect(
      options(fake, lines, {
        manifest: first.manifest,
        report,
        today: "2026-10-01",
        save: (manifest) => saved.push(manifest),
      }),
    );
    expect(next.withdrawn).toEqual(["altacv-0001"]);
    expect(lines).toContain(
      "altacv-0001 example/beta: withdrawn, since the last fetch found it unavailable",
    );
    expect(next.manifest.documents[3]).toEqual({
      id: "altacv-0001",
      family: "altacv",
      withdrawn: true,
    });
    expect(next.added.map((doc) => `${doc.id} ${doc.repo}`)).toEqual(["altacv-0002 example/kappa"]);
    expect(next.manifest.counters.altacv).toBe(3);
    expect(next.manifest.collected).toBe("2026-10-01");
    expect(Manifest.parse(next.manifest)).toEqual(next.manifest);
    // The withdrawal is saved before anything is added, so a stopped run keeps it.
    expect(saved[0]?.documents[3]).toEqual({
      id: "altacv-0001",
      family: "altacv",
      withdrawn: true,
    });
  });

  test("withdraws nothing on a report's word about another repository or commit under the id", async () => {
    const fake = world();
    const first = await collect(options(fake, []));
    const [doc] = live(first.manifest);
    if (!doc) throw new Error("the world has no document");
    const report: FetchReport = {
      version: 1,
      documents: [
        { id: doc.id, repo: "example/earlier", commit: doc.commit, state: "unavailable" },
        { id: doc.id, repo: doc.repo, commit: "c".repeat(40), state: "unavailable" },
      ],
    };
    const next = await collect(options(fake, [], { manifest: first.manifest, report }));
    expect(next.withdrawn).toEqual([]);
    expect(next.manifest).toEqual(first.manifest);
  });

  test("gives ids from each family's counter, never from the highest id there", async () => {
    const fake = world();
    const first = await collect(options(fake, []));
    const manifest = { ...first.manifest, counters: { ...first.manifest.counters, altacv: 9 } };
    const beta = live(first.manifest).find((doc) => doc.repo === "example/beta");
    if (!beta) throw new Error("the world has no document of example/beta");
    const { id, repo, commit } = beta;
    fake.repos.set("example/kappa", { files: { "cv.tex": invented("altacv", { lines: 34 }) } });
    fake.search.get("invented query")?.push({ repo: "example/kappa", path: "cv.tex" });
    const next = await collect(
      options(fake, [], {
        manifest,
        report: { version: 1, documents: [{ id, repo, commit, state: "unavailable" }] },
      }),
    );
    expect(next.added.map((doc) => doc.id)).toEqual(["altacv-0009"]);
    expect(next.manifest.counters.altacv).toBe(10);
  });

  test("does not take a repository again under the name it was renamed to", async () => {
    const fake = new FakeGitHub();
    upstreamOnly(fake);
    fake.repos.set("example/old-name", {
      files: { "resume.tex": resume(["Education", "Skills"]) },
    });
    fake.search.set("q", [{ repo: "example/old-name", path: "resume.tex" }]);
    const settings = { queries: ["q"], caps: { ...NONE, other: 2 }, total: 2 };
    const first = await collect(options(fake, [], settings));
    expect(first.added.map((doc) => doc.repo)).toEqual(["example/old-name"]);
    // The owner renames it and edits the resume, and code search finds it under its new name.
    const repo = fake.repos.get("example/old-name");
    if (!repo) throw new Error("the repository is gone");
    repo.id = fake.idOf("example/old-name");
    fake.repos.delete("example/old-name");
    repo.files["resume.tex"] = resume(["Education", "Skills", "Edited"]);
    fake.repos.set("example/new-name", repo);
    fake.renamed.set("example/old-name", "example/new-name");
    fake.search.set("q", [{ repo: "example/new-name", path: "resume.tex" }]);
    const second = await collect(options(fake, [], { ...settings, manifest: first.manifest }));
    expect(second.added).toEqual([]);
    // Known for the repository taken before, not refused as a second document of it.
    expect(second.rejected).toEqual({});
  });

  test("stops at the total, and leaves the rest unconsidered", async () => {
    const fake = world();
    const result = await collect(options(fake, [], { total: 2 }));
    expect(live(result.manifest).map((doc) => doc.id)).toEqual(["moderncv-0001", "jake-0001"]);
    expect(result.left).toBeGreaterThan(0);
  });
});

describe("the GitHub client", () => {
  const client = (fetch: Fetch, waits: number[] = [], now = () => 0) =>
    new GitHub({ fetch, token: "invented-token", sleep: async (ms) => void waits.push(ms), now });
  const repository = {
    id: 7,
    full_name: "example/example",
    private: false,
    visibility: "public",
    default_branch: "main",
    license: null,
  };
  const details = { id: 7, repo: "example/example", defaultBranch: "main", license: null };
  /** A body that gives `chunk` bytes each time it is read from, and counts how often it was. */
  const stream = (chunk: number, chunks: number) => {
    const counted = { reads: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        counted.reads++;
        if (counted.reads > chunks) controller.close();
        else controller.enqueue(new Uint8Array(chunk).fill(97));
      },
    });
    return { body, counted };
  };

  test("tries a failed request three more times, 1, 2 and 4 s apart, then says what failed", async () => {
    const waits: number[] = [];
    let calls = 0;
    const github = client(async () => {
      calls++;
      return new Response("", { status: 502 });
    }, waits);
    const failure = await github.repository("example/example").catch((error: Error) => error);
    expect(String(failure)).toContain("GitHub answered HTTP 502 for /repos/example/example");
    expect(String(failure)).not.toContain("invented-token");
    expect(calls).toBe(4);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  test("waits as long as Retry-After asks, and for a spent limit to reset", async () => {
    const waits: number[] = [];
    const answers = [
      new Response("", { status: 429, headers: { "retry-after": "7" } }),
      Response.json(repository, {
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "100" },
      }),
      Response.json(repository),
    ];
    const github = client(
      async () => answers.shift() ?? new Response("", { status: 500 }),
      waits,
      () => 40_000,
    );
    expect(await github.repository("example/example")).toEqual(details);
    expect(waits).toEqual([7000]);
    await github.repository("example/example");
    expect(waits).toEqual([7000, 100_000 - 40_000 + 1000]);
  });

  test("waits a minute for a secondary rate limit that names no wait", async () => {
    const waits: number[] = [];
    const answers = [
      new Response("You have exceeded a secondary rate limit.", { status: 403 }),
      Response.json(repository),
    ];
    const github = client(async () => answers.shift() ?? new Response("", { status: 500 }), waits);
    await github.repository("example/example");
    expect(waits).toEqual([60_000]);
  });

  test("spaces code searches out, 10 a minute", async () => {
    let now = 0;
    const waits: number[] = [];
    const github = new GitHub({
      fetch: async () => Response.json({ total_count: 0, items: [] }),
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      now: () => now,
    });
    await github.searchCode("invented", 1);
    now += 1000;
    await github.searchCode("invented", 2);
    expect(waits).toEqual([SEARCH_INTERVAL_MS - 1000]);
    expect(SEARCH_INTERVAL_MS).toBeGreaterThanOrEqual(6000);
  });

  test("keeps a code search's hit only in a repository GitHub marks public", async () => {
    const item = (full_name: string, flag?: boolean) => ({
      path: "cv.tex",
      repository: { full_name, ...(flag === undefined ? {} : { private: flag }) },
    });
    const github = client(async () =>
      Response.json({
        total_count: 3,
        items: [item("example/open", false), item("example/closed", true), item("example/unsaid")],
      }),
    );
    expect(await github.searchCode("invented", 1)).toEqual({
      total: 3,
      hits: [{ repo: "example/open", path: "cv.tex" }],
      hidden: 2,
    });
  });

  test("takes a repository that is not public for one that is gone", async () => {
    for (const changes of [
      { private: true, visibility: "private" },
      { private: false, visibility: "internal" },
      { private: false, visibility: undefined },
      { private: undefined },
    ]) {
      const github = client(async () => Response.json({ ...repository, ...changes }));
      expect(await github.repository("example/example")).toBeUndefined();
    }
  });

  test("sends the token to api.github.com alone, never to raw.githubusercontent.com", async () => {
    const seen: { host: string; token: boolean }[] = [];
    const github = client(async (url, init) => {
      const { host } = new URL(url);
      seen.push({
        host,
        token: (init?.headers as Record<string, string>).Authorization !== undefined,
      });
      return host === "api.github.com" ? Response.json(repository) : new Response("Invented.");
    });
    await github.repository("example/example");
    await github.file("example/example", "a".repeat(40), "cv.tex", 100);
    expect(seen).toEqual([
      { host: "api.github.com", token: true },
      { host: "raw.githubusercontent.com", token: false },
    ]);
  });

  test("does not ask again for what is gone or blocked, a file as a repository", async () => {
    let calls = 0;
    const answers = [
      new Response("", { status: 404 }),
      new Response("", { status: 404 }),
      new Response(JSON.stringify({ message: "Repository access blocked" }), { status: 403 }),
      new Response(JSON.stringify({ message: "Repository access blocked" }), { status: 403 }),
    ];
    const github = client(async () => {
      calls++;
      return answers.shift() ?? new Response("", { status: 500 });
    });
    expect(await github.repository("example/gone")).toBeUndefined();
    expect(await github.file("example/gone", "a".repeat(40), "cv.tex", 100)).toBe("gone");
    expect(await github.repository("example/blocked")).toBeUndefined();
    expect(await github.file("example/blocked", "a".repeat(40), "cv.tex", 100)).toBe("gone");
    expect(calls).toBe(4);
  });

  test("reads a body no further than its cap, by its length when it is not compressed", async () => {
    const read = async (response: Response, limit: number) => {
      const bytes = await readBody(response, limit);
      return bytes === undefined ? "too-large" : bytes.length;
    };
    // A length over the cap is enough, before a byte is read.
    const told = stream(64, 16);
    const long = new Response(told.body, { headers: { "content-length": "1024" } });
    expect(await read(long, 100)).toBe("too-large");
    expect(told.counted.reads).toBeLessThanOrEqual(1);
    // No length, or one that is wrong or counts compressed bytes: the bytes read decide.
    for (const headers of [
      {},
      { "content-length": "10" },
      { "content-encoding": "gzip", "content-length": "10" },
    ] as Record<string, string>[]) {
      const body = stream(64, 1_000);
      expect(await read(new Response(body.body, { headers }), 100)).toBe("too-large");
      expect(body.counted.reads).toBeLessThanOrEqual(3);
    }
    const small = stream(50, 2);
    const compressed = { "content-encoding": "gzip", "content-length": "500" };
    expect(await read(new Response(small.body, { headers: compressed }), 100)).toBe(100);
    expect(await read(new Response("x".repeat(100)), 100)).toBe(100);
  });

  test("gives a file past its cap as too large", async () => {
    const github = client(async () => new Response("x".repeat(101)));
    expect(await github.file("example/example", "a".repeat(40), "cv.tex", 100)).toBe("too-large");
    const exact = client(async () => new Response("x".repeat(100)));
    const bytes = await exact.file("example/example", "a".repeat(40), "cv.tex", 100);
    expect(bytes instanceof Uint8Array && bytes.length).toBe(100);
  });

  test("tries a body cut off on the way again, as a request that failed", async () => {
    const waits: number[] = [];
    let calls = 0;
    const github = client(async () => {
      calls++;
      if (calls > 1) return Response.json(repository);
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(utf8('{"id": 7, "full_na'));
          controller.error(new TypeError("terminated"));
        },
      });
      return new Response(body);
    }, waits);
    expect(await github.repository("example/example")).toEqual(details);
    expect(calls).toBe(2);
    expect(waits).toEqual([1000]);
    // A body cut off every time is a request that failed every time.
    let tries = 0;
    const broken = client(async () => {
      tries++;
      const body = new ReadableStream({
        start: (controller) => controller.error(new TypeError("terminated")),
      });
      return new Response(body);
    });
    await expect(broken.repository("example/example")).rejects.toThrow("terminated");
    expect(tries).toBe(4);
  });

  test("reads files through the contents API when raw.githubusercontent.com cannot be reached", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const lines: string[] = [];
    const github = new GitHub({
      token: "invented-token",
      log: (line) => lines.push(line),
      sleep: async () => {},
      fetch: async (url, init) => {
        seen.push({ url, headers: init?.headers as Record<string, string> });
        if (url.startsWith("https://raw.githubusercontent.com/"))
          throw new TypeError("fetch failed", {
            cause: new Error("getaddrinfo ENOTFOUND \u001b]0;invented\u0007"),
          });
        return new Response("Invented.");
      },
    });
    const bytes = await github.file("example/example", "a".repeat(40), "a folder/cv.tex", 100);
    expect(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)).toBe("Invented.");
    const last = seen.at(-1);
    expect(last?.url).toBe(
      `https://api.github.com/repos/example/example/contents/a%20folder/cv.tex?ref=${"a".repeat(40)}`,
    );
    expect(last?.headers.Accept).toBe("application/vnd.github.raw+json");
    expect(last?.headers.Authorization).toBe("Bearer invented-token");
    const raw = seen.filter((each) => each.url.startsWith("https://raw."));
    expect(raw.length).toBe(4);
    expect(raw.every((each) => each.headers.Authorization === undefined)).toBe(true);
    // Once is enough to know the host is out of reach.
    await github.file("example/example", "a".repeat(40), "cv.tex", 100);
    expect(seen.filter((each) => each.url.startsWith("https://raw.")).length).toBe(4);
    expect(lines.join("\n")).toContain("ENOTFOUND");
    expect(lines.join("\n")).not.toContain("invented-token");
    // What it prints of the failure holds no control character.
    expect(lines.filter(controlled)).toEqual([]);
    expect(lines.join("\n")).toContain("\\u001b]0;invented\\u0007");
  });

  test("a limiter runs at most so many tasks at once, and every one of them", async () => {
    const limiter = new Limiter(2);
    let running = 0;
    let most = 0;
    const done = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        limiter.run(async () => {
          most = Math.max(most, ++running);
          await new Promise((resolve) => setTimeout(resolve, 1));
          running--;
          return i;
        }),
      ),
    );
    expect(done).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(most).toBe(2);
  });
});

describe("fetch", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "corpus-"));
    folders.push(dir);
    return dir;
  };
  const report = (dir: string) =>
    FetchReport.parse(JSON.parse(readFileSync(join(dir, "fetch-report.json"), "utf8")));
  /** Every file under a folder, by path, sorted. */
  const listing = (dir: string) =>
    (
      readdirSync(dir, { recursive: true, withFileTypes: true }) as {
        name: string;
        parentPath: string;
        isFile: () => boolean;
      }[]
    )
      .filter((entry) => entry.isFile())
      .map((entry) =>
        join(entry.parentPath, entry.name)
          .slice(dir.length + 1)
          .split("\\")
          .join("/"),
      )
      .sort();
  const quiet = () => {};

  test("writes every file that verifies, and a second run downloads nothing and asks once a document", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const dir = folder();
    const lines: string[] = [];
    const first = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      log: (line) => lines.push(line),
    });
    const files = live(manifest).flatMap((doc) => doc.files);
    expect(first.states).toMatchObject({ fetched: 6, unavailable: 0, mismatch: 0, failed: 0 });
    expect(first.files).toBe(files.length);
    expect(first.downloaded).toBe(files.length);
    expect(first.checked).toBe(6);
    const alpha = live(manifest).find((doc) => doc.repo === "example/alpha");
    if (!alpha) throw new Error("the world has no document of example/alpha");
    expect(readFileSync(join(dir, alpha.id, "quilt.cls"), "utf8")).toBe(
      fake.repos.get("example/alpha")?.files["quilt.cls"],
    );
    expect(readFileSync(join(dir, alpha.id, PINNED), "utf8")).toBe(
      `example/alpha ${alpha.commit}\n`,
    );
    expect(report(dir).documents).toEqual(
      live(manifest).map(({ id, repo, commit }) => ({ id, repo, commit, state: "fetched" })),
    );
    expect(lines).toEqual([]);

    // A second run downloads nothing, but asks GitHub once for each document's repository.
    const before = fake.requests.length;
    const second = await fetchCorpus({ github: fake.client(), manifest, dir, log: quiet });
    expect(second.downloaded).toBe(0);
    expect(second.checked).toBe(6);
    expect(fake.requests.slice(before).sort()).toEqual(
      live(manifest)
        .map((doc) => `https://api.github.com/repos/${doc.repo}`)
        .sort(),
    );

    // A file changed on disk is downloaded again.
    writeFileSync(join(dir, alpha.id, "quilt.cls"), "tampered");
    const third = await fetchCorpus({ github: fake.client(), manifest, dir, log: quiet });
    expect(third.downloaded).toBe(1);
    expect(readFileSync(join(dir, alpha.id, "quilt.cls"), "utf8")).not.toBe("tampered");
  });

  test("learns on a later run that a repository has gone, turned private or been blocked", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const dir = folder();
    await fetchCorpus({ github: fake.client(), manifest, dir, log: quiet });
    const docs = live(manifest);
    const of = (repo: string) => docs.find((doc) => doc.repo === repo)?.id ?? "";
    fake.repos.delete("example/beta");
    const zeta = fake.repos.get("example/zeta");
    const omega = fake.repos.get("example/omega");
    if (!zeta || !omega) throw new Error("the world has lost a repository");
    zeta.visibility = "private";
    omega.status = 403;
    const lines: string[] = [];
    const later = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      log: (line) => lines.push(line),
    });
    expect(later.states).toMatchObject({ fetched: 3, unavailable: 3, mismatch: 0, failed: 0 });
    expect(later.downloaded).toBe(0);
    const gone = [of("example/beta"), of("example/zeta"), of("example/omega")];
    for (const id of gone) {
      expect(report(dir).documents.find((entry) => entry.id === id)?.state).toBe("unavailable");
      // Its owner took it down: the copy goes too.
      expect(existsSync(join(dir, id))).toBe(false);
    }
    expect(lines.sort()).toEqual(
      [
        `${of("example/beta")} example/beta: is gone, private or blocked`,
        `${of("example/zeta")} example/zeta: is gone, private or blocked`,
        `${of("example/omega")} example/omega: is gone, private or blocked`,
      ].sort(),
    );
    // A repository by the same name that is another one now is unavailable too.
    fake.repos.set("example/beta", { id: 1, files: { "main.tex": invented("altacv") } });
    const again = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      only: of("example/beta"),
      log: (line) => lines.push(line),
    });
    expect(again.states.unavailable).toBe(1);
    expect(lines.at(-1)).toBe(`${of("example/beta")} example/beta: is another repository now`);
  });

  test("marks a file GitHub no longer has unavailable, and refuses a file that differs", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const docs = live(manifest);
    const alpha = docs.find((doc) => doc.repo === "example/alpha");
    const beta = docs.find((doc) => doc.repo === "example/beta");
    const alphaRepo = fake.repos.get("example/alpha");
    const betaRepo = fake.repos.get("example/beta");
    if (!alpha || !beta || !alphaRepo || !betaRepo) throw new Error("the world is not whole");
    // GitHub serves another quilt.cls at alpha's pinned commit, and none of beta's main file.
    alphaRepo.files["quilt.cls"] = "changed since";
    alphaRepo.commit = alpha.commit;
    betaRepo.commit = beta.commit;
    delete betaRepo.files["main.tex"];
    const dir = folder();
    const lines: string[] = [];
    const result = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      log: (line) => lines.push(line),
    });
    expect(result.states).toMatchObject({ fetched: 4, unavailable: 1, mismatch: 1 });
    expect(result.problems.map(({ id, state, path }) => `${id} ${state} ${path}`)).toEqual([
      `${beta.id} unavailable main.tex`,
      `${alpha.id} mismatch quilt.cls`,
    ]);
    expect(existsSync(join(dir, alpha.id, "quilt.cls"))).toBe(false);
    expect(existsSync(join(dir, alpha.id, "cv", "resume.tex"))).toBe(true);
    const entries = report(dir).documents;
    expect(entries.find((entry) => entry.id === alpha.id)).toEqual({
      id: alpha.id,
      repo: alpha.repo,
      commit: alpha.commit,
      state: "mismatch",
      paths: ["quilt.cls"],
    });
    expect(entries.find((entry) => entry.id === beta.id)).toMatchObject({
      state: "unavailable",
      paths: ["main.tex"],
    });
    expect(lines.join("\n")).toContain("quilt.cls is 13 bytes with SHA-256");
    expect(lines.join("\n")).not.toContain("changed since");
  });

  test("reads no more of a file than its recorded size", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const alpha = live(manifest).find((doc) => doc.repo === "example/alpha");
    const alphaRepo = fake.repos.get("example/alpha");
    if (!alpha || !alphaRepo) throw new Error("the world is not whole");
    alphaRepo.files["quilt.cls"] += "x".repeat(10_000);
    alphaRepo.commit = alpha.commit;
    const dir = folder();
    const result = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      only: alpha.id,
      log: quiet,
    });
    expect(
      result.problems.map(({ state, path, message }) => `${state} ${path} ${message}`),
    ).toEqual([`mismatch quilt.cls is over its recorded ${alpha.files[1]?.bytes} bytes`]);
  });

  test("keeps the report's word on a document only while it is about the same repository and commit", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const docs = live(manifest);
    const [first, second] = docs;
    if (!first || !second) throw new Error("the world has too few documents");
    const dir = folder();
    // A report an earlier manifest left: its first id was another repository.
    writeFileSync(
      join(dir, "fetch-report.json"),
      formatJson({
        version: 1,
        documents: [
          { id: first.id, repo: "example/earlier", commit: "c".repeat(40), state: "fetched" },
          { id: second.id, repo: second.repo, commit: second.commit, state: "unavailable" },
        ],
      }),
    );
    await fetchCorpus({ github: fake.client(), manifest, dir, only: docs[4]?.id, log: quiet });
    const pending = ({ id, repo, commit }: LiveDocument) => ({
      id,
      repo,
      commit,
      state: "pending",
    });
    expect(report(dir).documents).toEqual([
      pending(first),
      { id: second.id, repo: second.repo, commit: second.commit, state: "unavailable" },
      pending(docs[2]!),
      pending(docs[3]!),
      { ...pending(docs[4]!), state: "fetched" },
      pending(docs[5]!),
    ]);
    await expect(
      fetchCorpus({ github: fake.client(), manifest, dir, only: "jake-0099", log: quiet }),
    ).rejects.toThrow("the manifest has no document jake-0099");
  });

  test("empties a folder that holds another document's files, and keeps only what the entry names", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const alpha = live(manifest).find((doc) => doc.repo === "example/alpha");
    if (!alpha) throw new Error("the world has no document of example/alpha");
    const dir = folder();
    const at = (...parts: string[]) => join(dir, alpha.id, ...parts);
    const named = [PINNED, ...alpha.files.map((file) => file.path)].sort();
    // Files a document once under the same id left, pinned to its own repository and commit.
    mkdirSync(at("cv"), { recursive: true });
    writeFileSync(at(PINNED), `example/earlier ${"c".repeat(40)}\n`);
    writeFileSync(at("cv", "resume.tex"), "the earlier document's main file");
    writeFileSync(at("stale.tex"), "the earlier document's other file");
    const first = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      only: alpha.id,
      log: quiet,
    });
    expect(first.states.fetched).toBe(1);
    expect(first.downloaded).toBe(alpha.files.length);
    expect(listing(at())).toEqual(named);
    expect(readFileSync(at(PINNED), "utf8")).toBe(`${alpha.repo} ${alpha.commit}\n`);

    // What a stopped run or a hand left goes once every file verifies; what verified stays.
    writeFileSync(at("cv", "resume.tex.0a1b2c3d4e5f.partial"), "a partial write");
    writeFileSync(at("notes.txt"), "put there by hand");
    mkdirSync(at("empty", "deeper"), { recursive: true });
    const second = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      only: alpha.id,
      log: quiet,
    });
    expect(second.downloaded).toBe(0);
    expect(listing(at())).toEqual(named);
    expect(existsSync(at("empty"))).toBe(false);

    // A folder without its marker is taken for another document's, and emptied.
    rmSync(at(PINNED));
    const third = await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      only: alpha.id,
      log: quiet,
    });
    expect(third.downloaded).toBe(alpha.files.length);
  });

  test("skips a withdrawn document, removes its folder, and gives it no entry", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const dir = folder();
    await fetchCorpus({ github: fake.client(), manifest, dir, log: quiet });
    const [first] = live(manifest);
    if (!first) throw new Error("the world has no document");
    const withdrawn: Manifest = {
      ...manifest,
      documents: manifest.documents.map((doc) =>
        doc.id === first.id ? { id: doc.id, family: doc.family, withdrawn: true } : doc,
      ),
    };
    expect(Manifest.safeParse(withdrawn).success).toBe(true);
    const before = fake.requests.length;
    const result = await fetchCorpus({
      github: fake.client(),
      manifest: withdrawn,
      dir,
      log: quiet,
    });
    expect(result.withdrawn).toBe(1);
    expect(result.documents).toBe(5);
    expect(existsSync(join(dir, first.id))).toBe(false);
    expect(report(dir).documents.map((entry) => entry.id)).not.toContain(first.id);
    expect(fake.requests.slice(before).some((url) => url.includes(first.repo))).toBe(false);
  });

  test("writes nothing outside a document's folder, whatever the manifest says, and prints no control character", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const [doc] = live(manifest);
    if (!doc) throw new Error("the world has no document");
    const escaping: LiveDocument = {
      ...doc,
      files: [
        ...doc.files,
        { ...doc.files[0]!, path: "../escaped.tex" },
        { ...doc.files[0]!, path: "cv\u001b[2J.tex" },
      ],
    };
    const dir = folder();
    const lines: string[] = [];
    const result = await fetchCorpus({
      github: fake.client(),
      manifest: { ...manifest, documents: [escaping, { ...doc, id: "../outside" }] },
      dir,
      log: (line) => lines.push(line),
    });
    expect(result.states.failed).toBe(2);
    expect(existsSync(join(dir, "escaped.tex"))).toBe(false);
    expect(existsSync(join(dir, "..", "outside"))).toBe(false);
    expect(lines.filter(controlled)).toEqual([]);
    expect(lines.join("\n")).toContain("cv\\u001b[2J.tex is not a path in the document's folder");
  });
});

describe("the command", () => {
  const SCRIPT = fileURLToPath(new URL("./corpus.ts", import.meta.url));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  test("says how it is run", () => {
    const help = run("--help");
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("pnpm --filter @resume-tools/editor corpus collect | fetch");
  });

  test("refuses what it does not know, before it asks GitHub anything", () => {
    expect(run("survey").stderr).toContain("there is no command survey");
    expect(run("collect", "--only", "jake-0001").stderr).toContain("--only goes with fetch");
    const only = run("fetch", "--only", "jake-9999");
    expect(only.status).toBe(1);
    expect(only.stderr).toContain("the manifest has no document jake-9999");
  });

  test("the committed manifest is one the schema takes, of at least 200 documents", () => {
    const manifest = Manifest.parse(
      JSON.parse(readFileSync(new URL("../corpus/manifest.json", import.meta.url), "utf8")),
    );
    const documents = live(manifest);
    expect(documents.length).toBeGreaterThanOrEqual(200);
    expect(documents.filter((doc) => doc.family === "other").length).toBeGreaterThanOrEqual(60);
  });
});
