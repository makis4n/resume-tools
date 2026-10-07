import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { readTree } from "../src/import/fonts";
import { intake, treeImages } from "../src/import/intake";
import { IMPORT_JOB, readOutput, reference } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { pdfOffsets, worstOf } from "../src/test/pdf-offsets";
import { checkSpecial } from "../src/validate/harness";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle";
import { uploadOf } from "./corpus-reference";
import { engineManifest } from "./oracle-samples";

// AltaCV's upstream sample, as an import's reference compile sets it (decision 0081): pgf's
// dvipdfmx driver sets each of its six tags' text, a TikZ node, through a `pdf:btrans` translation,
// which xdvipdfmx applies, and which the page now applies too. Every glyph the translation moves is
// where the PDF shows it. Numbers alone reach the test's output, never the sample's text.

const fetched = existsSync(join(ORACLE_DIR, "altacv-0000", "sample.tex"));

describe.skipIf(!engineAvailable() || !fetched)("AltaCV's upstream sample's tags", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  /** The images the reference compile stands in for, which the PDF may show. */
  let images: string[];
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = engineManifest();
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const oracle = Oracle.parse(JSON.parse(readFileSync(ORACLE_FILE, "utf8")));
    const doc = oracle.documents.find((each) => each.id === "altacv-0000");
    if (doc === undefined) throw new Error("altacv-0000 is no oracle sample");
    const zip = uploadOf(
      oracleDocument(doc),
      (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
      () => undefined,
    );
    const treeImage = treeImages(
      manifest.files,
      (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
    );
    const taken = intake(
      { name: "altacv-0000.zip", bytes: zip },
      { tree: readTree(manifest.files, manifest.fonts), treeImage },
    );
    if (isRefusal(taken)) throw new Error("the sample was refused at intake");
    const made = await reference(session, fonts, taken, { treeImage });
    if (isRefusal(made)) throw new Error("the sample's reference compile was refused");
    images = [...taken.images.replaced, ...made.images].map((image) => image.path);
  }, 120_000);

  test("sets every glyph a tag's translation moves where the PDF shows it, within half a point", async () => {
    const output = session.written(IMPORT_JOB, `${IMPORT_JOB}.dvi`);
    if (output === undefined) throw new Error("the reference wrote no DVI");
    const { doc } = await readOutput(fonts, output);
    const made = session.pdf(IMPORT_JOB, { compress: 0, images });
    if (!made.pdf) throw new Error(made.error);
    const found = pdfOffsets(doc, made.pdf);
    expect(found.unaligned).toBe(0);
    const moved = worstOf(found, "translation");
    // The six tags, each one operator.
    expect(moved.operators).toBeGreaterThanOrEqual(6);
    expect(moved.max).toBeLessThan(0.5);
    // Nothing else is set in a transformation, and what is set in none is where the PDF has it too.
    expect(
      found.operators.every((each) => each.kind === undefined || each.kind === "translation"),
    ).toBe(true);
    expect(worstOf(found, undefined).max).toBeLessThan(0.5);
    // So the special check names none of the tags' fields: they can be probed like any other.
    expect(checkSpecial(doc).filter((finding) => finding.transform !== undefined)).toEqual([]);
  }, 60_000);
});
