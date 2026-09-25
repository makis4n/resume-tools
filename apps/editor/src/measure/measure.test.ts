import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Compiler } from "../editor/compiler";
import { apply, Document, fieldsOf } from "../editor/document";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { CompileResult, DumpResult, EngineSession, Fetched } from "../engine/session";
import type { DrawnPage, FieldLayout, PageField } from "../page/draw";
import { TexLiveIndex } from "../page/texlive";
import { curated } from "../templates/curated";
import { measuredTemplate } from "./MeasurePage";
import {
  editCommand,
  type FirstLoad,
  firstLoad,
  formatLimit,
  LAYOUTS_PER_EDIT,
  longestField,
  measurePackage,
  median,
  meets,
  overlayFonts,
  type PackageNumbers,
  packageTable,
  summaryTable,
  TARGETS,
  table,
  verdicts,
} from "./measure";

/** An invented resume with a text field, a two-run rich field and a short rich field. */
const RESUME = Resume.parse({
  version: 1,
  header: { name: { first: "Ines", last: "Calloway" }, links: [] },
  sections: [
    {
      id: "work",
      kind: "entries",
      role: "experience",
      title: "Experience",
      entries: [
        {
          id: "tern",
          title: "Typesetter at a small press that prints almanacs",
          bullets: [
            { id: "tern-1", text: [{ text: "Set the " }, { text: "quarterly", bold: true }] },
            { id: "tern-2", text: [{ text: "Ran it" }] },
          ],
        },
      ],
    },
  ],
});

const DOC = Document.parse({ version: 1, template: "jake", resume: RESUME, controls: {} });

/** A page that shows only the fields given, with a layout, which is all `longestField` reads. */
const pageShowing = (...ids: string[]) =>
  ({
    fields: new Map<string, PageField>(
      ids.map((id) => [id, { id, glyphs: [], layout: {} as FieldLayout }]),
    ),
  }) as DrawnPage;

describe("median", () => {
  it("takes the middle value, or the mean of the middle two, whatever the order", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it("leaves the values as they were, and refuses none", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
    expect(() => median([])).toThrow("there are no values");
  });
});

describe("meets", () => {
  it("keeps a value under a limit it must stay under, and lets it reach one it may", () => {
    expect(meets(TARGETS.keystroke, 15.9)).toBe(true);
    expect(meets(TARGETS.keystroke, 16)).toBe(false);
    expect(meets(TARGETS.typical, 300)).toBe(true);
    expect(meets(TARGETS.typical, 300.1)).toBe(false);
    expect(meets(TARGETS.firstLoad, 29_999_999)).toBe(true);
    expect(meets(TARGETS.firstLoad, 30e6)).toBe(false);
  });

  it("words each limit as the plan does", () => {
    expect(formatLimit(TARGETS.keystroke)).toBe("under 16 ms");
    expect(formatLimit(TARGETS.typical)).toBe("300 ms");
    expect(formatLimit(TARGETS.slowLaptop)).toBe("under 500 ms");
    expect(formatLimit(TARGETS.firstLoad)).toBe("under 30 MB");
  });
});

describe("editCommand", () => {
  it("retypes a text field's last character, and keeps its length", () => {
    const command = editCommand(DOC, "tern.title");
    expect(command).toEqual({
      type: "text",
      field: "tern.title",
      text: "Typesetter at a small press that prints almanacx",
    });
    const again = editCommand(apply(DOC, command), "tern.title");
    expect(again).toMatchObject({ text: "Typesetter at a small press that prints almanacy" });
  });

  it("retypes the last run of a rich field, keeping its marks and the runs before it", () => {
    expect(editCommand(DOC, "tern-1.text")).toEqual({
      type: "rich",
      field: "tern-1.text",
      runs: [{ text: "Set the " }, { text: "quarterlx", bold: true }],
    });
    // The document's own runs are left as they were.
    expect(fieldsOf(DOC.resume).get("tern-1.text")?.get(DOC.resume)).toEqual([
      { text: "Set the " },
      { text: "quarterly", bold: true },
    ]);
  });

  it("skips the empty runs at a rich field's end", () => {
    const doc = apply(DOC, {
      type: "rich",
      field: "tern-2.text",
      runs: [{ text: "Ran it" }, { text: "", italic: true }],
    });
    expect(editCommand(doc, "tern-2.text")).toMatchObject({
      runs: [{ text: "Ran ix" }, { text: "", italic: true }],
    });
  });

  it("refuses a field the document does not have as text", () => {
    expect(() => editCommand(DOC, "tern.dates")).toThrow("no text or rich field tern.dates");
    expect(() => editCommand(DOC, "nowhere.text")).toThrow("no text or rich field");
  });
});

describe("longestField", () => {
  it("takes the longest rich field the page shows, whatever text fields are longer", () => {
    expect(longestField(RESUME, pageShowing("tern.title", "tern-1.text", "tern-2.text"))).toEqual({
      id: "tern-1.text",
      kind: "rich",
      length: 17,
    });
  });

  it("passes over a field the page does not show", () => {
    expect(longestField(RESUME, pageShowing("tern-2.text"))?.id).toBe("tern-2.text");
  });

  it("falls back to the longest text field, and to nothing", () => {
    expect(longestField(RESUME, pageShowing("header.first", "tern.title"))).toEqual({
      id: "tern.title",
      kind: "text",
      length: 48,
    });
    expect(longestField(RESUME, pageShowing())).toBeUndefined();
  });
});

const read = (paths: [string, number][]): Fetched => ({
  files: paths.length,
  bytes: paths.reduce((sum, [, bytes]) => sum + bytes, 0),
  paths: paths.map(([path]) => path),
});

/** What a step read of nothing. */
const NOTHING = { tex: read([]), fonts: new Map<string, number>() };

describe("firstLoad", () => {
  it("counts every file the first page read, the engine's and the fonts', once each", () => {
    const reads = {
      // The dump's and two compiles' reads, as the scheduler made them, and the fonts': the page's
      // outlines, a metric TeX read too, and a font file read before the compile, as a scheduler
      // that loads a package's declared fonts first reads one.
      open: {
        tex: read([
          ["/a.fmt", 600],
          ["/b.tfm", 20],
          ["/c.sty", 30],
        ]),
        fonts: new Map([
          ["/b.tfm", 20],
          ["/d.pfb", 100],
          ["/e.otf", 900],
        ]),
      },
      overlay: NOTHING,
      // An edit that reads a file the first page did not is no first load's.
      edits: { tex: read([["/f.tfm", 5]]), fonts: new Map() },
    };
    expect(firstLoad({ reads }, { engine: 3000, loader: 30, manifest: 200 })).toEqual({
      engine: 3000,
      loader: 30,
      manifest: 200,
      texLive: 650,
      fonts: 1000,
      total: 4880,
    });
  });

  it("leaves out the fonts the overlay reads when a field opens, and counts them apart", () => {
    const open = { tex: read([["/a.tfm", 20]]), fonts: new Map([["/b.pfb", 100]]) };
    // The overlay reads a variant's metrics and outlines, and one of the page's files again.
    const overlay = {
      tex: read([]),
      fonts: new Map([
        ["/b.pfb", 100],
        ["/c.tfm", 10],
        ["/c.pfb", 90],
      ]),
    };
    const reads = { open, overlay, edits: NOTHING };
    expect(firstLoad({ reads }, { engine: 0, loader: 0, manifest: 0 })).toMatchObject({
      texLive: 20,
      fonts: 100,
      total: 120,
    });
    expect(overlayFonts({ reads })).toEqual({ files: 2, bytes: 100 });
  });
});

describe("the tables", () => {
  const numbers = (id: string, edit: number, keystroke: number): PackageNumbers => ({
    id,
    name: id,
    engine: "pdftex",
    dump: { ms: 300, bytes: 6.7e6, read: read([["/a.fmt", 7.9e6]]) },
    open: { ms: 150, passes: [80, 70], read: read([["/b.tfm", 0.2e6]]) },
    draw: { ms: 80, missingFonts: [] },
    page: { ms: 240 },
    edits: [edit, edit + 10, edit - 10].map((ms) => ({
      ms,
      compileMs: ms - 5,
      drawMs: 3,
      passes: 1,
    })),
    keystroke: { field: "x.text", characters: 245, rows: 3, runs: 30, ms: keystroke },
    reads: { open: NOTHING, overlay: NOTHING, edits: NOTHING },
  });
  const load = (total: number): FirstLoad => ({
    engine: 1,
    loader: 1,
    manifest: 1,
    texLive: 1,
    fonts: 1,
    total,
  });

  it("judges each package against every target, an edit by its median", () => {
    const rows = verdicts([
      { numbers: numbers("fast", 80, 0.1), load: load(20e6) },
      { numbers: numbers("slow", 400, 20), load: load(42e6) },
    ]);
    expect(rows.map((row) => row.target)).toEqual([
      TARGETS.keystroke,
      TARGETS.typical,
      TARGETS.slowLaptop,
      TARGETS.firstLoad,
    ]);
    expect(rows.map((row) => row.values.map((each) => each.met))).toEqual([
      [true, false],
      [true, false],
      [true, true],
      [true, false],
    ]);
    expect(rows[1]?.values.map((each) => each.value)).toEqual([80, 400]);
    const summary = summaryTable(rows);
    expect(summary.split("\n")[0]).toMatch(/^Target +Limit +fast +slow$/);
    expect(summary).toMatch(
      /\nFirst load, cached afterwards +under 30 MB +20\.00 MB met +42\.00 MB missed$/,
    );
  });

  it("lays a package's numbers out a row each", () => {
    const text = packageTable(numbers("fast", 80, 0.1), load(42e6));
    expect(text.split("\n")).toHaveLength(8);
    expect(text).toMatch(/\nFirst page +240 ms +the dump, the compile and the draw/);
    expect(text).toContain("Edit to page, median of 3");
    expect(text).toContain("0.10 ms");
    expect(text).toContain("x.text, 245 characters on 3 lines");
  });

  it("pads every column but the last", () => {
    expect(
      table([
        ["a", "bb", "c"],
        ["ddd", "e", "f"],
      ]),
    ).toBe("a    bb  c\nddd  e   f");
  });
});

describe("measuredTemplate", () => {
  it("reads the package to measure from the location, Jake's Resume for 1", () => {
    expect(measuredTemplate("?measure=1")).toBe("jake");
    expect(measuredTemplate("?measure")).toBe("jake");
    expect(measuredTemplate("?measure=altacv&x=1")).toBe("altacv");
    expect(measuredTemplate("")).toBeUndefined();
    expect(measuredTemplate("?other=1")).toBeUndefined();
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("measurePackage", () => {
  const { package: jake, sample } = curated("jake");
  let numbers: PackageNumbers;
  /** What the session's dumps and compiles brought back, all of them. */
  let results: (DumpResult | CompileResult)[];
  /** Every file the fonts read, by path. */
  let fontFiles: Map<string, number>;
  /** What the measurement asked of the editor's compile scheduler. */
  let opens: Parameters<Compiler["open"]>[];
  let updates: Parameters<Compiler["update"]>[];
  beforeAll(async () => {
    const session: EngineSession = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fontFiles = new Map();
    const tree = {
      index: new TexLiveIndex(manifest),
      read: async (path: string) => {
        const data = readFileSync(join(ENGINE_DIR, "files", path));
        fontFiles.set(path, data.length);
        return data;
      },
    };
    const dumps = vi.spyOn(session, "dump");
    const compiles = vi.spyOn(session, "compile");
    const opened = vi.spyOn(Compiler.prototype, "open");
    const updated = vi.spyOn(Compiler.prototype, "update");
    try {
      numbers = await measurePackage(session, tree, jake, sample, 2);
      // Kept here, since each test starts with the spies' calls cleared.
      opens = [...opened.mock.calls];
      updates = [...updated.mock.calls];
      results = [...dumps.mock.results, ...compiles.mock.results].flatMap((result) =>
        result.type === "return" ? [result.value] : [],
      );
    } finally {
      vi.restoreAllMocks();
    }
  }, 60_000);

  it("opens the sample and edits it through the editor's compile scheduler", () => {
    expect(opens).toHaveLength(1);
    const [pkg, opened] = opens[0] ?? [];
    expect(pkg).toBe(jake);
    expect(opened?.resume).toEqual(sample);
    // Each edit is the document before it with the bullet retyped, which the scheduler compiles.
    const bullet = (doc: Document) => {
      const field = fieldsOf(doc.resume).get("fennel-1.text");
      return field?.kind === "rich"
        ? field
            .get(doc.resume)
            .map((run) => run.text)
            .join("")
        : "";
    };
    // The sample's bullet ends "without help.", and each edit retypes its last character.
    expect(updates.map(([doc]) => bullet(doc).slice(-5))).toEqual(["helpx", "helpy"]);
  });

  it("dumps the format from the stock one, and compiles the sample as a new document", () => {
    expect(numbers).toMatchObject({ id: "jake", name: "Jake's Resume", engine: "pdftex" });
    expect(numbers.dump.bytes).toBeGreaterThan(1e6);
    expect(numbers.dump.read.paths).toContain(
      "/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt",
    );
    expect(numbers.open.passes).toHaveLength(2);
    expect(numbers.open.ms).toBeGreaterThanOrEqual(numbers.open.passes[0] ?? 0);
    expect(numbers.draw.missingFonts).toEqual([]);
  });

  it("edits the longest bullet, each edit compiled once and drawn", () => {
    expect(numbers.edits).toHaveLength(2);
    for (const edit of numbers.edits) {
      expect(edit.passes).toBe(1);
      expect(edit.ms).toBeGreaterThanOrEqual(edit.compileMs + edit.drawMs);
    }
  });

  it("lays the bullet out on the lines the page sets it on", () => {
    expect(numbers.keystroke).toMatchObject({
      field: "fennel-1.text",
      characters: 245,
      rows: 3,
      runs: 2 * LAYOUTS_PER_EDIT,
    });
    expect(numbers.keystroke.ms).toBeGreaterThan(0);
  });

  it("counts under first load every file the engine read, and the fonts' files besides", () => {
    const sizes = { engine: 10, loader: 1, manifest: 2 };
    const load = firstLoad(numbers, sizes);
    // Everything the session read, which for this sample is all read for the first page.
    const tex = results.reduce((sum, result) => sum + result.fetched.bytes, 0);
    expect(load.texLive).toBe(tex);
    expect(numbers.reads.open.tex.bytes).toBe(tex);
    // The page reads Type 1 outlines, which TeX never opens, and TFMs, which it has.
    expect([...numbers.reads.open.fonts.keys()].some((path) => path.endsWith(".pfb"))).toBe(true);
    expect(load.fonts).toBeGreaterThan(0);
    expect(load.fonts).toBeLessThan([...fontFiles.values()].reduce((a, b) => a + b, 0));
    expect(load.total).toBe(13 + tex + load.fonts);
  });

  it("counts under first load the fonts the first page read, and the overlay's apart", () => {
    const load = firstLoad(numbers, { engine: 0, loader: 0, manifest: 0 });
    const names = (files: ReadonlyMap<string, number>) =>
      [...files.keys()].map((path) => path.slice(path.lastIndexOf("/") + 1)).sort();
    // The overlay measures the bullet's bold italic, which no page of the sample sets, in a font of
    // its own, which the app fetches only when the field opens.
    expect(names(numbers.reads.overlay.fonts)).toEqual(["ec-lmbxi10.tfm", "lmbxi10.pfb"]);
    const tex = new Set(numbers.reads.open.tex.paths);
    let page = 0;
    for (const [path, bytes] of numbers.reads.open.fonts) if (!tex.has(path)) page += bytes;
    expect(load.fonts).toBe(page);
    const overlay = [...numbers.reads.overlay.fonts.values()].reduce((a, b) => a + b, 0);
    expect(overlayFonts(numbers)).toEqual({ files: 2, bytes: overlay });
  });
});
