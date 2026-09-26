import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  assetsOf,
  type CollectOptions,
  collect,
  joinPath,
  judgeMain,
  mainOrder,
  resolveReference,
  type Upstream,
} from "./corpus-collect";
import { fetchCorpus } from "./corpus-fetch";
import { type Fetch, GitHub, Limiter, SEARCH_INTERVAL_MS } from "./corpus-github";
import {
  type CorpusDocument,
  FAMILIES,
  type Family,
  FetchReport,
  formatJson,
  isSafePath,
  Manifest,
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

const utf8 = (text: string) => new TextEncoder().encode(text);
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

describe("the manifest", () => {
  const doc = (changes: Partial<CorpusDocument> = {}): CorpusDocument => ({
    id: "jake-0001",
    family: "jake",
    repo: "example/example",
    commit: "a".repeat(40),
    license: null,
    main: "resume.tex",
    files: [{ path: "resume.tex", sha256: "b".repeat(64), bytes: 4321 }],
    assets: ["fonts/Invented-Regular.ttf", "photo.jpg"],
    ...changes,
  });
  const parse = (...documents: CorpusDocument[]) =>
    Manifest.safeParse({ version: 1, collected: "2026-09-26", documents });

  test("takes a document as the brief's example has it", () => {
    expect(
      parse(doc(), doc({ id: "other-0007", family: "other", repo: "example/b" })).success,
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
    ["an asset that is neither font nor image", { assets: ["notes.txt"] }],
    [
      "files over 2 MB",
      { files: [{ path: "resume.tex", sha256: "b".repeat(64), bytes: 2_000_001 }] },
    ],
    ["a repository that is not owner/name", { repo: "example" }],
  ] as const)("refuses %s", (_, changes) => {
    expect(parse(doc(changes as Partial<CorpusDocument>)).success).toBe(false);
  });

  test("refuses an id used twice, and two documents of one repository", () => {
    expect(parse(doc(), doc({ repo: "example/b" })).success).toBe(false);
    expect(parse(doc(), doc({ id: "jake-0002", repo: "Example/Example" })).success).toBe(false);
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
  const resume = invented("article", { body: ["\\section{Education}", "\\section{Skills}"] });

  test("qualifies a whole document of 1 KB to 200 KB in Latin script", () => {
    expect(judgeMain(utf8(resume), known, "example/cv/cv.tex")).toMatchObject({ family: "other" });
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
    expect(judgeMain(utf8(resume), known, "example/thesis/thesis.tex")).toEqual({
      reason: "not-a-resume",
    });
    expect(
      judgeMain(utf8(resume.replace("{article}", "{beamer}")), known, "example/cv/cv.tex"),
    ).toEqual({
      reason: "not-a-resume",
    });
    // A family of its own needs no name.
    expect(judgeMain(utf8(jakeLike()), known, "example/thesis/main.tex")).toMatchObject({
      family: "jake",
    });
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

  test("names the fonts and images beside the main file, and not the document compiled", () => {
    const files = [
      "cv/resume.tex",
      "cv/resume.pdf",
      "cv/photo.JPG",
      "cv/fonts/Invented-Regular.otf",
      "cv/notes.txt",
      "elsewhere.png",
    ];
    expect(assetsOf(files, "cv/resume.tex")).toEqual([
      "cv/fonts/Invented-Regular.otf",
      "cv/photo.JPG",
    ]);
    expect(assetsOf(files, "top.tex")).toEqual([
      "cv/fonts/Invented-Regular.otf",
      "cv/photo.JPG",
      "cv/resume.pdf",
      "elsewhere.png",
    ]);
    const many = Array.from({ length: 250 }, (_, i) => `img/${String(i).padStart(3, "0")}.png`);
    expect(assetsOf(many, "cv.tex")).toHaveLength(200);
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
}

/** GitHub as far as the corpus asks it, over invented repositories, answering an injected fetch. */
class FakeGitHub {
  readonly repos = new Map<string, FakeRepo>();
  readonly search = new Map<string, { repo: string; path: string }[]>();
  readonly forks = new Map<string, string[]>();
  readonly requests: string[] = [];

  head(name: string) {
    return sha1(`${name}:${JSON.stringify(this.repos.get(name)?.files)}`);
  }

  /** A path's content at a ref of a repository: its head, HEAD, or an older version's commit. */
  private contentAt(name: string, ref: string, path: string): string | undefined {
    const repo = this.repos.get(name);
    if (!repo) return undefined;
    if (ref === "HEAD" || ref === this.head(name)) return repo.files[path] ?? repo.links?.[path];
    const versions = repo.history?.[path] ?? [];
    return versions.find((_, i) => sha1(`${name}:${path}:${i}`) === ref);
  }

  readonly fetch: Fetch = async (url) => {
    this.requests.push(url);
    const { host, pathname, searchParams } = new URL(url);
    const json = (body: unknown) => Response.json(body);
    const missing = () => new Response("Not Found", { status: 404 });
    if (host === "raw.githubusercontent.com") {
      const [, owner, name, ref, ...rest] = pathname.split("/");
      const content = this.contentAt(
        `${owner}/${name}`,
        ref ?? "",
        rest.map(decodeURIComponent).join("/"),
      );
      return content === undefined ? missing() : new Response(content);
    }
    if (pathname === "/search/code") {
      const hits = this.search.get(searchParams.get("q") ?? "") ?? [];
      const page = Number(searchParams.get("page"));
      const items = hits
        .slice((page - 1) * 100, page * 100)
        .map((hit) => ({ path: hit.path, repository: { full_name: hit.repo } }));
      return json({ total_count: hits.length, items });
    }
    const [, , owner, name, what, ...rest] = pathname.split("/");
    const full = `${owner}/${name}`;
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
    if (what === undefined)
      return json({
        full_name: full,
        default_branch: "main",
        license: repo.license ? { spdx_id: repo.license } : null,
        ...(repo.source ? { source: { full_name: repo.source } } : {}),
      });
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
    return new GitHub({ fetch: this.fetch, sleep: async () => {}, now: () => 0 });
  }
}

/** A world of invented repositories that covers every way a candidate is taken or refused. */
function world() {
  const fake = new FakeGitHub();
  const resume = (heading: string, extra: string[] = []) =>
    invented("article", { body: [`\\section{${heading}}`, ...extra] });
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
  const alpha = resume("Education", ["\\input{sections/one}"]).replace("{article}", "{quilt}");
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
  fake.repos.set("example/copy", { files: { "resume.tex": alpha.replaceAll("\n", "\r\n") } });
  fake.repos.set("example/delta", { files: { "cv.tex": invented("moderncv", { lines: 31 }) } });
  fake.repos.set("example/epsilon", { files: { "cv.tex": invented("moderncv", { lines: 32 }) } });
  fake.repos.set("example/gamma", { files: { "resume.tex": resume("Education") } });
  fake.repos.set("example/greek", {
    files: { "cv.tex": invented("article", { body: ["αβγδεζηθικλμνξοπρστυφχψω".repeat(20)] }) },
  });
  fake.repos.set("example/letter", { files: { "coverletter.tex": invented("moderncv") } });
  fake.repos.set("example/omega", { files: { "cv.tex": resume("Skills", ["\\section{Awards}"]) } });
  fake.repos.set("example/sections", { files: { "resume-part.tex": "\\section{Education}\n" } });
  fake.repos.set("example/thesis", {
    files: { "thesis.tex": resume("Education", ["\\section{Experience}"]) },
  });
  fake.repos.set("example/tiny", { files: { "cv.tex": invented("article", { lines: 2 }) } });
  fake.repos.set("example/zeta", { files: { "cv.tex": invented("europecv") } });
  const hits = (repo: string, ...paths: string[]) => paths.map((path) => ({ repo, path }));
  fake.search.set("invented query", [
    ...hits("example/upstream", "resume.tex"),
    ...hits("example/alpha", "cv/resume.tex", "cv/sections/one.tex"),
    ...hits("example/beta", "main.tex"),
    ...hits("example/copy", "resume.tex"),
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
    caps: ONE_EACH,
    total: 6,
    ...more,
  };
}

describe("collect", () => {
  test("takes each family's candidates in name order up to its cap, one per repository", async () => {
    const fake = world();
    const lines: string[] = [];
    const saved: number[] = [];
    const result = await collect(
      options(fake, lines, { save: (manifest) => saved.push(manifest.documents.length) }),
    );
    const taken = result.manifest.documents.map((doc) => `${doc.id} ${doc.repo} ${doc.main}`);
    expect(taken).toEqual([
      "other-0001 example/alpha cv/resume.tex",
      "altacv-0001 example/beta main.tex",
      "moderncv-0001 example/delta cv.tex",
      "jake-0001 example/fork-taken resume.tex",
      "europecv-0001 example/zeta cv.tex",
      // awesome-cv has no candidate, so other takes its room from what it passed over.
      "other-0002 example/omega cv.tex",
    ]);
    expect(Manifest.parse(result.manifest)).toEqual(result.manifest);
    expect(saved).toEqual([1, 2, 3, 4, 5, 6]);
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
    expect(result.short).toEqual({ "awesome-cv": 1 });
    expect(result.candidates).toEqual({ search: 15, forks: 4 });

    const [alpha, beta] = result.manifest.documents;
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
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: utf8(content).length,
    });
    expect(alpha?.assets).toEqual(["cv/fonts/Invented-Regular.otf", "cv/photo.jpg"]);
    expect(alpha?.license).toBe("MIT");
    expect(alpha?.commit).toBe(fake.head("example/alpha"));
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

  test("appends to a manifest, keeping its ids, and fills a slot a gone document left", async () => {
    const fake = world();
    const first = await collect(options(fake, []));
    fake.repos.set("example/fork-new", {
      files: { "resume.tex": jakeLike(18) },
      source: "example/upstream",
      fork: { created: "2020-01-01T00:00:00Z", pushed: "2022-01-01T00:00:00Z" },
    });
    fake.repos.set("example/copy-two", {
      files: { "resume.tex": fake.repos.get("example/fork-taken")?.files["resume.tex"] ?? "" },
    });
    fake.forks.set("example/upstream", [
      ...(fake.forks.get("example/upstream") ?? []),
      "example/fork-new",
    ]);
    fake.search.get("invented query")?.push({ repo: "example/copy-two", path: "resume.tex" });

    // Full as it is: nothing is added, and the day it was collected stays.
    const again = await collect(
      options(fake, [], { manifest: first.manifest, today: "2026-10-01" }),
    );
    expect(again.manifest).toEqual(first.manifest);

    // A gone document leaves room in its family for the next candidate, under a new id.
    const lines: string[] = [];
    const refilled = await collect(
      options(fake, lines, {
        manifest: first.manifest,
        unavailable: new Set(["jake-0001"]),
        today: "2026-10-01",
      }),
    );
    expect(refilled.manifest.documents.slice(0, 6)).toEqual(first.manifest.documents);
    expect(refilled.added.map((doc) => `${doc.id} ${doc.repo}`)).toEqual([
      "jake-0002 example/fork-new",
    ]);
    expect(refilled.manifest.collected).toBe("2026-10-01");
    // The copy of a main file the manifest has already is a duplicate, though collected before.
    expect(refilled.rejected.duplicate).toBe(2);
  });

  test("stops at the total, and leaves the rest unconsidered", async () => {
    const fake = world();
    const result = await collect(options(fake, [], { total: 2 }));
    expect(result.manifest.documents.map((doc) => doc.id)).toEqual(["other-0001", "altacv-0001"]);
    expect(result.left).toBeGreaterThan(0);
  });
});

describe("the GitHub client", () => {
  const client = (fetch: Fetch, waits: number[] = [], now = () => 0) =>
    new GitHub({ fetch, token: "invented-token", sleep: async (ms) => void waits.push(ms), now });
  const repository = { full_name: "example/example", default_branch: "main", license: null };

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
    expect(await github.repository("example/example")).toEqual({
      repo: "example/example",
      defaultBranch: "main",
      license: null,
    });
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

  test("does not ask again for what is gone", async () => {
    let calls = 0;
    const github = client(async () => {
      calls++;
      return new Response("", { status: 404 });
    });
    expect(await github.repository("example/gone")).toBeUndefined();
    expect(await github.file("example/gone", "a".repeat(40), "cv.tex")).toBeUndefined();
    expect(calls).toBe(2);
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
          throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
        return new Response("Invented.");
      },
    });
    const bytes = await github.file("example/example", "a".repeat(40), "a folder/cv.tex");
    expect(new TextDecoder().decode(bytes)).toBe("Invented.");
    const last = seen.at(-1);
    expect(last?.url).toBe(
      `https://api.github.com/repos/example/example/contents/a%20folder/cv.tex?ref=${"a".repeat(40)}`,
    );
    expect(last?.headers.Accept).toBe("application/vnd.github.raw+json");
    expect(last?.headers.Authorization).toBe("Bearer invented-token");
    expect(seen.filter((each) => each.url.startsWith("https://raw.")).length).toBe(4);
    // Once is enough to know the host is out of reach.
    await github.file("example/example", "a".repeat(40), "cv.tex");
    expect(seen.filter((each) => each.url.startsWith("https://raw.")).length).toBe(4);
    expect(lines.join("\n")).toContain("ENOTFOUND");
    expect(lines.join("\n")).not.toContain("invented-token");
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

  test("writes every file that verifies, and a second run downloads nothing", async () => {
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
    const files = manifest.documents.flatMap((doc) => doc.files);
    expect(first.states).toMatchObject({ fetched: 6, unavailable: 0, mismatch: 0, failed: 0 });
    expect(first.files).toBe(files.length);
    expect(first.downloaded).toBe(files.length);
    expect(readFileSync(join(dir, "other-0001", "quilt.cls"), "utf8")).toBe(
      fake.repos.get("example/alpha")?.files["quilt.cls"],
    );
    expect(report(dir).documents.map((doc) => doc.state)).toEqual(Array(6).fill("fetched"));
    expect(lines).toEqual([]);

    const before = fake.requests.length;
    const second = await fetchCorpus({ github: fake.client(), manifest, dir, log: () => {} });
    expect(second.downloaded).toBe(0);
    expect(fake.requests.length).toBe(before);

    // A file changed on disk is downloaded again.
    writeFileSync(join(dir, "other-0001", "quilt.cls"), "tampered");
    const third = await fetchCorpus({ github: fake.client(), manifest, dir, log: () => {} });
    expect(third.downloaded).toBe(1);
    expect(readFileSync(join(dir, "other-0001", "quilt.cls"), "utf8")).not.toBe("tampered");
  });

  test("marks a document whose repository is gone unavailable, and refuses a file that differs", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    fake.repos.delete("example/beta");
    const alpha = fake.repos.get("example/alpha");
    if (alpha) alpha.files["quilt.cls"] = "changed since";
    // The fake serves the changed file at the pinned commit, as a host serving the wrong bytes would.
    const pinned = fake.head.bind(fake);
    fake.head = (name) =>
      name === "example/alpha" ? (manifest.documents[0]?.commit ?? "") : pinned(name);
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
      "altacv-0001 unavailable main.tex",
      "other-0001 mismatch quilt.cls",
    ]);
    expect(existsSync(join(dir, "other-0001", "quilt.cls"))).toBe(false);
    expect(existsSync(join(dir, "other-0001", "cv", "resume.tex"))).toBe(true);
    expect(report(dir).documents.slice(0, 2)).toEqual([
      { id: "other-0001", state: "mismatch", paths: ["quilt.cls"] },
      { id: "altacv-0001", state: "unavailable", paths: ["main.tex"] },
    ]);
    expect(lines.join("\n")).toContain("quilt.cls is 13 bytes with SHA-256");
    expect(lines.join("\n")).not.toContain("changed since");
  });

  test("fetches one document with --only, and keeps what the report said of the others", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const dir = folder();
    await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      only: "europecv-0001",
      log: () => {},
    });
    expect(report(dir).documents.map((doc) => doc.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "fetched",
      "pending",
    ]);
    fake.repos.delete("example/delta");
    await fetchCorpus({
      github: fake.client(),
      manifest,
      dir,
      only: "moderncv-0001",
      log: () => {},
    });
    expect(report(dir).documents.map((doc) => doc.state)).toEqual([
      "pending",
      "pending",
      "unavailable",
      "pending",
      "fetched",
      "pending",
    ]);
    await expect(
      fetchCorpus({ github: fake.client(), manifest, dir, only: "jake-0099", log: () => {} }),
    ).rejects.toThrow("the manifest has no document jake-0099");
  });

  test("writes nothing outside a document's folder, whatever the manifest says", async () => {
    const fake = world();
    const { manifest } = await collect(options(fake, []));
    const [doc] = manifest.documents;
    if (!doc) throw new Error("the world has no document");
    const escaping = {
      ...doc,
      files: [...doc.files, { ...doc.files[0]!, path: "../escaped.tex" }],
    };
    const dir = folder();
    mkdirSync(dir, { recursive: true });
    const result = await fetchCorpus({
      github: fake.client(),
      manifest: { ...manifest, documents: [escaping] },
      dir,
      log: () => {},
    });
    expect(result.states.failed).toBe(1);
    expect(existsSync(join(dir, "escaped.tex"))).toBe(false);
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
    expect(manifest.documents.length).toBeGreaterThanOrEqual(200);
    expect(
      manifest.documents.filter((doc) => doc.family === "other").length,
    ).toBeGreaterThanOrEqual(60);
  });
});
