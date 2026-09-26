import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterAll, describe, expect, test } from "vitest";
import type { Intake } from "../src/import/intake";
import type { Reference } from "../src/import/reference";
import { refusal } from "../src/import/refusal";
import type { LiveDocument } from "./corpus-manifest";
import {
  type PoolResult,
  type ReferenceRow,
  referenceTable,
  rowOf,
  runPool,
  stoppedKind,
  uploadOf,
} from "./corpus-reference";

// Every row, document and log here is invented for these tests; SECRET stands for a document's
// text, which nothing the runner prints may show.

const SECRET = "Quillwort";

const row = (
  id: string,
  family: ReferenceRow["family"],
  changes: Partial<ReferenceRow>,
): ReferenceRow => ({
  id,
  family,
  outcome: "reference",
  wall: 1000,
  ...changes,
});

describe("the table", () => {
  const rows: ReferenceRow[] = [
    row("jake-0001", "jake", { engine: "pdftex", source: "pdftex", pages: 1, ms: 100 }),
    row("jake-0002", "jake", {
      engine: "pdftex",
      source: "both",
      pages: 2,
      ms: 300,
      bibliographyLeftOut: true,
    }),
    row("awesome-cv-0001", "awesome-cv", {
      engine: "xetex",
      source: "xetex",
      pages: 3,
      ms: 5000,
      images: { replaced: 1, added: 0, missing: 1, tree: 0, dropped: 0 },
      fonts: { tex: 0, native: 3, shipped: 2 },
    }),
    row("awesome-cv-0002", "awesome-cv", { outcome: "font", name: "Invented Sans" }),
    row("other-0001", "other", { outcome: "package", name: "inventedpkg" }),
    row("other-0002", "other", {
      outcome: "stopped",
      stopped: "an undefined command",
      name: "\\inventedcmd",
    }),
    row("other-0003", "other", { outcome: "timeout" }),
    row("other-0004", "other", { outcome: "intake" }),
  ];
  const table = referenceTable(rows);
  const cells = (label: string) =>
    table
      .split("\n")
      .find((line) => line.startsWith(`| ${label} |`))
      ?.split("|")
      .slice(2, -1)
      .map((cell) => cell.trim());

  test("counts documents per family and in all, by what became of them", () => {
    expect(cells("Documents")).toEqual(["2", "2", "0", "0", "0", "4", "8"]);
    expect(cells("Compiled to a reference")).toEqual(["2", "1", "0", "0", "0", "0", "3"]);
    expect(cells("Refused: a font the tree lacks")?.at(-1)).toBe("1");
    expect(cells("Refused: timed out, past 90 s")?.at(-1)).toBe("1");
    expect(cells("Refused at intake")?.at(-1)).toBe("1");
    expect(cells("Reference of more pages")?.at(-1)).toBe("1");
    expect(cells("Engine: XeTeX")?.at(-1)).toBe("1");
    expect(cells("Bibliography left out")?.at(-1)).toBe("1");
    expect(cells("Images the upload lacked, stood in for at 1 by 1")?.at(-1)).toBe("1");
    expect(cells("Fonts from the upload")?.at(-1)).toBe("1");
  });

  test("gives the median and slowest compile of the references", () => {
    expect(cells("Compile time, median")).toEqual(["200 ms", "5000 ms", "", "", "", "", "300 ms"]);
    expect(cells("Compile time, slowest")?.at(-1)).toBe("5000 ms");
  });

  test("names what the documents were refused for, and what the rest stopped on", () => {
    expect(cells("`Invented Sans`")?.at(-1)).toBe("1");
    expect(cells("`inventedpkg`")?.at(-1)).toBe("1");
    expect(cells("an undefined command")?.at(-1)).toBe("1");
    expect(cells("`\\inventedcmd`")?.at(-1)).toBe("1");
  });

  test("keeps every line one line, whatever a name holds", () => {
    const hostile = referenceTable([
      row("other-0009", "other", { outcome: "class", name: "a\nb\u001b[2J" }),
    ]);
    expect(hostile).not.toContain("\u001b");
    expect(hostile.split("\n").every((line) => line === "" || line.startsWith("|"))).toBe(true);
  });
});

describe("a document's row", () => {
  const intake = {
    engine: "pdftex",
    source: "both",
    main: { path: "cv.tex", text: SECRET, bytes: new Uint8Array() },
    files: {},
    fonts: [],
    images: {
      replaced: [
        { name: "me.jpg", path: "me.jpg", kind: "jpeg" },
        { name: "logo", path: "logo.png", kind: "png", missing: true },
      ],
      dropped: [{ name: "chart.eps", why: "format" }],
    },
    warnings: [],
  } as Intake;

  test("holds numbers and names, never the document's text", () => {
    const made = {
      engine: "pdftex",
      pages: [
        { items: [{ kind: "glyph", font: "cmr10", size: 1, code: 81, text: SECRET, h: 0, v: 0 }] },
      ],
      size: { width: 1, height: 1 },
      fonts: { tex: ["cmr10"], native: [], shipped: [] },
      specials: [],
      warnings: [{ kind: "file", name: "part.tex" }],
      bibliographyLeftOut: false,
      images: [
        { name: "photo", path: "photo.png", kind: "png", missing: true },
        { name: "logo.pdf", path: "logo.pdf", kind: "pdf", tree: true },
      ],
      passes: [60, 40],
      ms: 100.4,
      log: `l.1 ${SECRET}`,
    } as Reference;
    const result = rowOf(intake, made);
    expect(result).toEqual({
      source: "both",
      outcome: "reference",
      engine: "pdftex",
      pages: 1,
      ms: 100,
      passes: 2,
      fonts: { tex: 1, native: 0, shipped: 0 },
      images: { replaced: 2, added: 2, missing: 2, tree: 1, dropped: 1 },
      warnings: 1,
      bibliographyLeftOut: false,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("names a refusal's missing thing as shown, and what kind of error stopped a compile", () => {
    expect(rowOf(intake, refusal("package", "inventedpkg", `l.3 ${SECRET}`))).toMatchObject({
      outcome: "package",
      name: "inventedpkg",
    });
    expect(rowOf(intake, refusal("font", `${SECRET}\u001b`))).toMatchObject({
      name: "(unprintable name)",
    });
    expect(
      rowOf(
        intake,
        refusal("stopped", "\\inventedcmd", `! Undefined control sequence.\nl.3 ${SECRET}`),
      ),
    ).toMatchObject({ outcome: "stopped", name: "\\inventedcmd", stopped: "an undefined command" });
    expect(rowOf(refusal("luatex"))).toEqual({ outcome: "luatex" });
  });

  test("says what kind of error stopped a compile by its words alone", () => {
    expect(stoppedKind(`! Missing $ inserted.\nl.3 ${SECRET}`)).toBe(
      "mathematics outside mathematics",
    );
    expect(stoppedKind(`! LaTeX Error: Environment ${SECRET} undefined.`)).toBe(
      "an undefined environment",
    );
    expect(stoppedKind(`! Package babel Error: Unknown option 'ngerman'.`)).toBe(
      "a language babel lacks",
    );
    expect(stoppedKind(`! ${SECRET} happened.`)).toBe("another TeX error");
    expect(stoppedKind("No pages of output.")).toBe("no pages");
  });
});

describe("a document's zip", () => {
  test("holds its files at their paths, and the tree's file for each font it names that the tree has", () => {
    const doc = {
      id: "other-0001",
      family: "other",
      files: [
        { path: "cv/cv.tex", sha256: "0".repeat(64), bytes: 1 },
        { path: "cv/inventedcv.cls", sha256: "0".repeat(64), bytes: 1 },
      ],
      assets: ["cv/fonts/Invented-Regular.ttf", "cv/fonts/Commercial.otf"],
      images: 2,
    } as unknown as LiveDocument;
    const zip = uploadOf(
      doc,
      (path) => new TextEncoder().encode(`invented ${path}`),
      (name) => (name === "Invented-Regular.ttf" ? new Uint8Array([1, 2, 3]) : undefined),
    );
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      "cv/cv.tex",
      "cv/fonts/Invented-Regular.ttf",
      "cv/inventedcv.cls",
    ]);
    expect([...(files["cv/fonts/Invented-Regular.ttf"] ?? [])]).toEqual([1, 2, 3]);
  });
});

describe("the pool", () => {
  const folder = mkdtempSync(join(tmpdir(), "resume-tools-pool-"));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  /** A child that answers each task with its message doubled, hangs on `hangs` and dies on `dies`. */
  const child = join(folder, "child.mjs");
  writeFileSync(
    child,
    [
      "process.on('message', (task) => {",
      "  if (task.id === 'hangs') { setInterval(() => {}, 1000); return; }",
      "  if (task.id === 'dies') process.exit(3);",
      "  process.send({ type: 'done', id: task.id, doubled: task.message * 2, pid: process.pid });",
      "});",
      "process.send({ type: 'ready' });",
    ].join("\n"),
  );

  test("answers every task, kills a child past the limit, and starts another in its place", async () => {
    const tasks = ["a", "hangs", "b", "dies", "c", "d", "e"].map((id, i) => ({
      id,
      message: () => i,
    }));
    const ended: string[] = [];
    const results = await runPool({
      script: child,
      tasks,
      size: 2,
      limitMs: 1_000,
      onResult: (task) => ended.push(task.id),
    });
    expect([...results.keys()].sort()).toEqual(tasks.map((task) => task.id).sort());
    expect(ended.sort()).toEqual(tasks.map((task) => task.id).sort());
    expect(results.get("hangs")).toMatchObject({ timedOut: true });
    expect(results.get("dies")).toMatchObject({ crashed: true });
    for (const [id, i] of [
      ["a", 0],
      ["b", 2],
      ["c", 4],
      ["d", 5],
      ["e", 6],
    ] as const)
      expect((results.get(id) as PoolResult).reply).toMatchObject({ doubled: i * 2 });
    expect((results.get("hangs") as PoolResult).wall).toBeGreaterThanOrEqual(900);
  }, 30_000);

  test("gives up on a child that cannot start", async () => {
    const broken = join(folder, "broken.mjs");
    writeFileSync(broken, "process.exit(1);");
    await expect(
      runPool({ script: broken, tasks: [{ id: "a", message: () => 0 }], size: 1, limitMs: 1_000 }),
    ).rejects.toThrow("cannot start");
  }, 30_000);
});
