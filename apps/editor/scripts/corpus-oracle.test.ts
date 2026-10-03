import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { lockedWordsOf } from "../src/editor/Panel";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import type { GlyphOwner } from "../src/import/assemble";
import { readTree } from "../src/import/fonts";
import { treeImages } from "../src/import/intake";
import { type ReferencePage, readOutput, TOLERANCE } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { reportOfImport, summaryOf } from "../src/import/report";
import { type Imported, importResume, type NameRequest } from "../src/import/run";
import { nameOnService } from "../src/import/service";
import { drawPages, type GlyphBox } from "../src/page/draw";
import { FontLibrary } from "../src/page/fonts";
import { lockedSets, lockMarker } from "../src/page/locked";
import { TexLiveIndex } from "../src/page/texlive";
import { handleName, LIMITS, type NameDeps, type ServiceCache } from "../src/service/name";
import { MemoryPreambleCache } from "../src/service/preamble";
import { MemoryRateStore } from "../src/service/rate";
import { generateBody, generateFormat } from "../src/templates/generate";
import { fontFeatures } from "../src/templates/package";
import { glyphKey, INCH } from "../src/tex/svg";
import { CHECKS } from "../src/validate/harness";
import { Manifest, parseJson } from "./corpus-manifest";
import {
  compare,
  ORACLE_DIR,
  ORACLE_FILE,
  Oracle,
  type OracleDocument,
  oracleDocument,
  oracleManifest,
  oracleTable,
} from "./corpus-oracle";
import type { ProbeRow } from "./corpus-probe";
import { uploadOf } from "./corpus-reference";

// The sample and the row here are invented for these tests; the oracle's own file names the three
// upstream samples by their repositories, commits and hashes, never their text.

const invented: OracleDocument = {
  id: "jake-0000",
  family: "jake",
  repo: "invented/resume",
  repoId: 1,
  commit: "a".repeat(40),
  license: "MIT",
  main: "resume.tex",
  files: [{ path: "resume.tex", sha256: "b".repeat(64), bytes: 10 }],
  images: 0,
  expected: [
    { macro: "inventedentry", argument: 1, port: "marks", expected: "editable", why: "Invented." },
    {
      macro: "inventedentry",
      argument: 2,
      port: "marks",
      expected: "twice",
      or: ["vanished"],
      why: "Invented.",
    },
    { macro: "inventedphoto", argument: 1, port: "omits", expected: "locked", why: "Invented." },
    {
      macro: "inventedmissing",
      argument: 1,
      port: "marks",
      expected: "editable",
      why: "Invented.",
    },
    { standard: "item", port: "marks", expected: "editable", why: "Invented." },
  ],
};

const found: ProbeRow = {
  id: "jake-0000",
  family: "jake",
  outcome: "probed",
  arguments: [
    {
      of: "call",
      name: "inventedentry",
      index: 1,
      calls: 3,
      verdict: "moved",
      counts: { editable: 2, moved: 1 },
    },
    {
      of: "call",
      name: "inventedentry",
      index: 2,
      calls: 1,
      verdict: "vanished",
      counts: { vanished: 1 },
    },
    {
      of: "call",
      name: "inventedphoto",
      index: 1,
      calls: 1,
      verdict: "breaks",
      counts: { breaks: 1 },
    },
    {
      of: "call",
      name: "inventedextra",
      index: 1,
      calls: 1,
      verdict: "editable",
      counts: { editable: 1 },
    },
  ],
  standard: { item: { total: 2, editable: 2, verdict: "editable" } },
  wall: 1000,
};

describe("the oracle", () => {
  test("names the three launch templates' samples, each file with its hash, and what to expect", () => {
    const oracle = parseJson(Oracle, readFileSync(ORACLE_FILE, "utf8"), ORACLE_FILE);
    expect(oracle.documents.map((doc) => [doc.id, doc.repo])).toEqual([
      ["jake-0000", "jakegut/resume"],
      ["altacv-0000", "liantze/AltaCV"],
      ["awesome-cv-0000", "posquit0/Awesome-CV"],
    ]);
    for (const doc of oracle.documents) {
      expect(doc.expected.length).toBeGreaterThan(5);
      // An argument is listed once.
      const keys = doc.expected.map(
        (each) => `${each.macro ?? each.environment ?? each.standard} ${each.argument ?? ""}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
    // As a manifest, the oracle is one `corpus fetch` takes: a document it makes a folder for, with
    // no fonts, whose files are paths it writes. AltaCV's sample inputs a `.cfg`, which the corpus's
    // own manifest does not collect, so the oracle's documents are checked as a fetch needs them.
    const manifest = oracleManifest(oracle, "2026-09-27");
    for (const doc of manifest.documents) {
      expect(doc.id).toMatch(/^[a-z]+(?:-[a-z]+)*-\d{4}$/);
      expect(doc).toMatchObject({ assets: [] });
      expect(
        Manifest.shape.documents.safeParse([
          {
            ...doc,
            files: doc.withdrawn ? [] : doc.files.filter((file) => !file.path.endsWith(".cfg")),
          },
        ]).success,
      ).toBe(true);
    }
  });

  test("refuses an entry that names no argument, or two subjects", () => {
    const entry = { port: "marks", expected: "editable", why: "Invented." };
    const bad = (expected: object) =>
      Oracle.safeParse({ version: 1, documents: [{ ...invented, expected: [expected] }] }).success;
    expect(bad({ ...entry, macro: "inventedentry" })).toBe(false);
    expect(bad({ ...entry, macro: "inventedentry", standard: "item" })).toBe(false);
    expect(bad({ ...entry, standard: "item", argument: 1 })).toBe(false);
    expect(bad({ ...entry, macro: "inventedentry", argument: 1 })).toBe(true);
  });

  test("compares expected verdicts with found ones, one line each, and lists what it does not name", () => {
    const lines = compare(invented, found);
    expect(
      lines.map(({ subject, expected, found: got, agrees }) => ({
        subject,
        expected,
        got,
        agrees,
      })),
    ).toEqual([
      {
        subject: "\\inventedentry #1",
        expected: "editable",
        got: "moved (1 of 3; 2 editable)",
        agrees: false,
      },
      {
        subject: "\\inventedentry #2",
        expected: "twice or vanished",
        got: "vanished (1 of 1)",
        agrees: true,
      },
      { subject: "\\inventedphoto #1", expected: "locked", got: "breaks (1 of 1)", agrees: true },
      { subject: "\\inventedmissing #1", expected: "editable", got: "absent", agrees: false },
      {
        subject: "item (standard)",
        expected: "editable",
        got: "editable (2 of 2 editable)",
        agrees: true,
      },
      {
        subject: "\\inventedextra #1",
        expected: "not in the oracle",
        got: "editable (1 of 1)",
        agrees: false,
      },
    ]);
    expect(oracleTable(lines)).toContain("Disagreements: 3 of 6.");
    expect(oracleTable(lines)).toContain(
      "| jake | `\\inventedphoto #1` | omits | locked | breaks (1 of 1) | agrees |",
    );
    // With no probe, every line disagrees.
    expect(compare(invented, undefined).every((line) => !line.agrees)).toBe(true);
    expect(oracleDocument(invented)).not.toHaveProperty("expected");
  });
});

/** Whether this machine has fetched the oracle's samples, which `corpus oracle` fetches. */
const fetched = existsSync(join(ORACLE_DIR, "jake-0000", "resume.tex"));

/**
 * Each upstream sample's words as item 13's report reads them from its page (decision 0039): those
 * editable on the page, those the side panel alone edits, the resume's in all, and the template's
 * own. They are the hand counts of each page (decision 0039, 2026-10-03), two routes reconciled,
 * which the report matches; the test holds it to them within two words.
 */
const SAMPLE_COUNTS: Readonly<
  Record<
    string,
    { editable: number; panel: number; body: number; template: number; outcome: string }
  >
> = {
  "jake-0000": { editable: 323, panel: 0, body: 389, template: 0, outcome: "partial" },
  "altacv-0000": { editable: 67, panel: 0, body: 232, template: 0, outcome: "partial" },
  "awesome-cv-0000": { editable: 1023, panel: 9, body: 1287, template: 0, outcome: "partial" },
};

/** The committed answers, which the naming route reads first. */
const answers = fileURLToPath(new URL("../corpus/answers/", import.meta.url));
const committed: ServiceCache = {
  get: (key) => {
    const path = join(answers, `${key}.json`);
    return /^[0-9a-f]{64}$/.test(key) && existsSync(path) ? readFileSync(path, "utf8") : undefined;
  },
  put: () => false,
};
const service: NameDeps = {
  cache: committed,
  preambles: new MemoryPreambleCache(),
  model: undefined,
  rates: new MemoryRateStore(),
  limits: LIMITS,
  now: Date.now,
  address: "127.0.0.1",
};
/** The naming step as the dev server answers it with no key: the committed answers alone. */
const naming: NameRequest = (request, names, signal) =>
  nameOnService(
    request,
    (input, init) => handleName(new Request(new URL(input, "http://localhost"), init), service),
    signal,
    names,
  );

/** The engine's tree, as the page and the import read it. */
const engineManifest = () =>
  JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest;

/** The fonts the page is drawn with, from the engine's tree. */
const engineFonts = (manifest: EngineManifest) =>
  new FontLibrary(new TexLiveIndex(manifest), async (path) =>
    readFileSync(join(ENGINE_DIR, "files", path)),
  );

/** Each sample's import, made once for the tests that read it. */
const imports = new Map<string, Promise<Imported>>();

/**
 * An upstream sample imported as the browser imports a resume, through `importResume` on a session
 * of its own, the committed answers naming its macros; once, however many tests read it.
 */
function importedSample(id: string): Promise<Imported> {
  const made = imports.get(id);
  if (made !== undefined) return made;
  const importing = (async () => {
    const oracle = Oracle.parse(JSON.parse(readFileSync(ORACLE_FILE, "utf8")));
    const doc = oracle.documents.find((each) => each.id === id);
    if (doc === undefined) throw new Error(`${id} is no oracle sample`);
    const manifest = engineManifest();
    const zip = uploadOf(
      oracleDocument(doc),
      (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
      () => undefined,
    );
    const outcome = await importResume([{ name: `${id}.zip`, bytes: zip }], {
      session: await startNodeSession(),
      fonts: engineFonts(manifest),
      tree: readTree(manifest.files, manifest.fonts),
      treeImage: treeImages(
        manifest.files,
        (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
      ),
      name: naming,
    });
    if (isRefusal(outcome)) throw new Error(`${id} refused: ${outcome.reason}`);
    return outcome;
  })();
  imports.set(id, importing);
  return importing;
}

describe.skipIf(!fetched || !engineAvailable())(
  "the report on the oracle's samples (decision 0039)",
  () => {
    for (const [id, counts] of Object.entries(SAMPLE_COUNTS))
      test(`reads ${id}'s words within two of its counts, and shows no command`, async () => {
        const report = reportOfImport(await importedSample(id));
        // Numbers alone in what fails: a sample's text never reaches the test's output.
        expect(Math.abs(report.words.editable - counts.editable), "editable").toBeLessThanOrEqual(
          2,
        );
        expect(Math.abs(report.words.panel - counts.panel), "the side panel's").toBeLessThanOrEqual(
          2,
        );
        expect(Math.abs(report.words.body - counts.body), "the resume's").toBeLessThanOrEqual(2);
        expect(
          Math.abs(report.words.template - counts.template),
          "the template's",
        ).toBeLessThanOrEqual(2);
        expect(report.outcome).toBe(counts.outcome);
        const strings = [
          summaryOf(report),
          ...report.locked.flatMap((each) => [each.words, each.why]),
          ...report.dropped.map((each) => each.text),
          ...report.notes,
        ];
        expect(strings.filter((each) => /[\\{}]/.test(each)).length, "a backslash or a brace").toBe(
          0,
        );
      }, 300_000);
  },
);

/** The harness's checks, by name, which an import's findings hold beside the checks' own. */
const HARNESS: ReadonlySet<string> = new Set(CHECKS);

/** A page's glyphs, as a glyph stream holds them. */
const glyphsOf = (page: ReferencePage | undefined) =>
  (page?.items ?? []).flatMap((item) => (item.kind === "glyph" ? [item] : []));

/**
 * Milestone 3 item 15's done-test (decision 0041): every part an upstream sample's import keeps as
 * the upload wrote it, a locked section between its two lock markers, set where the sample's
 * reference set it, glyph for glyph, as decision 0025's test holds for invented parts; read by the
 * page as the part's only where the import's own reading of the original gives it to no field and
 * no other part; drawn so on the editor's page; named in the side panel by item 13's report; and
 * the harness passing on the package that holds them. Numbers, and the names of the harness's
 * checks, alone in what fails: a sample's text never reaches the test's output, nor does a
 * compile's message, which may quote it.
 */
describe.skipIf(!fetched || !engineAvailable())(
  "the oracle's samples' locked parts, on the page (decision 0041)",
  () => {
    let session: EngineSession;
    let fonts: FontLibrary;
    beforeAll(async () => {
      session = await startNodeSession();
      fonts = engineFonts(engineManifest());
    }, 60_000);

    for (const id of Object.keys(SAMPLE_COUNTS))
      test(`draws ${id}'s locked parts where its reference drew them, and the harness passes`, async () => {
        const done = await importedSample(id);
        const { package: pkg, document, job, report } = done;
        // The regenerated body sets the reference's glyph stream: the import's first check.
        expect(report.checks.outcome, "the first check").toBe("assembled");
        // The harness, on the package and the document as they stand, locked parts and all, finds
        // nothing but Awesome-CV's entries' titles, set in small capitals, which its PDF's text
        // gives in capitals (decision 0026).
        const harness = [...new Set(report.checks.findings.map((each) => each.check))].filter(
          (check) => HARNESS.has(check),
        );
        expect(harness, "the harness's findings").toEqual(id === "awesome-cv-0000" ? ["pdf"] : []);

        // The document as the editor compiles it: from its package's format, in the editor's job,
        // given what the import keeps for its compiles (`Compiler`, decision 0038).
        const format = generateFormat(pkg, document.controls);
        const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
        expect(dumped.ok, "the package's format dumps").toBe(true);
        const body = generateBody(pkg, document.resume, document.controls);
        const files = { ...job.files, ...(job.bbl === undefined ? {} : { "doc.bbl": job.bbl }) };
        const result = session.compile(pkg.engine, format.name, body.latex, {
          job: "doc",
          maxPasses: 3,
          files,
        });
        session.forget("doc");
        session.dropFormat(pkg.engine, format.name);
        const output = result.output;
        if (!result.ok || output === undefined) throw new Error(`${id}'s document did not compile`);
        const { stream, doc } = await readOutput(fonts, output);
        const { reference } = report;
        expect(
          stream.pages.map((page) => glyphsOf(page).length),
          "glyphs on each page",
        ).toEqual(reference.pages.map((page) => glyphsOf(page).length));

        // Every part the document keeps stands between its start and its end, each written once.
        // The output sets a part's end before its start only where it sets the source out of its
        // order, as AltaCV's paracol sets its two columns, and the page keeps nothing of that part.
        const parts = document.resume.sections.flatMap((section) =>
          section.kind === "locked" ? [section.id] : [],
        );
        expect(parts.length, "parts kept").toBeGreaterThan(0);
        // Each part's markers in the output's order, an end as true.
        const order = new Map<string, boolean[]>();
        for (const page of doc.pages)
          for (const item of page.items) {
            const marker = item.kind === "special" ? lockMarker(item.text) : undefined;
            if (marker !== undefined)
              order.set(marker.id, [...(order.get(marker.id) ?? []), marker.end]);
          }
        expect(
          parts.filter((part) => [...(order.get(part) ?? [])].sort().join() !== "false,true")
            .length,
          "parts without one start and one end",
        ).toBe(0);
        expect(order.size, "markers of parts the document does not keep").toBe(parts.length);
        const disordered = parts.filter((part) => order.get(part)?.[0] === true);
        expect(disordered.length > 0, "parts set out of order").toBe(id === "altacv-0000");

        // Each glyph the page reads as a part's, between its markers (`lockedSets`), is the
        // reference's glyph at its place in the stream: its font's same character, set where the
        // reference set it, to within the comparison's tolerance.
        const sets = lockedSets(doc);
        const places = doc.pages.map((page) => {
          const at = new Map<string, number>();
          let count = 0;
          page.items.forEach((item, index) => {
            if (item.kind === "glyph") at.set(glyphKey(index), count++);
            else if (item.kind === "native")
              item.glyphs.forEach((_, glyph) => at.set(glyphKey(index, glyph), count++));
          });
          return at;
        });
        const glyphsOfPart = (part: string) =>
          (sets.get(part)?.items ?? []).flatMap((each) => {
            const at = places[each.page]?.get(glyphKey(each.item, each.glyph));
            return each.kind === "glyph" && at !== undefined ? [{ page: each.page, at }] : [];
          });
        let kept = 0;
        let away = 0;
        for (const part of parts)
          for (const { page, at } of glyphsOfPart(part)) {
            kept++;
            const own = glyphsOf(stream.pages[page])[at];
            const theirs = glyphsOf(reference.pages[page])[at];
            const same =
              own !== undefined &&
              theirs !== undefined &&
              own.font === theirs.font &&
              own.code === theirs.code &&
              Math.abs(own.h - theirs.h) <= TOLERANCE &&
              Math.abs(own.v - theirs.v) <= TOLERANCE;
            if (!same) away++;
          }
        expect(kept, "glyphs in kept parts").toBeGreaterThan(0);
        expect(away, "kept glyphs set away from the reference's").toBe(0);

        // And none of them is, by the import's own reading of the original's page, which sets each
        // run of its glyphs down to what in the source sets it (`AssemblyChecks.owners`), another
        // section's or entry's: a field of one, a part one keeps, or another locked section. What a
        // macro the part calls sets of the header, as a class's header macro sets what the header
        // stored, its fields, its links' labels and what it keeps, is the header's wherever it
        // stands, and the page's lock leaves a field of it to the field.
        const owner = reference.pages.map(
          (page) => new Array<GlyphOwner | undefined>(glyphsOf(page).length),
        );
        for (const run of report.checks.owners ?? []) {
          const row = owner[run.page];
          for (let at = Math.max(0, run.from); row && at < Math.min(run.to, row.length); at++)
            row[at] = run;
        }
        const labels = new Set(document.resume.header.links.map((link) => `${link.id}.label`));
        /** Whether a run is the header's: a field of it or of its links, or a part it keeps. */
        const ofHeader = (run: GlyphOwner) =>
          run.field !== undefined
            ? run.field.startsWith("header.") || labels.has(run.field)
            : run.part !== undefined && report.locked[run.part]?.kind === "header";
        /** Whether a run is set by the locked section `part`: its own part, kept under no key. */
        const ownedBy = (run: GlyphOwner, part: string) => {
          const kept = run.part === undefined ? undefined : report.locked[run.part];
          return kept?.kind === "section" && kept.key === undefined && kept.node === part;
        };
        let foreign = 0;
        for (const part of parts)
          for (const { page, at } of glyphsOfPart(part)) {
            const run = owner[page]?.[at];
            if (run === undefined || ofHeader(run) || ownedBy(run, part)) continue;
            if (run.field !== undefined || run.part !== undefined) foreign++;
          }
        expect(foreign, "kept glyphs the import gives to a section's or an entry's").toBe(0);

        // The editor's pages, as the compiler draws them, every one of them (decision 0046): as
        // many as the reference's; each glyph on each page drawn where the reference set a glyph
        // of its font on that page; each kept glyph the part's; every part a region of its own on
        // each page, shown in blocks where it has a glyph there; and on the last page a field the
        // overlay opens in place, as on the first.
        const pages = await drawPages(output, fonts, body.texts, { features: fontFeatures(pkg) });
        expect(pages.length, "pages drawn").toBe(reference.pages.length);
        const sameAt = (each: { h: number; v: number }, glyph: GlyphBox) =>
          Math.abs(INCH + each.h / 65536 - glyph.x) < 0.01 &&
          Math.abs(INCH + each.v / 65536 - glyph.y) < 0.01;
        for (const [index, page] of pages.entries()) {
          const theirs = glyphsOf(reference.pages[index]);
          const onPage = (part: string) => glyphsOfPart(part).filter((each) => each.page === index);
          const drawnAway = page.glyphs.filter(
            (glyph) => !theirs.some((each) => each.font === glyph.font && sameAt(each, glyph)),
          );
          expect(
            drawnAway.length,
            `page ${index + 1}'s glyphs drawn away from the reference's`,
          ).toBe(0);
          expect(page.glyphs.length, `page ${index + 1}'s glyphs drawn`).toBeGreaterThan(
            theirs.length * 0.95,
          );
          const drawn = page.glyphs.filter((glyph) => glyph.locked !== undefined);
          expect(drawn.length, `kept glyphs page ${index + 1} draws`).toBe(
            parts.reduce((sum, part) => sum + onPage(part).length, 0),
          );
          expect([...page.locked.keys()].sort(), "the page's parts").toEqual([...parts].sort());
          expect(
            [...page.locked.values()].filter(
              (region) => onPage(region.id).length > 0 && region.blocks.length === 0,
            ).length,
            `parts on page ${index + 1} with no block`,
          ).toBe(0);
        }
        const last = pages.at(-1);
        expect(
          [...(last?.fields.values() ?? [])].filter(
            (field) => field.glyphs.length > 0 && field.layout !== undefined,
          ).length,
          "fields the last page opens in place",
        ).toBeGreaterThan(0);

        // The side panel names each part that sets a word, as the report does (`lockedWordsOf`).
        const names = lockedWordsOf(reportOfImport(done));
        const setsWords = (part: string) =>
          glyphsOfPart(part).some(({ page, at }) =>
            /[\p{L}\p{N}]/u.test(glyphsOf(stream.pages[page])[at]?.text ?? ""),
          );
        expect(
          parts.filter((part) => setsWords(part) && !names.has(part)).length,
          "parts that set a word and have no name",
        ).toBe(0);
        expect([...names.keys()].filter((part) => !parts.includes(part)).length).toBe(0);
        expect(
          [...names.values()].filter((name) => /[\\{}]/.test(name)).length,
          "a backslash or a brace",
        ).toBe(0);
      }, 300_000);
  },
);
