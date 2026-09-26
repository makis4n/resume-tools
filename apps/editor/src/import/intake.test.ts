import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, test } from "vitest";
import { cpuMs } from "../test/timing";
import { readTree } from "./fonts";
import { imageInfo } from "./images";
import { CAPS, decodeText, type Intake, intake, treeImages } from "./intake";
import { isRefusal, type Refusal } from "./refusal";

// Every upload here is invented for these tests, in zips built in the test: invented classes,
// packages and fonts that say so, and filler holding SECRET, which no refusal may show.

const SECRET = "Quillwort";

/** A whole invented document around a preamble. */
const whole = (...preamble: string[]) =>
  [
    ...preamble,
    "\\begin{document}",
    `${SECRET} filler of an invented body.`,
    "\\end{document}",
    "",
  ].join("\n");

const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [
        name,
        typeof data === "string" ? strToU8(data) : data,
      ]),
    ),
  );

/** The intake of a zip of these files, which must be taken. */
function taken(files: Record<string, string | Uint8Array>, name = "upload.zip"): Intake {
  const result = intake({ name, bytes: zip(files) });
  if (isRefusal(result)) throw new Error(`refused: ${result.message}`);
  return result;
}

/** The intake of an upload, which must be refused. */
function refused(result: Intake | Refusal): Refusal {
  if (!isRefusal(result)) throw new Error("taken");
  expect(result.message).not.toContain(SECRET);
  return result;
}

const text = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : decodeText(bytes);

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** A PNG header of the given pixels, which is all an image's size is read from. */
const png = (width: number, height: number) =>
  new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height), 8, 0, 0, 0, 0],
    ...[0, 0, 0, 0],
  ]);

/** A JPEG's headers, up to its frame header of the given pixels, at 300 dots per inch. */
const jpeg = (width: number, height: number) =>
  new Uint8Array([
    ...[0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 1, 44, 1, 44, 0, 0],
    ...[0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0],
    ...[0xff, 0xd9],
  ]);

const pdf = (box: string) =>
  strToU8(`%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [${box}] >>\nendobj\n%%EOF\n`);

describe("taking an upload in", () => {
  test("takes one .tex file as the main file", () => {
    const result = intake({
      name: "Invented CV.tex",
      bytes: strToU8(whole("\\documentclass{article}")),
    });
    if (isRefusal(result)) throw new Error(result.message);
    expect(result.main.path).toBe("Invented CV.tex");
    expect(result.main.text).toContain(SECRET);
    expect(result.files).toEqual({});
    expect(result.engine).toBe("pdftex");
  });

  test("refuses anything but a .tex file or a zip", () => {
    expect(refused(intake({ name: "cv.docx", bytes: strToU8("invented") })).message).toBe(
      "Upload a .tex file, or a zip of your resume's files.",
    );
    expect(refused(intake({ name: "cv.zip", bytes: strToU8(`not a zip ${SECRET}`) })).message).toBe(
      "This zip cannot be opened.",
    );
  });

  test("reads UTF-8, or Latin-1 when the bytes are not UTF-8, and keeps the bytes as they were", () => {
    const latin1 = new Uint8Array([...strToU8("\\documentclass{article}% caf"), 0xe9, 0x0a]);
    const result = taken({ "cv.tex": latin1, "part.tex": "Caf\u00e9 \u2013 invented." });
    expect(result.main.text).toContain("caf\u00e9");
    expect(result.main.bytes).toEqual(latin1);
    expect(text(result.files["part.tex"])).toBe("Caf\u00e9 \u2013 invented.");
    expect(decodeText(new Uint8Array([0xc3, 0xa9]))).toBe("\u00e9");
  });
});

describe("the caps", () => {
  test("refuse a zip past its size or its count of files", () => {
    const big = new Uint8Array(CAPS.zipBytes + 1);
    big.set([0x50, 0x4b]);
    expect(refused(intake({ name: "big.zip", bytes: big })).message).toBe(
      "This zip is larger than 20 MB.",
    );
    const many = Object.fromEntries(
      Array.from({ length: CAPS.entries + 1 }, (_, i) => [`part${i}.tex`, "invented"]),
    );
    expect(refused(intake({ name: "many.zip", bytes: zip(many) })).message).toBe(
      "This zip holds more than 400 files.",
    );
  });

  test("refuse a file past its size, naming it, by the size the zip says, before unpacking it", () => {
    const large = new Uint8Array(CAPS.fileBytes + 1);
    expect(
      refused(
        intake({
          name: "cv.zip",
          bytes: zip({ "cv.tex": whole("\\documentclass{article}"), "fonts/Invented.otf": large }),
        }),
      ).message,
    ).toBe("The file fonts/Invented.otf in this zip is larger than 10 MB.");
    // A zip whose entry says it unpacks to more than the cap is refused without unpacking it: the
    // size its central directory gives is past the cap, and nothing is inflated.
    const bytes = zip({ "cv.tex": whole("\\documentclass{article}"), "invented.bib": "@misc{x}" });
    const view = new DataView(bytes.buffer);
    for (let at = 0; at + 4 <= bytes.length; at++)
      if (view.getUint32(at, true) === 0x02014b50 && bytes[at + 46] === "i".charCodeAt(0))
        view.setUint32(at + 24, CAPS.fileBytes + 1, true);
    expect(refused(intake({ name: "cv.zip", bytes })).message).toBe(
      "The file invented.bib in this zip is larger than 10 MB.",
    );
  });

  test("refuse text files and fonts past their caps together", () => {
    const megabyte = "%".repeat(1_000_000);
    const texts = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`part${i}.tex`, megabyte]),
    );
    expect(
      refused(intake({ name: "cv.zip", bytes: zip({ "cv.tex": "x", ...texts }) })).message,
    ).toBe("The text files in this zip are larger than 5 MB together.");
    const font = new Uint8Array(8_000_000);
    const fonts = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`fonts/Invented${i}.otf`, font]),
    );
    expect(
      refused(intake({ name: "cv.zip", bytes: zip({ "cv.tex": "x", ...fonts }) })).message,
    ).toBe("The fonts in this zip are larger than 30 MB together.");
  });

  test("refuse a name that is not a safe relative path, naming it", () => {
    for (const name of [
      "../invented.tex",
      "/invented.tex",
      "a/../../invented.sty",
      "a\\invented.tex",
    ])
      expect(
        refused(
          intake({
            name: "cv.zip",
            bytes: zip({ "cv.tex": whole("\\documentclass{article}"), [name]: "x" }),
          }),
        ).message,
      ).toBe(`This zip holds a file whose name is not safe: ${name}.`);
  });
});

describe("the main file", () => {
  test("is the one .tex that starts a document and that no other inputs", () => {
    const result = taken({
      "cv.tex": whole("\\documentclass{article}", "\\input{sections/part}"),
      "sections/part.tex": "% \\documentclass{article} in a comment counts for nothing",
      "notes.tex": "Invented notes, no document.",
    });
    expect(result.main.path).toBe("cv.tex");
    // A part that starts a document of its own, as `subfiles` has each part do, is input by the
    // main file, so it is not a main file.
    const parts = taken({
      "main.tex": whole("\\documentclass{article}", "\\subfile{parts/one}"),
      "parts/one.tex": whole("\\documentclass[../main.tex]{subfiles}"),
    });
    expect(parts.main.path).toBe("main.tex");
  });

  test("refuses none, several, or LaTeX 2.09's", () => {
    expect(
      refused(intake({ name: "cv.zip", bytes: zip({ "notes.tex": `${SECRET} notes.` }) })).message,
    ).toMatch(/^This upload holds no LaTeX document/);
    expect(
      refused(
        intake({
          name: "cv.zip",
          bytes: zip({
            "cv.tex": whole("\\documentclass{article}"),
            "letter.tex": whole("\\documentclass{letter}"),
          }),
        }),
      ).message,
    ).toBe(
      "This upload holds more than one document: cv.tex, letter.tex. Upload one resume at a time.",
    );
    expect(
      refused(intake({ name: "old.tex", bytes: strToU8(whole("\\documentstyle{article}")) }))
        .message,
    ).toMatch(/LaTeX 2\.09/);
  });
});

describe("the job", () => {
  test("is the main file's folder, each file there keeping its path from it", () => {
    const result = taken({
      "resume-main/cv/cv.tex": whole("\\documentclass{inventedcv}", "\\input{sections/part}"),
      "resume-main/cv/sections/part.tex": "Invented part.",
      "resume-main/inventedcv.cls": "\\LoadClass{article}",
      "resume-main/fonts/Invented-Regular.otf": new Uint8Array([1, 2, 3]),
      "resume-main/README.md": "Invented, and not for the job.",
      "resume-main/.github/workflows/build.yml": "invented",
    });
    expect(result.main.path).toBe("cv/cv.tex");
    // The wrapping folder is not the job's; the class and fonts above the main file keep their
    // path from the upload's top, where a template such as Awesome-CV keeps them.
    expect(Object.keys(result.files).sort()).toEqual([
      "fonts/Invented-Regular.otf",
      "inventedcv.cls",
      "sections/part.tex",
    ]);
    expect(result.fonts).toEqual(["fonts/Invented-Regular.otf"]);
  });

  test("puts a class or package the upload holds elsewhere where TeX finds it", () => {
    const result = taken({
      "cv/cv.tex": whole("\\documentclass{inventedcv}", "\\usepackage{inventedstyle}"),
      "styles/inventedcv.cls": "\\LoadClass{article}",
      "cv/sty/inventedstyle.sty": "% invented",
    });
    expect(text(result.files["inventedcv.cls"])).toBe("\\LoadClass{article}");
    expect(text(result.files["inventedstyle.sty"])).toBe("% invented");
    expect(result.files["sty/inventedstyle.sty"]).toBeDefined();
  });

  test("takes a document kept in a dot folder, and leaves out dot files and what zips add", () => {
    const result = taken({
      ".overleaf-repo/cv.tex": whole("\\documentclass{inventedcv}"),
      ".overleaf-repo/inventedcv.cls": "\\LoadClass{article}",
      ".overleaf-repo/.latexmkrc": "invented",
      "__MACOSX/.overleaf-repo/._cv.tex": "invented",
      // A file at the top, so that the dot folder is not the zip's wrapping folder.
      "README.md": "Invented.",
    });
    expect(result.main.path).toBe(".overleaf-repo/cv.tex");
    expect(Object.keys(result.files)).toEqual(["inventedcv.cls"]);
    // A dot folder the job would hold is left out, since TeX may open nothing in one.
    const beside = taken({
      "cv.tex": whole("\\documentclass{article}"),
      ".hidden/part.tex": "Invented.",
    });
    expect(Object.keys(beside.files)).toEqual([]);
  });

  test("rewrites a path above the main file's folder to the job's path of what it names", () => {
    const result = taken({
      "src/cv.tex": whole(
        "\\documentclass{article}",
        "\\usepackage{graphicx}",
        "\\graphicspath{{../img/}}",
        "\\input{../common/part} % \\input{../common/commented}",
        "\\includegraphics[width=1cm]{../img/badge.png}",
        "\\includegraphics{photo.png}",
        "\\includegraphics{../img/lacked.png}",
        "\\addbibresource{../refs/invented.bib}",
        "\\includegraphics{../../outside.png}",
      ),
      "img/photo.png": png(40, 20),
      "img/badge.png": png(10, 10),
      "common/part.tex": "\\includegraphics{../img/badge.png}",
      "refs/invented.bib": "@misc{invented}",
    });
    expect(result.main.text).toContain("\\graphicspath{{img/}}");
    expect(result.main.text).toContain("\\input{common/part} % \\input{../common/commented}");
    expect(result.main.text).toContain("\\includegraphics[width=1cm]{img/badge.png}");
    expect(result.main.text).toContain("\\addbibresource{refs/invented.bib}");
    expect(result.main.text).toContain("\\includegraphics{../../outside.png}");
    expect(text(result.main.bytes)).toBe(result.main.text);
    // The file the main file inputs is read, and rewritten, too.
    expect(text(result.files["common/part.tex"])).toBe("\\includegraphics{img/badge.png}");
    // The photo is found through the folder, at its size; one the upload lacks is missing.
    expect(result.images.replaced).toEqual([
      { name: "img/badge.png", path: "img/badge.png", kind: "png" },
      { name: "img/photo.png", path: "img/photo.png", kind: "png" },
      { name: "img/lacked.png", path: "img/lacked.png", kind: "png", missing: true },
    ]);
    expect(result.images.dropped).toEqual([{ name: "../../outside.png", why: "outside" }]);
    expect(result.warnings).toEqual([
      "../img/ is read as img/, the upload's path it names: this editor reads nothing above the main file's folder.",
      "../common/part is read as common/part, the upload's path it names: this editor reads nothing above the main file's folder.",
      "../img/badge.png is read as img/badge.png, the upload's path it names: this editor reads nothing above the main file's folder.",
      "../img/lacked.png is read as img/lacked.png, the upload's path it names: this editor reads nothing above the main file's folder.",
      "../refs/invented.bib is read as refs/invented.bib, the upload's path it names: this editor reads nothing above the main file's folder.",
    ]);
  });

  test("keeps a path above the main file's folder whose job path holds another of the upload's files", () => {
    const result = taken({
      "src/cv.tex": whole("\\documentclass{article}", "\\input{../part}"),
      "src/part.tex": "Invented, beside.",
      "part.tex": "Invented, above.",
    });
    expect(result.main.text).toContain("\\input{../part}");
    expect(result.warnings).toEqual([
      "part.tex is left out: a file of the same path beside the main file comes first.",
    ]);
  });

  test("sets \\pdfoutput to 0 where the main file or a file it inputs sets it above, and says so", () => {
    const latin1 = new Uint8Array([
      ...strToU8("\\pdfoutput=1\n\\documentclass{article}% caf"),
      0xe9,
      ...strToU8("\n\\input{part}\n\\begin{document}x\\end{document}\n"),
    ]);
    const result = taken({
      "cv.tex": latin1,
      "part.tex":
        "\\ifnum\\pdfoutput=1 \\relax\\fi \\pdfoutput 1\\relax % \\pdfoutput=1\n\\global\\pdfoutput=0",
    });
    expect(result.main.bytes).toEqual(
      new Uint8Array([...strToU8("\\pdfoutput=0"), ...latin1.subarray("\\pdfoutput=1".length)]),
    );
    expect(result.main.text.startsWith("\\pdfoutput=0\n")).toBe(true);
    expect(text(result.files["part.tex"])).toBe(
      "\\ifnum\\pdfoutput=1 \\relax\\fi \\pdfoutput=0\\relax % \\pdfoutput=1\n\\global\\pdfoutput=0",
    );
    expect(result.warnings).toEqual([
      "cv.tex asks for PDF output, which this editor makes from DVI: it is compiled for DVI.",
      "part.tex asks for PDF output, which this editor makes from DVI: it is compiled for DVI.",
    ]);
    // A UTF-8 file keeps its byte-order mark.
    const marked = taken({
      "cv.tex": new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...strToU8(whole("\\pdfoutput=1", "\\documentclass{article}")),
      ]),
    });
    expect([...marked.main.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(marked.main.bytes)).toContain("\\pdfoutput=0");
  });

  test("reads each source once, in time linear in its length, however its brackets are laid out", () => {
    // The reviewers' megabyte of `\input{`, none of which closes: each read it through the window
    // of the next 8,192 characters, and it was read four times over, in 5.2 s of CPU time.
    const unit = "\\input{";
    const main = `\\documentclass{article}\n${unit.repeat(Math.floor(1_000_000 / unit.length))}\n\\begin{document}x\\end{document}\n`;
    const bytes = zip({ "cv.tex": main });
    let result: Intake | Refusal | undefined;
    expect(cpuMs(() => (result = intake({ name: "cv.zip", bytes })))).toBeLessThan(1_000);
    expect(result && !isRefusal(result) && result.engine).toBe("pdftex");
  }, 60_000);

  test("keeps a file beside the main file over one of the same path above it", () => {
    const result = taken({
      "cv/cv.tex": whole("\\documentclass{article}"),
      "cv/part.tex": "Invented, beside.",
      "part.tex": "Invented, above.",
    });
    expect(text(result.files["part.tex"])).toBe("Invented, beside.");
    expect(result.warnings).toEqual([
      "part.tex is left out: a file of the same path beside the main file comes first.",
    ]);
  });
});

describe("the engine", () => {
  test("is XeTeX when the source needs it, through the files the main file loads", () => {
    expect(
      taken({ "cv.tex": whole("\\documentclass{article}", "\\usepackage{fontspec}") }).engine,
    ).toBe("xetex");
    const byClass = taken({
      "cv.tex": whole("\\documentclass{inventedcv}"),
      "inventedcv.cls":
        "\\LoadClass{article}\n\\RequirePackage{fontspec}\n\\setmainfont{Invented Sans}",
    });
    expect([byClass.engine, byClass.source]).toEqual(["xetex", "xetex"]);
    // A package the main file does not load says nothing.
    expect(
      taken({
        "cv.tex": whole("\\documentclass{article}"),
        "unused.sty": "\\RequirePackage{fontspec}",
      }).engine,
    ).toBe("pdftex");
  });

  test("is pdfTeX for a source that guards on the engine, as each engine reads it", () => {
    const either = taken({
      "cv.tex": whole(
        "\\documentclass{article}",
        "\\ifxetex\\usepackage{fontspec}\\else\\usepackage[T1]{fontenc}\\fi",
      ),
    });
    expect([either.engine, either.source]).toEqual(["pdftex", "both"]);
  });

  test("refuses LuaTeX, saying so", () => {
    expect(
      refused(
        intake({
          name: "cv.tex",
          bytes: strToU8(whole("\\documentclass{article}", "\\usepackage{luacode}")),
        }),
      ),
    ).toMatchObject({
      reason: "luatex",
      message: "This resume needs LuaTeX, which this editor does not have.",
    });
  });

  test("refuses a source that sets LuaTeX's PDF settings, and takes one that asks after them", () => {
    for (const command of ["pdfvariable", "pdfextension", "pdffeedback"])
      expect(
        refused(
          intake({
            name: "cv.tex",
            bytes: strToU8(whole("\\documentclass{article}", `\\${command} compresslevel=0`)),
          }),
        ),
        command,
      ).toMatchObject({ reason: "luatex" });
    const asks = taken({
      "cv.tex": whole(
        "\\documentclass{article}",
        "\\ifdefined\\pdfvariable \\pdfvariable compresslevel=0 \\else \\pdfcompresslevel=0 \\fi",
      ),
    });
    expect([asks.engine, asks.source]).toEqual(["pdftex", "both"]);
  });

  test("counts a package loaded only if present when the tree or the upload has it", () => {
    const source = whole(
      "\\documentclass{article}",
      "\\IfFileExists{fontspec.sty}{\\usepackage{fontspec}}{}",
    );
    const tree = readTree({ "/texlive/texmf-dist/tex/latex/fontspec/fontspec.sty": 1 });
    expect(taken({ "cv.tex": source }).engine).toBe("pdftex");
    const withTree = intake({ name: "cv.tex", bytes: strToU8(source) }, { tree });
    expect(isRefusal(withTree) ? undefined : withTree.engine).toBe("xetex");
  });
});

describe("images", () => {
  test("become blank stand-ins of the same size, each with its .xbb for pdfTeX", () => {
    const result = taken({
      "cv.tex": whole("\\documentclass{article}", "\\usepackage{graphicx}"),
      "photos/portrait.jpg": jpeg(600, 900),
      "logo.png": png(40, 20),
      "badge.pdf": pdf("0 0 144 72"),
      "cv.pdf": pdf("0 0 612 792"),
    });
    expect(result.images.replaced).toEqual([
      { name: "badge.pdf", path: "badge.pdf", kind: "pdf" },
      { name: "logo.png", path: "logo.png", kind: "png" },
      { name: "photos/portrait.jpg", path: "photos/portrait.jpg", kind: "jpeg" },
    ]);
    // The JPEG's stand-in is a PNG of its pixels at its resolution: 600 pixels at 300 dpi.
    const portrait = imageInfo(result.files["photos/portrait.jpg"] ?? new Uint8Array());
    expect(portrait).toMatchObject({ kind: "png", width: 600, height: 900 });
    expect(text(result.files["photos/portrait.xbb"])).toContain("%%BoundingBox: 0 0 144 216\n");
    expect(text(result.files["logo.xbb"])).toContain("%%BoundingBox: 0 0 40 20\n");
    expect(text(result.files["badge.xbb"])).toContain("%%BoundingBox: 0 0 144 72\n");
    // The document compiled, beside the main file, is not an image of it.
    expect(result.files["cv.pdf"]).toBeUndefined();
  });

  test("have no .xbb on XeTeX, which measures an image by reading it", () => {
    const result = taken({
      "cv.tex": whole("\\documentclass{article}", "\\usepackage{fontspec}"),
      "logo.png": png(40, 20),
    });
    expect(Object.keys(result.files)).toEqual(["logo.png"]);
  });

  test("that \\includegraphics names and the upload lacks get 1 by 1 stand-ins where graphicx looks first", () => {
    const result = taken({
      "cv.tex": whole(
        "\\documentclass{article}",
        "\\usepackage{graphicx}",
        "\\graphicspath{{images/}}",
        "\\newcommand{\\photo}{\\includegraphics{\\photofile}}",
        "\\includegraphics[width=2cm]{./photos/portrait}",
        "\\includegraphics{badge.pdf}",
        "\\includegraphics{logo}",
        "\\includegraphics*[height=1cm]{shot.JPG}",
        "\\includegraphics{diagram.eps}",
        "\\includegraphics{../outside.png}",
      ),
      "images/logo.png": png(40, 20),
    });
    expect(result.images.replaced).toEqual([
      { name: "images/logo.png", path: "images/logo.png", kind: "png" },
      { name: "./photos/portrait", path: "photos/portrait.png", kind: "png", missing: true },
      { name: "badge.pdf", path: "badge.pdf", kind: "pdf", missing: true },
      { name: "shot.JPG", path: "shot.JPG", kind: "png", missing: true },
    ]);
    expect(result.images.dropped).toEqual([
      { name: "diagram.eps", why: "format" },
      { name: "../outside.png", why: "outside" },
    ]);
    expect(text(result.files["photos/portrait.xbb"])).toContain("%%BoundingBox: 0 0 1 1\n");
    expect(imageInfo(result.files["badge.pdf"] ?? new Uint8Array())).toMatchObject({
      box: [0, 0, 1, 1],
    });
  });

  test("that the tree holds, as a class's logo, get stand-ins of their size", () => {
    const tree = treeImages(
      {
        "/texmf/texmf-dist/tex/latex/inventedcv/InventedFlag.pdf": 1,
        "/texmf/texmf-dist/tex/latex/inventedcv/InventedFlag.eps": 1,
        "/texlive/texmf-dist/fonts/type1/InventedFlag.pdf": 1,
      },
      (path) => (path.endsWith(".pdf") ? pdf("0 0 60 40") : new Uint8Array()),
    );
    expect(tree("InventedFlag.pdf")).toEqual(pdf("0 0 60 40"));
    expect(tree("InventedFlag.png")).toBeUndefined();
    expect(tree("other/InventedFlag.pdf")).toBeUndefined();
    const source = strToU8(
      whole(
        "\\documentclass{article}",
        "\\usepackage{graphicx}",
        "\\includegraphics[width=1cm]{InventedFlag}",
      ),
    );
    const result = intake({ name: "cv.tex", bytes: source }, { treeImage: tree });
    if (isRefusal(result)) throw new Error(result.message);
    expect(result.images.replaced).toEqual([
      { name: "InventedFlag", path: "InventedFlag.pdf", kind: "pdf", tree: true },
    ]);
    expect(text(result.files["InventedFlag.xbb"])).toContain("%%BoundingBox: 0 0 60 40\n");
  });

  test("of other formats, or that cannot be read, are dropped and named", () => {
    const result = taken({
      "cv.tex": whole("\\documentclass{article}"),
      "figures/chart.eps": "%!PS-Adobe-3.0 EPSF-3.0 invented",
      "figures/chart.svg": "<svg/>",
      "broken.png": `not a PNG ${SECRET}`,
      "photo.pdf": png(10, 10),
    });
    expect(result.images.dropped).toEqual([
      { name: "figures/chart.eps", why: "format", path: "figures/chart.eps" },
      { name: "figures/chart.svg", why: "format", path: "figures/chart.svg" },
      { name: "broken.png", why: "unreadable", path: "broken.png" },
      { name: "photo.pdf", why: "unreadable", path: "photo.pdf" },
    ]);
    expect(Object.keys(result.files)).toEqual([]);
  });

  test("past 10,000 pixels on a side are dropped as unreadable, with a warning, at little cost", () => {
    // PNG headers of 2^31 by 2^31 pixels, which cost a stand-in 60 to 100 ms each to make, and
    // 50 of them five seconds.
    const huge = png(2 ** 31 - 1, 2 ** 31 - 1);
    const one = taken({ "cv.tex": whole("\\documentclass{article}"), "huge.png": huge });
    expect(one.images).toEqual({
      replaced: [],
      dropped: [{ name: "huge.png", why: "unreadable", path: "huge.png" }],
    });
    expect(one.warnings).toEqual([
      "huge.png is left out: at 2,147,483,647 by 2,147,483,647 pixels, it is larger than this editor stands in for, 10,000 pixels on a side.",
    ]);
    expect(
      taken({ "cv.tex": whole("\\documentclass{article}"), "wide.png": png(10_001, 1) }).images
        .dropped,
    ).toHaveLength(1);
    expect(
      taken({ "cv.tex": whole("\\documentclass{article}"), "edge.png": png(10_000, 10_000) }).images
        .replaced,
    ).toHaveLength(1);
    const fifty = zip({
      "cv.tex": whole("\\documentclass{article}"),
      ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`huge${i}.png`, huge])),
    });
    let result: Intake | Refusal | undefined;
    expect(cpuMs(() => (result = intake({ name: "cv.zip", bytes: fifty })))).toBeLessThan(500);
    expect(result && !isRefusal(result) && result.images.dropped).toHaveLength(50);
  });

  test("beside the main file come before one of the same path above it, which is reported", () => {
    const result = taken({
      "zz/cv.tex": whole("\\documentclass{article}", "\\includegraphics{img/photo.png}"),
      "zz/img/photo.png": png(400, 200),
      "img/photo.png": png(40, 20),
    });
    expect(result.images.replaced).toEqual([
      { name: "zz/img/photo.png", path: "img/photo.png", kind: "png" },
    ]);
    expect(imageInfo(result.files["img/photo.png"] ?? new Uint8Array())).toMatchObject({
      width: 400,
    });
    expect(result.images.dropped).toEqual([{ name: "img/photo.png", why: "duplicate" }]);
    expect(result.warnings).toEqual([
      "img/photo.png is left out: an image of the same path beside the main file comes first.",
    ]);
  });

  test("of one name have one .xbb, of the image graphicx takes for the name, the other shadowed", () => {
    const files = {
      "cv.tex": whole(
        "\\documentclass{article}",
        "\\usepackage{graphicx}",
        "\\includegraphics{logo}",
      ),
      "logo.png": png(40, 20),
      "logo.pdf": pdf("0 0 200 100"),
    };
    const result = taken(files);
    expect(text(result.files["logo.xbb"])).toContain("%%BoundingBox: 0 0 200 100\n");
    expect(result.warnings).toEqual([
      "logo.png is shadowed by logo.pdf, of the same name, which graphicx takes when the document names neither's extension.",
    ]);
    // Named with its extension, the PNG reads the PDF's size, which a second warning says.
    const named = taken({
      ...files,
      "cv.tex": whole(
        "\\documentclass{article}",
        "\\usepackage{graphicx}",
        "\\includegraphics{logo.png}",
      ),
    });
    expect(text(named.files["logo.xbb"])).toContain("%%BoundingBox: 0 0 200 100\n");
    expect(named.warnings).toContain(
      "logo.png is shown at the size of logo.pdf: on pdfTeX, this editor sizes the two by the name they share.",
    );
    // A stand-in for a name the upload lacks keeps an upload's image's size for their name.
    const lacked = taken({
      "cv.tex": whole("\\documentclass{article}", "\\includegraphics{photo.jpg}"),
      "photo.png": png(40, 20),
    });
    expect(text(lacked.files["photo.xbb"])).toContain("%%BoundingBox: 0 0 40 20\n");
  });

  test("in a format with no stand-in get none for a name that finds only them, and are listed once", () => {
    const eps = "%!PS-Adobe-3.0 EPSF-3.0 invented";
    const bare = taken({
      "cv.tex": whole("\\documentclass{article}", "\\includegraphics{figure}"),
      "figure.eps": eps,
    });
    expect(bare.images).toEqual({
      replaced: [],
      dropped: [{ name: "figure.eps", why: "format", path: "figure.eps" }],
    });
    expect(bare.files["figure.png"]).toBeUndefined();
    const named = taken({
      "cv/cv.tex": whole("\\documentclass{article}", "\\includegraphics{figure.eps}"),
      "cv/figure.eps": eps,
      // A file at the top, so that cv/ is not the zip's wrapping folder.
      "README.md": "Invented.",
    });
    expect(named.images.dropped).toEqual([
      { name: "cv/figure.eps", why: "format", path: "figure.eps" },
    ]);
    // A PNG of the name comes before the EPS in graphicx's order, and stands in as ever.
    const both = taken({
      "cv.tex": whole("\\documentclass{article}", "\\includegraphics{figure}"),
      "figure.eps": eps,
      "figure.png": png(40, 20),
    });
    expect(both.images.replaced).toEqual([{ name: "figure.png", path: "figure.png", kind: "png" }]);
  });

  test("never reach the job as they were", () => {
    const photo = jpeg(64, 64);
    const result = taken({ "cv.tex": whole("\\documentclass{article}"), "me.jpg": photo });
    expect(result.files["me.jpg"]).not.toEqual(photo);
    expect(zlibSync(result.files["me.jpg"] ?? new Uint8Array()).length).toBeLessThan(200);
  });
});
