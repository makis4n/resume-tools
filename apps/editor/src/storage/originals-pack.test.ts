import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ImportReport } from "../import/run";
import { curated } from "../templates/curated";
import { TemplatePackage } from "../templates/package";
import {
  IMPORT_FILES_VERSION,
  OriginalsUnreadable,
  packOriginals,
  unpackOriginals,
} from "./originals-pack";
import type { ImportRecord } from "./store";

// Every file and word here is invented.

const PKG = TemplatePackage.parse({
  ...curated("jake").package,
  id: "import-0123456789ab",
  name: "Invented import",
});

const tex = strToU8("\\documentclass{article}\n\\begin{document}Invented Name\\end{document}\n");
const cls = strToU8("% an invented class\n\\ProvidesClass{invented}\n");
const bbl = strToU8("\\begin{thebibliography}{1}\\end{thebibliography}\n");
const standIn = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const report = {
  engine: "pdftex",
  compiles: 7,
  ms: 1234.5,
  warnings: ["an invented warning"],
  locked: [{ id: "k1", words: ["Invented"] }],
} as unknown as ImportReport;

/** An import of one `.tex`: the job holds it, a rewritten copy, the bibliography and a stand-in. */
function oneTex(): ImportRecord {
  return {
    upload: { files: [{ name: "cv.tex", bytes: tex }] },
    job: {
      files: {
        "cv.tex": tex,
        "rewritten.tex": strToU8("% rewritten, not the upload's\n"),
        "photo.png": standIn,
      },
      bbl: strToU8("% made by the import\n"),
      images: ["photo.png"],
    },
    report,
    made: 1_760_000_000_000,
  };
}

/** An import of a zip: the job's files are its entries, at their paths and beside them. */
function aZip(): ImportRecord {
  const zip = zipSync({ "resume/cv.tex": tex, "resume/invented.cls": cls, "resume/cv.bbl": bbl });
  return {
    upload: { files: [{ name: "invented.zip", bytes: zip }] },
    job: {
      files: { "cv.tex": tex, "invented.cls": cls, "photo.png": standIn },
      bbl,
      images: ["photo.png"],
    },
    report,
    made: 1_760_000_000_001,
  };
}

const manifestOf = (bin: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(unzipSync(bin)["manifest.json"]));

describe("an import's two files (milestone 4 item 8)", () => {
  it("gives back the package and the record of a .tex upload, byte for byte", () => {
    const record = oneTex();
    const files = packOriginals(PKG, record);
    const back = unpackOriginals(files);
    expect(back.package).toEqual(PKG);
    expect(TemplatePackage.safeParse(back.package).success).toBe(true);
    expect(back.record).toEqual(record);
    for (const [path, bytes] of Object.entries(back.record.job.files)) {
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect([...bytes]).toEqual([...(record.job.files[path] ?? [])]);
    }
  });

  it("keeps the upload in original.zip exactly as given, and the same upload makes the same bytes", () => {
    const record = oneTex();
    const files = packOriginals(PKG, record);
    expect(unzipSync(files.original)).toEqual({ "cv.tex": tex });
    expect(packOriginals(PKG, record).original).toEqual(files.original);
  });

  it("names the job's files the upload holds rather than storing them again (decision 0091)", () => {
    const files = packOriginals(PKG, oneTex());
    const manifest = manifestOf(files.import);
    expect(manifest.version).toBe(IMPORT_FILES_VERSION);
    expect(Object.fromEntries(manifest.job.files)).toEqual({
      "cv.tex": { original: "cv.tex" },
      "rewritten.tex": { stored: "files/0" },
      "photo.png": { stored: "files/1" },
    });
    expect(manifest.job.bbl).toEqual({ stored: "files/2" });
    expect(Object.keys(unzipSync(files.import)).sort()).toEqual([
      "files/0",
      "files/1",
      "files/2",
      "manifest.json",
    ]);
  });

  it("names an uploaded zip's entries, and reads them back from it", () => {
    const record = aZip();
    const files = packOriginals(PKG, record);
    const manifest = manifestOf(files.import);
    expect(Object.fromEntries(manifest.job.files)).toEqual({
      "cv.tex": { original: "invented.zip", entry: "resume/cv.tex" },
      "invented.cls": { original: "invented.zip", entry: "resume/invented.cls" },
      "photo.png": { stored: "files/0" },
    });
    expect(manifest.job.bbl).toEqual({ original: "invented.zip", entry: "resume/cv.bbl" });
    const back = unpackOriginals(files);
    expect(back.record).toEqual(record);
    // Each file is on a buffer of its own, not a view of the unpacked zip's.
    for (const bytes of Object.values(back.record.job.files))
      expect(bytes.byteLength).toBe(bytes.buffer.byteLength);
  });

  it("keeps several uploaded files in their order, whatever their names", () => {
    const record: ImportRecord = {
      ...oneTex(),
      upload: {
        files: [
          { name: "zeta.tex", bytes: tex },
          { name: "2", bytes: cls },
          { name: "alpha.cls", bytes: cls },
        ],
      },
    };
    expect(unpackOriginals(packOriginals(PKG, record)).record.upload).toEqual(record.upload);
  });

  it("refuses plainly import.bin of another version, or not the editor's", () => {
    const files = packOriginals(PKG, oneTex());
    const rewrite = (change: (manifest: Record<string, unknown>) => void) => {
      const entries = unzipSync(files.import);
      const manifest = manifestOf(files.import);
      change(manifest);
      entries["manifest.json"] = strToU8(JSON.stringify(manifest));
      return { original: files.original, import: zipSync(entries) };
    };
    const newer = rewrite((manifest) => {
      manifest.version = IMPORT_FILES_VERSION + 1;
    });
    expect(() => unpackOriginals(newer)).toThrow(OriginalsUnreadable);
    expect(() => unpackOriginals(newer)).toThrow(/version 2/);
    const other = rewrite((manifest) => {
      manifest.format = "something else";
    });
    expect(() => unpackOriginals(other)).toThrow(OriginalsUnreadable);
    const badPackage = rewrite((manifest) => {
      manifest.package = { id: "import-0123456789ab" };
    });
    expect(() => unpackOriginals(badPackage)).toThrow(OriginalsUnreadable);
    expect(() =>
      unpackOriginals({ original: files.original, import: new Uint8Array([1, 2, 3]) }),
    ).toThrow(OriginalsUnreadable);
    // An original.zip that is not the upload the manifest names.
    expect(() =>
      unpackOriginals({ original: zipSync({ "other.tex": tex }), import: files.import }),
    ).toThrow(OriginalsUnreadable);
  });

  it("refuses an upload of two files of one name, which the import never keeps", () => {
    const record: ImportRecord = {
      ...oneTex(),
      upload: {
        files: [
          { name: "cv.tex", bytes: tex },
          { name: "cv.tex", bytes: cls },
        ],
      },
    };
    expect(() => packOriginals(PKG, record)).toThrow();
  });
});
