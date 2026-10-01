import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { readTree } from "./fonts";
import { standIn } from "./images";
import { decodeText, type Intake, intake } from "./intake";
import { IMPORT_JOB, reference } from "./reference";
import { isRefusal } from "./refusal";
import { plainPath, plainStandIns } from "./standins";

// Every upload here is invented for these tests: an invented document and invented images, whose
// names hold a space and an accent, as a person's photo's may.

/** A blank PNG of 40 by 20 pixels, as an upload's picture, which the intake stands in for. */
const PICTURE = standIn({ kind: "png", width: 40, height: 20, xdpi: 72, ydpi: 72 });

/** An invented document that shows a picture by `name`, after the preamble lines given. */
const shows = (name: string, ...preamble: string[]) =>
  [
    "\\documentclass{article}",
    "\\usepackage{graphicx}",
    ...preamble,
    "\\begin{document}",
    "Invented words beside an invented picture.",
    `\\includegraphics{${name}}`,
    "\\end{document}",
    "",
  ].join("\n");

/** The intake of an invented zip, which must be taken. */
function taken(files: Record<string, string | Uint8Array>): Intake {
  const zipped = Object.fromEntries(
    Object.entries(files).map(([name, data]) => [
      name,
      typeof data === "string" ? strToU8(data) : data,
    ]),
  );
  const result = intake({ name: "invented.zip", bytes: zipSync(zipped) });
  if (isRefusal(result)) throw new Error(`refused: ${result.message}`);
  return result;
}

describe("plainPath", () => {
  test("takes a letter's accents off, and makes every other character past the plain ones a dash", () => {
    expect(plainPath("Fotos/Café au lait")).toBe("Fotos/Cafe-au-lait");
    expect(plainPath("img/Ærø 1.png")).toBe("img/-r--1.png");
    expect(plainPath("plain_name-1.png")).toBe("plain_name-1.png");
  });
});

describe("plainStandIns", () => {
  test("copies a stand-in with a space and an accent in its name to a plain path, and names the copy", () => {
    const before = taken({
      "cv.tex": shows("Fotos/Café au lait"),
      "Fotos/Café au lait.png": PICTURE,
    });
    expect(before.images.replaced.map((image) => image.path)).toEqual(["Fotos/Café au lait.png"]);
    const after = plainStandIns(before);
    // The copy, and its size for pdfTeX's graphicx, at the plain path; the stand-in stays at the
    // document's own name for it, beside it.
    expect(after.files["Fotos/Cafe-au-lait.png"]).toEqual(before.files["Fotos/Café au lait.png"]);
    expect(after.files["Fotos/Café au lait.png"]).toEqual(before.files["Fotos/Café au lait.png"]);
    expect(decodeText(after.files["Fotos/Cafe-au-lait.xbb"] ?? new Uint8Array())).toBe(
      decodeText(before.files["Fotos/Café au lait.xbb"] ?? new Uint8Array()),
    );
    expect(after.images.replaced).toEqual([
      { name: "Fotos/Café au lait.png", path: "Fotos/Cafe-au-lait.png", kind: "png" },
    ]);
    // The document names the copy, and nothing else of it changed.
    expect(after.main.text).toBe(shows("Fotos/Cafe-au-lait"));
    expect(decodeText(after.main.bytes)).toBe(after.main.text);
    expect(after.warnings.at(-1)).toContain("is shown from a copy named Fotos/Cafe-au-lait.png");
  });

  test("follows a name through `\\graphicspath`, keeps its extension as given, and finds a free path", () => {
    const before = taken({
      "cv.tex": shows("Café au lait.PNG", "\\graphicspath{{Fotos/}}"),
      "Fotos/Café au lait.PNG": PICTURE,
      // An image of the upload's at the plain path already, which the copy must not take.
      "Fotos/Cafe-au-lait.png": PICTURE,
    });
    const after = plainStandIns(before);
    expect(after.main.text).toContain("\\includegraphics{Fotos/Cafe-au-lait-2.PNG}");
    expect(after.files["Fotos/Cafe-au-lait-2.PNG"]).toBeDefined();
    expect(after.files["Fotos/Cafe-au-lait.png"]).toEqual(before.files["Fotos/Cafe-au-lait.png"]);
  });

  test("leaves a name a macro builds, and an intake whose stand-ins are plain, as they were", () => {
    const built = taken({
      "cv.tex": shows("x", "\\newcommand{\\photo}[1]{\\includegraphics{#1}}").replace(
        "\\includegraphics{x}",
        "\\photo{Fotos/Café au lait}",
      ),
      "Fotos/Café au lait.png": PICTURE,
    });
    const after = plainStandIns(built);
    expect(after.main.text).toBe(built.main.text);
    expect(after.files["Fotos/Café au lait.png"]).toBeDefined();
    const plain = taken({ "cv.tex": shows("photo"), "photo.png": PICTURE });
    expect(plainStandIns(plain)).toBe(plain);
  });
});

describe.skipIf(!engineAvailable())("a stand-in's PDF, on the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files, manifest.fonts);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /** Whether the PDF of an intake's reference compile is made, its stand-ins listed as images. */
  async function pdfMade(upload: Intake): Promise<boolean> {
    const made = await reference(session, fonts, upload);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const images = [...upload.images.replaced, ...made.images].map((image) => image.path);
    const result = session.pdf(IMPORT_JOB, { images });
    session.forget(IMPORT_JOB);
    return result.ok;
  }

  test("is made once the stand-in has a plain path, and refused before", async () => {
    const zipped = zipSync({
      "cv.tex": strToU8(shows("Fotos/Café au lait")),
      "Fotos/Café au lait.png": PICTURE,
    });
    const before = intake({ name: "invented.zip", bytes: zipped }, { tree });
    if (isRefusal(before)) throw new Error(before.message);
    expect(await pdfMade(before)).toBe(false);
    expect(await pdfMade(plainStandIns(before))).toBe(true);
  }, 60_000);
});
