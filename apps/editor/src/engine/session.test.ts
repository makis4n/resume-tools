import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { ONE_BY_ONE, standIn, xbb } from "../import/images";
import { GRAPHICS_CFG } from "../import/reference";
import { curated } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { INVENTED_XETEX } from "../templates/invented";
import { defaultControls } from "../templates/package";
import { bound, fastest } from "../test/timing";
import { parseDvi } from "../tex/dvi";
import { collectFields } from "../tex/fields";
import { hasToUnicode, mediaBoxes, shownStrings } from "../validate/pdf";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "./node";
import {
  type Engine,
  type EngineSession,
  imageFileOf,
  insideJob,
  isJobPath,
  isShowableImage,
  refusedSpecial,
} from "./session";

const PREAMBLE = String.raw`\documentclass{article}
\usepackage[hidelinks]{hyperref}`;

describe("refusedSpecial", () => {
  it("names a special that makes xdvipdfmx read a file, in every form", () => {
    // The commands that read a file, and their aliases, whatever the case and spacing.
    for (const command of ["image", "img", "epdf", "fstream", "mapfile", "mapline"])
      expect(refusedSpecial(`pdf:${command} @x (secret.bin)`), command).toBe(`pdf:${command}`);
    expect(refusedSpecial("PDF:FSTREAM @x (x)")).toBe("pdf:fstream");
    expect(refusedSpecial("pdf:  image (x)")).toBe("pdf:image");
    expect(refusedSpecial("  pdf:mapfile pdftex.map")).toBe("pdf:mapfile");
    // dvips's file-inclusion special, in both spellings.
    expect(refusedSpecial("psfile=drawing.eps llx=0")).toBe("psfile=");
    expect(refusedSpecial("PSfile=drawing.eps")).toBe("psfile=");
    // A dvipdfmx:config whose option is not C, V or P reads a file (f) or reconfigures the run.
    expect(refusedSpecial("dvipdfmx:config f pdftex.map")).toBe("dvipdfmx:config f");
    expect(refusedSpecial('dvipdfmx:  config D "gs -q -sDEVICE=..."')).toBe("dvipdfmx:config D");
    expect(refusedSpecial("dvipdfmx:config f /texlive/texmf-dist/web2c/texmf.cnf")).toBe(
      "dvipdfmx:config f",
    );
    // p (paper) is a different option from P (permissions), so case is kept.
    expect(refusedSpecial("dvipdfmx:config p a4")).toBe("dvipdfmx:config p");
  });

  it("names an x:fontmapfile special, which loads a font map from a file", () => {
    expect(refusedSpecial("x:fontmapfile pdftex.map")).toBe("x:fontmapfile");
    expect(refusedSpecial(" x: FontMapFile +../victim/fonts.map")).toBe("x:fontmapfile");
  });

  it("names an x:fontmapline special, which can point a font at any file", () => {
    expect(refusedSpecial("x:fontmapline cmr10 cmr10 <../victim/victim.dvi")).toBe("x:fontmapline");
    expect(refusedSpecial("\tx:  FONTMAPLINE cmr10 cmr10 <x.pfb")).toBe("x:fontmapline");
  });

  it("passes a special that reads no file", () => {
    for (const text of [
      "pdf:pagesize width 210mm height 297mm",
      "pdf:literal q 1 0 0 1 0 0 cm Q",
      "pdf:link",
      "pdf:bann",
      "pdf:dest (page.1) [@thispage /XYZ @xpos @ypos null]",
      "papersize=614.295pt,794.96999pt",
      "color push rgb 1 0 0",
      // The only dvipdfmx:config options that reach nothing outside the PDF.
      "dvipdfmx:config C 0x0010",
      "dvipdfmx:config V 5",
      "dvipdfmx:config P -44",
      "rt:b:header.first",
      "header=l3backend-dvips.pro",
      // x: specials that load nothing.
      "x:gsave",
      "x:scale 2 2",
      "x:textcolor rgb 1 0 0",
    ])
      expect(refusedSpecial(text), text).toBeUndefined();
  });
});

describe("an image special's file", () => {
  it("is the first PDF string after the command, as a path inside the job's folder", () => {
    expect(imageFileOf("pdf:image bbox 0 0 1 1 clip 0 width 72.27pt (photo.png) ")).toBe(
      "photo.png",
    );
    expect(imageFileOf("pdf:epdf pagebox cropbox bbox 0 0 10 10 clip 0 (logo.pdf)")).toBe(
      "logo.pdf",
    );
    expect(
      imageFileOf("pdf:image matrix 1.0 0.0 0.0 1.0 0.0 0.0 page 0 pagebox cropbox (./a/b.pdf)"),
    ).toBe("a/b.pdf");
    expect(imageFileOf("PDF:IMG @im1 width 10pt (img/photo.png) << /Interpolate true >>")).toBe(
      "img/photo.png",
    );
  });

  it("is none that a comment, an escape, a nested string or a path outside could hide", () => {
    for (const text of [
      "pdf:image % (photo.png)\n(secret.png)",
      "pdf:image (photo\\).png)",
      "pdf:image ((photo.png))",
      "pdf:image <</F (x)>> (photo.png)",
      "pdf:image (../victim/photo.png)",
      "pdf:image (/texlive/texmf-dist/tex/latex/mwe/example-image.png)",
      "pdf:image (.hidden.png)",
      "pdf:fstream @x (photo.png)",
    ])
      expect(imageFileOf(text), text).toBeUndefined();
  });

  it("can be listed as a stand-in only when its path is of plain characters", () => {
    for (const path of ["photo.png", "img/Invented_Photo-2.jpg", "a/b.c/d.pdf"])
      expect(isShowableImage(path), path).toBe(true);
    for (const path of [
      "my photo.png",
      "img/(photo).png",
      "café.png",
      "photo%.png",
      "../photo.png",
      "img/../photo.png",
      ".photo.png",
      "img/.hidden/photo.png",
      "/photo.png",
      "",
    ])
      expect(isShowableImage(path), path).toBe(false);
  });

  it("is a path in the job only when it stays inside the job's folder", () => {
    expect(isJobPath("sections/part.tex")).toBe(true);
    for (const path of ["", "../x.tex", "a//b.tex", "a/./b.tex", ".fonts.conf", "a/.b/c.tex", "/x"])
      expect(isJobPath(path), path).toBe(false);
    expect(insideJob("import", "/home/web_user/jobs/import/fonts/Invented.otf")).toBe(
      "fonts/Invented.otf",
    );
    expect(insideJob("import", "./fonts/Invented.otf")).toBe("fonts/Invented.otf");
    expect(insideJob("import", "/home/web_user/jobs/doc/fonts/Invented.otf")).toBeUndefined();
    expect(
      insideJob("import", "/texlive/texmf-dist/fonts/opentype/x/Invented.otf"),
    ).toBeUndefined();
  });
});

/** The spike's Jake's Resume, its preamble and its marked-up body, kept as fixtures. */
const spike = (name: string) =>
  readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url), "utf8");

// These run the real engine and need `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("EngineSession", () => {
  let session: EngineSession;
  beforeAll(async () => {
    session = await startNodeSession();
  }, 60_000);

  it("dumps a preamble into a format and compiles a body from it", () => {
    const dumped = session.dump("pdftex", "basic", PREAMBLE);
    expect(dumped.error).toBeUndefined();
    expect(dumped.ok).toBe(true);
    expect(dumped.format?.length).toBeGreaterThan(1_000_000);

    const compiled = session.compile(
      "pdftex",
      "basic",
      String.raw`\begin{document}Hello, \special{rt:b:greeting}world\special{rt:e:greeting}.\end{document}`,
      { job: "hello" },
    );
    expect(compiled.error).toBeUndefined();
    expect(compiled.pages).toBe(1);
    const dvi = parseDvi(compiled.output as Uint8Array, () => undefined);
    const page = dvi.pages[0];
    expect(page).toBeDefined();
    // The marker specials pass through untouched, around the field's glyphs.
    const fields = collectFields(page as NonNullable<typeof page>, () => undefined);
    expect(fields.get("greeting")?.glyphs.length).toBe(5);
  }, 30_000);

  it("runs a new document twice and a changed one once", () => {
    session.dump("pdftex", "labels", PREAMBLE);
    const body = (text: string) =>
      String.raw`\begin{document}\section{One}\label{one}${text} See section~\ref{one}.\end{document}`;
    const first = session.compile("pdftex", "labels", body("First."), { job: "labels" });
    expect(first.ok).toBe(true);
    expect(first.passes.length).toBe(2);
    const second = session.compile("pdftex", "labels", body("Second."), { job: "labels" });
    expect(second.ok).toBe(true);
    expect(second.passes.length).toBe(1);
  }, 30_000);

  it("fails a compile with TeX's first error and the line", () => {
    session.dump("pdftex", "errors", PREAMBLE);
    const result = session.compile(
      "pdftex",
      "errors",
      "\\begin{document}\nfine\n\\nosuchmacro\n\\end{document}\n",
      { job: "errors" },
    );
    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.error).toBe("Undefined control sequence.");
    expect(result.errorLine).toBe(3);
    // The session carries on after a failed run.
    const again = session.compile("pdftex", "errors", "\\begin{document}fine\\end{document}", {
      job: "errors",
    });
    expect(again.ok).toBe(true);
  }, 30_000);

  it("fails a dump that loads a package TeX Live does not have", () => {
    const result = session.dump("pdftex", "missing", `${PREAMBLE}\n\\usepackage{nosuchpackage}`);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("LaTeX Error: File `nosuchpackage.sty' not found.");
  }, 30_000);

  it("compiles the spike's Jake's Resume from its own format", () => {
    const dumped = session.dump("pdftex", "jake", spike("jake-preamble.tex"));
    expect(dumped.error).toBeUndefined();
    const body = spike("body.tex");
    const first = session.compile("pdftex", "jake", body, { job: "jake" });
    expect(first.error).toBeUndefined();
    expect(first.pages).toBe(1);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const again = session.compile("pdftex", "jake", body, { job: "jake" });
      expect(again.ok).toBe(true);
      times.push(...again.passes);
    }
    times.sort((a, b) => a - b);
    console.log(
      `jake: dump ${dumped.ms.toFixed(0)} ms, first open ${first.passes.map((ms) => ms.toFixed(0)).join(" + ")} ms, edit median ${times[2]?.toFixed(0)} ms`,
    );
    const page = parseDvi(first.output as Uint8Array, () => undefined).pages[0];
    const fields = collectFields(page as NonNullable<typeof page>, () => undefined);
    expect(fields.size).toBe(30);
  }, 60_000);

  it("compiles a XeTeX template's body from a format that holds no native font", () => {
    // Decision 0003's loop on the invented XeTeX template (decision 0014): the declarations are
    // dumped, and the fonts load when the body selects them, on every compile.
    const { package: pkg, sample } = INVENTED_XETEX;
    const values = defaultControls(pkg);
    const format = generateFormat(pkg, values);
    const dumped = session.dump("xetex", format.name, format.preamble, format.files);
    expect(dumped.error).toBeUndefined();
    const body = generateBody(pkg, sample, values).latex;
    const first = session.compile("xetex", format.name, body, { job: "xetime" });
    expect(first.error).toBeUndefined();
    expect(first.passes).toHaveLength(2);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const again = session.compile("xetex", format.name, body, { job: "xetime" });
      expect(again.passes).toHaveLength(1);
      times.push(...again.passes);
    }
    times.sort((a, b) => a - b);
    const median = ((times[4] ?? 0) + (times[5] ?? 0)) / 2;
    console.log(
      `invented XeTeX template: dump ${dumped.ms.toFixed(0)} ms, ${((dumped.format?.length ?? 0) / 2 ** 20).toFixed(1)} MB; first open ${first.passes.map((ms) => ms.toFixed(0)).join(" + ")} ms; body median of ten ${median.toFixed(0)} ms`,
    );
    // Generous, so that a pathological slowdown fails and an ordinary slow machine does not.
    expect(median).toBeLessThan(2_000);
  }, 60_000);

  it("forgets a job's files when it moves to another format", () => {
    session.dump("pdftex", "a", PREAMBLE);
    session.dump("pdftex", "b", PREAMBLE);
    const body = "\\begin{document}x\\end{document}";
    expect(session.compile("pdftex", "a", body, { job: "moves" }).passes.length).toBe(2);
    expect(session.compile("pdftex", "a", body, { job: "moves" }).passes.length).toBe(1);
    expect(session.compile("pdftex", "b", body, { job: "moves" }).passes.length).toBe(2);
  }, 30_000);

  it("compiles XeTeX to XDV from the stock format", () => {
    const result = session.compile(
      "xetex",
      "stock",
      "\\documentclass{article}\\begin{document}Hello from XeTeX.\\end{document}",
      { job: "xe" },
    );
    expect(result.error).toBeUndefined();
    expect(result.pages).toBe(1);
    expect(parseDvi(result.output as Uint8Array, () => undefined).id).toBe(7);
  }, 60_000);

  it("refuses names that are not plain", () => {
    expect(() => session.dump("pdftex", "../x", PREAMBLE)).toThrow();
    // "stock" means the engine's own format, which a dump must not seem to replace.
    expect(() => session.dump("pdftex", "stock", PREAMBLE)).toThrow();
    expect(() => session.putFormat("pdftex", "stock", new Uint8Array())).toThrow();
    expect(() => session.dump("pdftex", "x", PREAMBLE, { ".hidden": "" })).toThrow();
    expect(() => session.compile("pdftex", "stock", "", { job: "a b" })).toThrow();
    expect(() =>
      session.compile("pdftex", "stock", "", { job: "x", files: { "../x.tex": "" } }),
    ).toThrow();
  });

  it("refuses an engine it does not have before it writes anything", () => {
    // The engine is part of a format's path, so an unchecked one could put a file anywhere.
    for (const engine of ["../jobs/doc", "toString", ""] as unknown as Engine[]) {
      expect(() => session.putFormat(engine, "x", new Uint8Array(1))).toThrow("no engine named");
      expect(() => session.dump(engine, "x", PREAMBLE)).toThrow("no engine named");
      expect(() => session.compile(engine, "stock", "")).toThrow("no engine named");
    }
    const fs = (session as unknown as { engine: { FS: { readdir(path: string): string[] } } })
      .engine.FS;
    expect(fs.readdir("/home/web_user/jobs")).not.toContain("doc-x.fmt");
  });

  it("refuses a budget of passes that is not a whole number from 1", () => {
    // Without a finite budget, a document whose log always asks for a rerun would never stop.
    const body = "\\documentclass{article}\\begin{document}x\\end{document}";
    for (const maxPasses of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(
        () => session.compile("pdftex", "stock", body, { job: "budget", maxPasses }),
        String(maxPasses),
      ).toThrow("maxPasses");
    expect(session.compile("pdftex", "stock", body, { job: "budget", maxPasses: 1 }).ok).toBe(true);
  }, 30_000);

  it("puts a template's files beside the preamble and the document", () => {
    const files = { "greeting.sty": "\\ProvidesPackage{greeting}\\newcommand\\greet{Hello}" };
    expect(
      session.dump("pdftex", "withfiles", `${PREAMBLE}\n\\usepackage{greeting}`, files).ok,
    ).toBe(true);
    const result = session.compile(
      "pdftex",
      "withfiles",
      "\\begin{document}\\greet\\end{document}",
      {
        job: "withfiles",
        files,
      },
    );
    expect(result.error).toBeUndefined();
  }, 30_000);

  it("dumps a preamble given as bytes, beside files at their paths, and no path outside it", () => {
    // An imported resume's preamble inputs a file of a folder of its own, and is dumped in the
    // encoding its file had: here Latin-1, whose é is one byte, which inputenc reads as such.
    const files = { "setup/settings.tex": "\\newcommand\\invented{Invented}" };
    const preamble = new Uint8Array([
      ...new TextEncoder().encode(
        "\\documentclass{article}\\usepackage[latin1]{inputenc}\\usepackage[T1]{fontenc}\\input{setup/settings}\\newcommand\\accented{caf",
      ),
      0xe9,
      ...new TextEncoder().encode("}"),
    ]);
    const dumped = session.dump("pdftex", "bytes", preamble, files);
    expect(dumped.error).toBeUndefined();
    const result = session.compile(
      "pdftex",
      "bytes",
      "\\begin{document}\\invented\\ \\accented\\end{document}",
      { job: "bytes" },
    );
    expect(result.error).toBeUndefined();
    const page = parseDvi(result.output as Uint8Array, () => undefined).pages[0];
    // T1 sets é as the one glyph 233, which inputenc took from the byte.
    expect(page?.items.some((item) => item.kind === "glyph" && item.code === 0xe9)).toBe(true);
    for (const path of ["a//b.tex", ".fonts.conf", "setup/../../x.tex", "a/.git/config"])
      expect(() => session.dump("pdftex", "bytes", preamble, { [path]: "x" }), path).toThrow(
        "not a path inside the job's folder",
      );
  }, 30_000);

  it("puts an upload's files at their paths in the job's folder, and no path outside it", () => {
    const files = {
      "sections/part.tex": "Invented part, \\input{sections/deeper/more}",
      "sections/deeper/more.tex": "and more of it.",
    };
    const body = "\\documentclass{article}\\begin{document}\\input{sections/part}\\end{document}";
    const result = session.compile("pdftex", "stock", body, { job: "paths", files });
    expect(result.error).toBeUndefined();
    for (const path of ["a//b.tex", ".fonts.conf", "sections/../../x.tex", "a/.git/config"])
      expect(
        () => session.compile("pdftex", "stock", body, { job: "paths", files: { [path]: "x" } }),
        path,
      ).toThrow("not a path inside the job's folder");
  }, 30_000);

  describe("lets XeTeX find a font by name for one compile", () => {
    const byName = (font: string) =>
      `\\documentclass{article}\\usepackage{fontspec}\\setmainfont{${font}}\\begin{document}Invented.\\end{document}`;
    const conf = () =>
      (
        session as unknown as { engine: { FS: { analyzePath(path: string): { exists: boolean } } } }
      ).engine.FS.analyzePath("/home/web_user/jobs/byname/.fonts.conf").exists;

    it("through fontconfig, which scans the tree's font folders for that compile alone", () => {
      const without = session.compile("xetex", "stock", byName("Roboto"), { job: "byname" });
      expect(without.error).toBe('Package fontspec Error: The font "Roboto" cannot be found.');
      const withFonts = session.compile("xetex", "stock", byName("Roboto"), {
        job: "byname",
        fontsByName: true,
      });
      expect(withFonts.error).toBeUndefined();
      expect(conf()).toBe(false);
      // A font the job's own folder holds is found by name too, as one a zip ships.
      session.forget("byname");
      const roboto = readFileSync(
        `${ENGINE_DIR}/files/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Regular.otf`,
      );
      const shipped = session.compile("xetex", "stock", byName("Roboto"), {
        job: "byname",
        fontsByName: true,
        files: { "fonts/Invented-Copy.otf": roboto },
      });
      expect(shipped.error).toBeUndefined();
      // And the next compile of the job scans no folder again.
      expect(session.compile("xetex", "stock", byName("Roboto"), { job: "byname" }).error).toBe(
        'Package fontspec Error: The font "Roboto" cannot be found.',
      );
    }, 60_000);

    it("at a cost to each pass that decision 0019 records", () => {
      // The same document, its font by file, which needs no fontconfig: what the option adds is
      // fontconfig's scan of the tree's OpenType and TrueType folders, which XeTeX starts on every
      // pass. Decision 0019 measured about 30 ms a pass on an M4 Pro. Each is timed in the CPU
      // time of this thread, where the engine runs, the fastest of five, so that other test files
      // running beside it do not count (`src/test/timing.ts`).
      const document = byName("Roboto-Regular.otf");
      const pass = (fontsByName: boolean) => () => {
        session.forget("cost");
        session.compile("xetex", "stock", document, { job: "cost", maxPasses: 1, fontsByName });
      };
      // The first scan reads the tree's font files, which later ones find read.
      pass(true)();
      const [plain = 0, scanned = 0] = fastest([pass(false), pass(true)], 5);
      console.log(
        `fontconfig's scan: ${Math.round(scanned - plain)} ms of CPU time a pass (${Math.round(plain)} ms without it, ${Math.round(scanned)} ms with it)`,
      );
      // Against the pass without it, which load slows alike: the scan costs a fifth of one here
      // (34 ms of 170) and must cost less than one and a half, as the 250 ms this bound was came
      // to at rest; a loaded runner could go past 250 ms, and a scan of every font the tree has
      // costs more.
      expect(scanned - plain).toBeLessThan(bound(1.5, plain));
    }, 120_000);
  });

  it("keeps working after hundreds of runs", () => {
    // A run moves the engine's stack pointer, which lives outside the heap. Unless the session
    // puts it back, the 64 KB stack runs out after a few hundred runs.
    for (let i = 0; i < 400; i++) expect(session.run(["pdflatex", "--version"]).code).toBe(0);
    expect(session.dump("pdftex", "after", PREAMBLE).ok).toBe(true);
    const body = "\\begin{document}x\\end{document}";
    expect(session.compile("pdftex", "after", body, { job: "after" }).ok).toBe(true);
  }, 60_000);

  it("closes the files a failed run leaves open", () => {
    const open = () =>
      (session as unknown as { engine: { FS: { streams: unknown[] } } }).engine.FS.streams.filter(
        Boolean,
      ).length;
    session.dump("pdftex", "leaks", PREAMBLE);
    const before = open();
    for (let i = 0; i < 5; i++)
      session.compile("pdftex", "leaks", "\\begin{document}\\nosuchmacro\\end{document}", {
        job: `leak${i}`,
      });
    expect(open()).toBe(before);
  }, 30_000);

  describe("keeps each job to its own folder", () => {
    const doc = (body: string) => `\\documentclass{article}\\begin{document}${body}\\end{document}`;
    const read = (path: string) =>
      String.raw`\newread\r\openin\r=${path} \ifeof\r\typeout{RESULT=unread}\else\typeout{RESULT=read}\fi x`;
    const plant = String.raw`\newwrite\w\immediate\openout\w=planted.tex\immediate\write\w{planted}\immediate\closeout\w x`;
    const result = (log: string) => /RESULT=(\w+)/.exec(log)?.[1];

    it("lets a job read what it wrote, and no other job", () => {
      expect(session.compile("pdftex", "stock", doc(plant), { job: "planter" }).ok).toBe(true);
      const own = session.compile("pdftex", "stock", doc(read("planted.tex")), { job: "planter" });
      expect(result(own.log)).toBe("read");
      const other = session.compile("pdftex", "stock", doc(read("../planter/planted.tex")), {
        job: "reader",
      });
      expect(result(other.log)).toBe("unread");
      const absolute = session.compile(
        "pdftex",
        "stock",
        doc(read("/home/web_user/jobs/planter/planted.tex")),
        { job: "reader" },
      );
      expect(result(absolute.log)).toBe("unread");
      const input = session.compile("pdftex", "stock", doc("\\input{planted}"), { job: "reader" });
      expect(input.error).toBe("LaTeX Error: File `planted.tex' not found.");
    }, 60_000);

    it("gives back a file a job's compile wrote, and nothing outside the job's folder", () => {
      const write = String.raw`\newwrite\w\immediate\openout\w=\jobname.rtm\immediate\write\w{written line}\immediate\closeout\w x`;
      expect(session.compile("pdftex", "stock", doc(write), { job: "writer" }).ok).toBe(true);
      expect(new TextDecoder().decode(session.written("writer", "writer.rtm"))).toBe(
        "written line\n",
      );
      expect(session.written("writer", "missing.txt")).toBeUndefined();
      expect(session.written("reader", "writer.rtm")).toBeUndefined();
      expect(() => session.written("writer", "../planter/planted.tex")).toThrow();
      expect(() => session.written("writer", ".fonts.conf")).toThrow();
      expect(() => session.written("../writer", "writer.rtm")).toThrow();
    }, 60_000);

    it("stops a job writing outside its folder", () => {
      const escape = (path: string) =>
        String.raw`\newwrite\w\immediate\openout\w=${path}\immediate\write\w{x}\immediate\closeout\w x`;
      const up = session.compile("pdftex", "stock", doc(escape("../reader/evil.tex")), {
        job: "escaper",
      });
      expect(up.error).toBe("I can't write on file `../reader/evil.tex'.");
      expect(session.dump("pdftex", "target", PREAMBLE).ok).toBe(true);
      // A dump cannot reach the formats either, so a template cannot replace another's.
      const dump = session.dump(
        "pdftex",
        "escaper",
        `${PREAMBLE}\n${escape("/home/web_user/formats/pdftex-target.fmt")}`,
      );
      expect(dump.error).toBe("I can't write on file `/home/web_user/formats/pdftex-target.fmt'.");
      const target = session.compile("pdftex", "target", "\\begin{document}x\\end{document}", {
        job: "target",
      });
      expect(target.ok).toBe(true);
    }, 60_000);
  });

  it("starts a job again when its format is dumped again", () => {
    // titletoc writes commands into the .aux that a format without it cannot read.
    session.dump("pdftex", "redump", "\\documentclass{article}\\usepackage{titletoc}");
    const body = "\\begin{document}\\tableofcontents\\section{A}\\end{document}";
    expect(session.compile("pdftex", "redump", body, { job: "redump" }).ok).toBe(true);
    session.dump("pdftex", "redump", "\\documentclass{article}");
    const after = session.compile("pdftex", "redump", body, { job: "redump" });
    expect(after.error).toBeUndefined();
    expect(after.passes.length).toBe(2);
  }, 60_000);

  it("keeps a format when dumping it again fails", () => {
    expect(session.dump("pdftex", "keep", PREAMBLE).ok).toBe(true);
    expect(session.dump("pdftex", "keep", `${PREAMBLE}\n\\usepackage{nosuchpackage}`).ok).toBe(
      false,
    );
    const body = "\\begin{document}x\\end{document}";
    expect(session.compile("pdftex", "keep", body, { job: "keep" }).ok).toBe(true);
  }, 60_000);

  it("leaves no format behind when a dump fails", () => {
    // XeTeX writes a partial format before it refuses to dump a native font.
    expect(session.dump("xetex", "partial", "\\documentclass{article}").ok).toBe(false);
    expect(() => session.compile("xetex", "partial", "", { job: "partial" })).toThrow(
      "no xetex format named partial",
    );
    // Formats are kept by engine, so a pdfTeX one is not mistaken for a XeTeX one.
    expect(session.dump("pdftex", "partial", PREAMBLE).ok).toBe(true);
    expect(() => session.compile("xetex", "partial", "", { job: "partial" })).toThrow();
  }, 60_000);

  it("reports a failure from this compile's log, never an earlier one", () => {
    session.dump("pdftex", "stale", PREAMBLE);
    const broken = "\\begin{document}\n\n\\nosuchmacro\n\\end{document}";
    expect(session.compile("pdftex", "stale", broken, { job: "stale" }).errorLine).toBe(3);
    session.putFormat("pdftex", "stale", new TextEncoder().encode("not a format"));
    const result = session.compile("pdftex", "stale", "\\begin{document}x\\end{document}", {
      job: "stale",
    });
    expect(result.ok).toBe(false);
    expect(result.log).not.toContain("nosuchmacro");
    expect(result.errorLine).toBeUndefined();
  }, 60_000);

  it("tries once more as a new document when old auxiliary files break a compile", () => {
    session.dump("pdftex", "retry", PREAMBLE);
    // The first pass leaves a line in the .aux that the second pass cannot read.
    const poison = String.raw`\begin{document}\makeatletter\immediate\write\@auxout{\string\nosuchmacro}\makeatother x\end{document}`;
    expect(session.compile("pdftex", "retry", poison, { job: "retry" }).ok).toBe(false);
    const clean = session.compile("pdftex", "retry", "\\begin{document}x\\end{document}", {
      job: "retry",
    });
    expect(clean.error).toBeUndefined();
    // One pass stopped by the old .aux, then two as a new document.
    expect(clean.passes.length).toBe(3);
  }, 60_000);

  it("retries a failed edit once, within the passes allowed", () => {
    session.dump("pdftex", "budget", PREAMBLE);
    const ok = "\\begin{document}x\\end{document}";
    const broken = "\\begin{document}\\nosuchmacro\\end{document}";
    expect(session.compile("pdftex", "budget", ok, { job: "budget" }).ok).toBe(true);
    // The failed pass, then one as a new document, which stops on the same error.
    const retried = session.compile("pdftex", "budget", broken, { job: "budget" });
    expect(retried.error).toBe("Undefined control sequence.");
    expect(retried.passes.length).toBe(2);
    // With one pass allowed there is no retry.
    expect(session.compile("pdftex", "budget", ok, { job: "budget" }).ok).toBe(true);
    const once = session.compile("pdftex", "budget", broken, { job: "budget", maxPasses: 1 });
    expect(once.passes.length).toBe(1);
  }, 60_000);

  it("stops at one extra pass for an edit that ships no pages", () => {
    session.dump("pdftex", "empty", PREAMBLE);
    const ok = session.compile("pdftex", "empty", "\\begin{document}x\\end{document}", {
      job: "empty",
    });
    expect(ok.ok).toBe(true);
    const empty = session.compile("pdftex", "empty", "\\begin{document}\\end{document}", {
      job: "empty",
    });
    expect(empty.error).toBe("No pages of output.");
    // The failed pass and the retry as a new document, which ships nothing either.
    expect(empty.passes.length).toBe(2);
  }, 60_000);

  it("keeps a job's files through a failed edit, until its format changes", () => {
    const made = session.dump("pdftex", "keepfiles", "\\documentclass{article}");
    const files = { "extra.tex": "Extra text." };
    const body = (text: string) => `\\begin{document}\\input{extra} ${text}\\end{document}`;
    const compile = (format: string, text: string, withFiles = false) =>
      session.compile("pdftex", format, body(text), {
        job: "keepfiles",
        files: withFiles ? files : undefined,
      });
    expect(compile("keepfiles", "x", true).ok).toBe(true);
    expect(compile("keepfiles", "y").ok).toBe(true);
    // The retry as a new document clears the folder and writes the files back.
    expect(compile("keepfiles", "\\nosuchmacro").error).toBe("Undefined control sequence.");
    expect(compile("keepfiles", "z").ok).toBe(true);
    // The same format made again, by a dump or put back, starts the job as a new document with
    // its files.
    session.dump("pdftex", "keepfiles", "\\documentclass{article}");
    expect(compile("keepfiles", "z").passes).toHaveLength(2);
    session.putFormat("pdftex", "keepfiles", made.format as Uint8Array);
    const put = compile("keepfiles", "z");
    expect(put.error).toBeUndefined();
    expect(put.passes).toHaveLength(2);
    // Another format is another template, whose files come with it.
    session.dump("pdftex", "otherfiles", "\\documentclass{article}");
    expect(compile("otherfiles", "z").error).toBe("LaTeX Error: File `extra.tex' not found.");
  }, 60_000);

  it("recovers from a bad line in any auxiliary file", () => {
    session.dump("pdftex", "aux", "\\documentclass{article}");
    const poison = String.raw`\makeatletter\immediate\write\@auxout{\string\nosuchmacro}\makeatother`;
    const cases: { files: Record<string, string>; bad: string; good: string }[] = [
      {
        // The main .aux, read after an included part's own .aux.
        files: { "part.tex": "\\section{Part}Included." },
        bad: `\\begin{document}\\include{part}${poison} x\\end{document}`,
        good: "\\begin{document}\\include{part}x\\end{document}",
      },
      {
        // The .toc, which \tableofcontents reads before it writes a new one.
        files: {},
        bad: "\\begin{document}\\DeclareRobustCommand\\foo{X}\\tableofcontents\\section{A \\foo}\\end{document}",
        good: "\\begin{document}\\tableofcontents\\section{A}\\end{document}",
      },
    ];
    cases.forEach(({ files, bad, good }, i) => {
      const job = `aux${i}`;
      session.compile("pdftex", "aux", bad, { job, files });
      const result = session.compile("pdftex", "aux", good, { job, files });
      expect(result.error, job).toBeUndefined();
    });
  }, 60_000);

  it("settles a document with hyperref in one pass after the first compile", () => {
    // hyperref loads rerunfilecheck, whose banner has the word Rerun in it.
    const body =
      "\\documentclass{article}\\usepackage{hyperref}\\begin{document}Hello\\end{document}";
    const passes = [0, 1, 2].map(
      () => session.compile("pdftex", "stock", body, { job: "settles" }).passes.length,
    );
    expect(passes).toEqual([2, 1, 1]);
  }, 60_000);

  describe("makes the PDF of a job's last compile", () => {
    const { package: jake, sample } = curated("jake");
    const text = (pdf: Uint8Array) => new TextDecoder("latin1").decode(pdf);
    const fs = () =>
      (
        session as unknown as {
          engine: {
            FS: {
              readdir(path: string): string[];
              writeFile(path: string, data: Uint8Array): void;
            };
          };
        }
      ).engine.FS;
    const jobFiles = (job: string) => fs().readdir(`/home/web_user/jobs/${job}`);
    const doc = (body: string) => `\\documentclass{article}\\begin{document}${body}\\end{document}`;

    /** Jake's sample, compiled as the editor compiles it, on the page size given. */
    function compileJake(job: string, pageSize: "letter" | "a4") {
      const values = { ...defaultControls(jake), pageSize };
      const format = generateFormat(jake, values);
      expect(session.dump("pdftex", format.name, format.preamble, format.files).ok).toBe(true);
      const body = generateBody(jake, sample, values);
      expect(session.compile("pdftex", format.name, body.latex, { job }).error).toBeUndefined();
    }

    it("from Jake's sample: whole, the page's size, its text readable, its links kept", () => {
      compileJake("jakepdf", "letter");
      const made = session.pdf("jakepdf", { compress: 0 });
      expect(made.error).toBeUndefined();
      const pdf = made.pdf as Uint8Array;
      expect(text(pdf.subarray(0, 5))).toBe("%PDF-");
      expect(text(pdf).trimEnd().endsWith("%%EOF")).toBe(true);
      // geometry's papersize= special, which the page is drawn to as well: US Letter.
      expect(mediaBoxes(pdf)).toEqual([{ width: 612, height: 792 }]);
      // xdvipdfmx maps each font's glyph names to Unicode, which lets the ATS take the text out.
      expect(hasToUnicode(pdf)).toBe(true);
      // The first name is one string of the page's content, [(Mara)]TJ, in the glyphs' codes.
      expect(shownStrings(pdf).some((shown) => shown.includes(sample.header.name.first))).toBe(
        true,
      );
      // hyperref's dvipdfmx driver writes links xdvipdfmx keeps (decision 0008).
      expect(text(pdf)).toContain(`/URI(${sample.header.links[0]?.href})`);
      // The PDF is read and removed; the folder holds what the compile left, and no more.
      expect(jobFiles("jakepdf")).not.toContain("jakepdf.pdf");

      const times: number[] = [];
      let size = 0;
      for (let i = 0; i < 5; i++) {
        const again = session.pdf("jakepdf");
        expect(again.ok).toBe(true);
        times.push(again.ms);
        size = again.pdf?.length ?? 0;
      }
      times.sort((a, b) => a - b);
      console.log(
        `jake pdf: first ${made.ms.toFixed(0)} ms at level 0, median ${times[2]?.toFixed(0)} ms, ${size} bytes`,
      );
    }, 60_000);

    it("on A4 when the document is set on A4, from the same special", () => {
      compileJake("jakea4", "a4");
      const [box, ...more] = mediaBoxes(session.pdf("jakea4", { compress: 0 }).pdf as Uint8Array);
      expect(more).toEqual([]);
      expect(box?.width).toBeCloseTo(595.276, 1);
      expect(box?.height).toBeCloseTo(841.89, 1);
    }, 60_000);

    it("on US Letter, as the page is drawn, from an output that does not name its size", () => {
      // Nothing here writes a papersize= special, and xdvipdfmx's own default is A4.
      expect(session.compile("pdftex", "stock", doc("x"), { job: "unsized" }).ok).toBe(true);
      const pdf = session.pdf("unsized", { compress: 0 }).pdf as Uint8Array;
      expect(mediaBoxes(pdf)).toEqual([{ width: 612, height: 792 }]);
    }, 60_000);

    it("in colour, from the dvips colour specials LaTeX writes", () => {
      // The color package takes the dvips driver in DVI mode, as Jake's does (decision 0008).
      const coloured = `\\documentclass{article}\\usepackage{color}\\begin{document}\\color{red}\\rule{1cm}{1cm}\\end{document}`;
      expect(session.compile("pdftex", "stock", coloured, { job: "coloured" }).ok).toBe(true);
      const content = text(session.pdf("coloured", { compress: 0 }).pdf as Uint8Array);
      expect(content).toContain("1 0 0 rg");
      expect(content).toContain("1 0 0 RG");
    }, 60_000);

    it("from XeTeX's XDV as well", () => {
      const xe = session.compile("xetex", "stock", doc("Hello from XeTeX."), { job: "xepdf" });
      expect(xe.ok).toBe(true);
      const made = session.pdf("xepdf");
      expect(made.error).toBeUndefined();
      expect(text((made.pdf as Uint8Array).subarray(0, 5))).toBe("%PDF-");
    }, 60_000);

    it("of no job that has not compiled, or whose last compile failed", () => {
      expect(session.pdf("never")).toEqual({
        ok: false,
        ms: 0,
        output: "",
        error: "never has no output to make a PDF of",
      });
      expect(session.compile("pdftex", "stock", doc("x"), { job: "broken" }).ok).toBe(true);
      expect(session.pdf("broken").ok).toBe(true);
      const failed = session.compile("pdftex", "stock", doc("x\\newpage\\nosuchmacro"), {
        job: "broken",
      });
      expect(failed.ok).toBe(false);
      // TeX shipped the first page before the error, so a DVI is there, but it is not the document.
      expect(jobFiles("broken")).toContain("broken.dvi");
      expect(session.pdf("broken").error).toBe("broken has no output to make a PDF of");
      expect(session.compile("pdftex", "stock", doc("y"), { job: "broken" }).ok).toBe(true);
      expect(session.pdf("broken").ok).toBe(true);
      session.forget("broken");
      expect(session.pdf("broken").ok).toBe(false);
    }, 60_000);

    it("fails, naming the font, when xdvipdfmx cannot embed one", () => {
      // LaTeX 2023 takes itemize's bullet from TS1, whose Computer Modern font, tcrm1000, the
      // tree has metrics for, but no Type 1 file, and no font map of it names one.
      const bulleted = doc("\\begin{itemize}\\item x\\end{itemize}");
      expect(session.compile("pdftex", "stock", bulleted, { job: "bulleted" }).ok).toBe(true);
      const made = session.pdf("bulleted");
      expect(made.ok).toBe(false);
      expect(made.pdf).toBeUndefined();
      expect(made.error).toMatch(/^xdvipdfmx exited with 1\n/);
      expect(made.error).toContain('"tcrm1000"');
      expect(made.output).toContain("xdvipdfmx:fatal:");
    }, 60_000);

    it("fails with the reason, rather than throw, when xdvipdfmx aborts, and makes the next", () => {
      // The tree's xdvipdfmx stops with a memory fault on an x:escale with no x:bscale open
      // (decision 0013), which the run throws. The PDF is refused, and the engine, put back as
      // start-up left it, makes the next one.
      const unscaled = doc("x\\special{x:escale}");
      expect(session.compile("pdftex", "stock", unscaled, { job: "aborted" }).ok).toBe(true);
      const made = session.pdf("aborted");
      expect(made.ok).toBe(false);
      expect(made.pdf).toBeUndefined();
      expect(made.error).toMatch(/^xdvipdfmx aborted: memory access out of bounds/);
      expect(made.output).toContain("aborted.dvi -> aborted.pdf");
      expect(made.ms).toBeGreaterThan(0);
      expect(jobFiles("aborted")).not.toContain("aborted.pdf");
      // Again, the same, and then the same job with the special gone.
      expect(session.pdf("aborted").error).toBe(made.error);
      expect(session.compile("pdftex", "stock", doc("x"), { job: "aborted" }).ok).toBe(true);
      expect(session.pdf("aborted").ok).toBe(true);
    }, 60_000);

    it("fails, rather than throw, for an output it cannot read, and runs nothing", () => {
      // Its specials cannot be scanned for one that reads a file, so xdvipdfmx never sees it.
      expect(session.compile("pdftex", "stock", doc("x"), { job: "garbled" }).ok).toBe(true);
      fs().writeFile("/home/web_user/jobs/garbled/garbled.dvi", new Uint8Array([247, 2, 1]));
      const made = session.pdf("garbled");
      expect(made.ok).toBe(false);
      expect(made.error).toMatch(/^the output cannot be read: /);
      expect(made.output).toBe("");
    }, 60_000);

    it("keeps a XeTeX document's set size, which it writes as pdf:pagesize, not papersize=", () => {
      // Dumped as decision 0003's loop does: fontenc before the class, geometry on A4, hyperref.
      // XeTeX writes the size in a pdf:pagesize special, and -p would override it to Letter.
      const preamble = String.raw`\RequirePackage[OT1]{fontenc}\documentclass{article}
\usepackage[a4paper,margin=1cm]{geometry}
\usepackage[hidelinks]{hyperref}
\pagestyle{empty}`;
      expect(session.dump("xetex", "xa4", preamble).error).toBeUndefined();
      const body = String.raw`\begin{document}Top line\vfill Bottom line\end{document}`;
      expect(session.compile("xetex", "xa4", body, { job: "xa4" }).error).toBeUndefined();
      const [box, ...more] = mediaBoxes(session.pdf("xa4", { compress: 0 }).pdf as Uint8Array);
      expect(more).toEqual([]);
      expect(box?.width).toBeCloseTo(595.28, 1);
      expect(box?.height).toBeCloseTo(841.89, 1);
    }, 60_000);

    it("from a XeTeX template's format as from a whole compile, but for what nothing links to", () => {
      // Decision 0003's loop: the format holds the preamble and the fonts' declarations, and the
      // body alone is compiled. \dump drops what hyperref and xcolor write at the first shipout,
      // which a whole compile from the stock format keeps (decision 0014).
      const { package: pkg, sample } = INVENTED_XETEX;
      const values = defaultControls(pkg);
      const format = generateFormat(pkg, values);
      expect(session.dump("xetex", format.name, format.preamble, format.files).ok).toBe(true);
      const body = generateBody(pkg, sample, values);
      const loop = session.compile("xetex", format.name, body.latex, { job: "xeloop" });
      const whole = session.compile("xetex", "stock", `${format.preamble}\n${body.latex}`, {
        job: "xewhole",
      });
      expect(loop.error).toBeUndefined();
      expect(whole.error).toBeUndefined();
      const [looped, wholly] = [loop, whole].map((result) => {
        const doc = parseDvi(result.output as Uint8Array, () => undefined);
        const items = doc.pages.flatMap((page) => page.items);
        const specials = items.flatMap((item) => (item.kind === "special" ? [item.text] : []));
        return { specials, drawn: items.filter((item) => item.kind !== "special") };
      });
      // The same glyphs, rules and runs, and the same specials but for these, which the whole
      // compile writes first: the PDF's version, a compatibility flag that keeps named
      // destinations nothing links to, and a black to start the colour stack with.
      expect(looped?.drawn).toEqual(wholly?.drawn);
      const lost = [...(wholly?.specials ?? [])];
      const gained: string[] = [];
      for (const special of looped?.specials ?? []) {
        const at = lost.indexOf(special);
        if (at < 0) gained.push(special);
        else lost.splice(at, 1);
      }
      expect(gained).toEqual([]);
      expect(lost.sort()).toEqual([
        "color push gray 0",
        "dvipdfmx:config C 0x0010",
        "pdf:majorversion 1",
        "pdf:minorversion 5",
      ]);
      // So the PDFs are the same version, size, text, links and colours; the whole compile's
      // only has the two named destinations hyperref makes, which nothing links to.
      const fromLoop = session.pdf("xeloop", { compress: 0 }).pdf ?? new Uint8Array();
      const fromWhole = session.pdf("xewhole", { compress: 0 }).pdf ?? new Uint8Array();
      const read = (pdf: Uint8Array) => {
        const all = text(pdf);
        return {
          version: all.slice(0, 8),
          boxes: mediaBoxes(pdf),
          shown: shownStrings(pdf),
          links: [...all.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((match) => match[1]),
          colours: [...all.matchAll(/[\d.]+ [\d.]+ [\d.]+ (?:rg|RG)\b/g)].map((match) => match[0]),
        };
      };
      expect(read(fromLoop)).toEqual(read(fromWhole));
      expect(read(fromLoop).version).toBe("%PDF-1.5");
      // The page's size from geometry's pdf:pagesize, which xdvipdfmx is left to honour.
      expect(read(fromLoop).boxes).toEqual([{ width: 612, height: 792 }]);
      expect(read(fromLoop).shown.join(" ")).toContain(sample.header.name.last);
      expect(read(fromLoop).colours.length).toBeGreaterThan(0);
      expect(text(fromWhole)).toMatch(/\/Names\s*\[\(Doc-Start\)\d+ 0 R\(page\.1\)\d+ 0 R\]/);
      expect(text(fromLoop)).not.toMatch(/\(Doc-Start\)|\(page\.1\)/);
    }, 60_000);

    it("honours a pdf:pagesize special in a pdfTeX DVI too", () => {
      const a4 = doc("\\special{pdf:pagesize width 210mm height 297mm}Hello");
      expect(session.compile("pdftex", "stock", a4, { job: "psize" }).ok).toBe(true);
      const [box, ...more] = mediaBoxes(session.pdf("psize", { compress: 0 }).pdf as Uint8Array);
      expect(more).toEqual([]);
      expect(box?.width).toBeCloseTo(595.28, 1);
      expect(box?.height).toBeCloseTo(841.89, 1);
    }, 60_000);

    it("refuses, before running xdvipdfmx, an output whose special would read a file", () => {
      // xdvipdfmx ignores openin_any, so a pdf:fstream special would embed the named file. The
      // path is never read: the special is caught in the output and the PDF refused (decision
      // 0008). Resume text cannot emit a special (decision 0007); only a template can.
      const attack = doc(
        "hi\\special{pdf:fstream @x (../victim/victim.dvi)}\\special{pdf:close @x}",
      );
      expect(session.compile("pdftex", "stock", attack, { job: "reader" }).ok).toBe(true);
      const made = session.pdf("reader", { compress: 0 });
      expect(made.ok).toBe(false);
      expect(made.pdf).toBeUndefined();
      expect(made.error).toContain("pdf:fstream");
      // Nothing ran, so nothing was fetched or written under the PDF's name.
      expect(made.output).toBe("");
      expect(jobFiles("reader")).not.toContain("reader.pdf");
    }, 60_000);

    it("refuses a dvipdfmx:config special whose option reads a file or reconfigures the run", () => {
      // config f loads a font map, the same class as pdf:mapfile; the map is never read, since the
      // special is caught in the output and the PDF refused before xdvipdfmx runs (decision 0008).
      const attack = doc("hi\\special{dvipdfmx:config f pdftex.map}");
      expect(session.compile("pdftex", "stock", attack, { job: "config" }).ok).toBe(true);
      const made = session.pdf("config", { compress: 0 });
      expect(made.ok).toBe(false);
      expect(made.pdf).toBeUndefined();
      expect(made.error).toContain("dvipdfmx:config f");
      expect(made.output).toBe("");
    }, 60_000);

    for (const special of ["x:fontmapfile pdftex.map", "x:fontmapline cmr10 cmr10 <cmr10.pfb"])
      it(`refuses an output with ${special.split(" ")[0]}, which loads a font map`, () => {
        // The same class as pdf:mapfile and pdf:mapline, which xdvipdfmx runs for pdfTeX's output
        // too; the map is never read, since the special is caught in the output first.
        const job = special.startsWith("x:fontmapfile") ? "mapfile" : "mapline";
        const attack = doc(`hi\\special{${special}}`);
        expect(session.compile("pdftex", "stock", attack, { job }).ok).toBe(true);
        const made = session.pdf(job, { compress: 0 });
        expect(made.ok).toBe(false);
        expect(made.pdf).toBeUndefined();
        expect(made.error).toContain(special.split(" ")[0]);
        expect(made.output).toBe("");
      }, 60_000);

    it("shows a stand-in the caller lists, and only while it holds the bytes the caller gave", () => {
      const files = {
        "photos/portrait.png": standIn(ONE_BY_ONE),
        "photos/portrait.xbb": xbb(ONE_BY_ONE),
        "other.png": standIn(ONE_BY_ONE),
        "other.xbb": xbb(ONE_BY_ONE),
        "graphics.cfg": GRAPHICS_CFG,
      };
      const shows = (name: string, before = "") =>
        `\\documentclass{article}\\usepackage{graphicx}\\begin{document}${before}Invented \\includegraphics[width=1cm]{${name}}\\end{document}`;
      expect(
        session.compile("pdftex", "stock", shows("photos/portrait.png"), { job: "standin", files })
          .ok,
      ).toBe(true);
      expect(session.pdf("standin", { images: ["photos/portrait.png"] }).ok).toBe(true);
      // Not listed, or another file listed: refused, as every image is without the list.
      expect(session.pdf("standin").error).toContain("pdf:image");
      expect(session.pdf("standin", { images: ["other.png"] }).ok).toBe(false);
      // A document that writes over its stand-in, as TeX may write in its folder, is refused too.
      const overwrite =
        "\\newwrite\\w\\immediate\\openout\\w=photos/portrait.png\\immediate\\write\\w{Invented}\\immediate\\closeout\\w ";
      const written = shows("photos/portrait.png", overwrite);
      expect(session.compile("pdftex", "stock", written, { job: "standin", files }).ok).toBe(true);
      expect(session.pdf("standin", { images: ["photos/portrait.png"] }).ok).toBe(false);
    }, 60_000);

    it("shows a XeTeX document's PDF image only as a stand-in the caller lists, by a plain path", () => {
      // XeTeX writes every picture, a PDF's page among them, as a `pdf:image` special.
      const logo = standIn({ kind: "pdf", box: [0, 0, 200, 100], rotate: 0 });
      const shows = (name: string) =>
        `\\documentclass{article}\\usepackage{fontspec}\\usepackage{graphicx}\\begin{document}Invented \\includegraphics[width=1cm]{${name}}\\end{document}`;
      const files = { "logo.pdf": logo, "my logo.pdf": logo };
      expect(
        session.compile("xetex", "stock", shows("logo.pdf"), { job: "xepdf", files }).error,
      ).toBeUndefined();
      // A PDF the job holds that the caller does not list as a stand-in is refused.
      expect(session.pdf("xepdf").error).toContain("pdf:image");
      expect(session.pdf("xepdf", { images: ["my logo.pdf"] }).ok).toBe(false);
      // Listed, it is made.
      expect(session.pdf("xepdf", { images: ["logo.pdf"] }).ok).toBe(true);
      // A stand-in whose path holds a space cannot be listed, so its PDF is refused.
      expect(
        session.compile("xetex", "stock", shows("my logo.pdf"), { job: "xepdf", files }).error,
      ).toBeUndefined();
      expect(session.pdf("xepdf", { images: ["my logo.pdf"] }).error).toContain("pdf:image");
    }, 60_000);

    it("refuses a compression level that is not a whole number from 0 to 9", () => {
      for (const compress of [-1, 10, 1.5, Number.NaN])
        expect(() => session.pdf("unsized", { compress }), String(compress)).toThrow("compress");
    });
  });
});
