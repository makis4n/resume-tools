import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseDvi } from "../tex/dvi";
import { collectFields } from "../tex/fields";
import { engineAvailable, startNodeSession } from "./node";
import type { EngineSession } from "./session";

const PREAMBLE = String.raw`\documentclass{article}
\usepackage[hidelinks]{hyperref}`;

const spike = (name: string) =>
  readFileSync(new URL(`../../spike/web/${name}`, import.meta.url), "utf8");

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
});
