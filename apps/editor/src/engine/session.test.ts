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
    expect(() => session.write("../x.tex", "")).toThrow();
    expect(() => session.compile("pdftex", "stock", "", { job: "a b" })).toThrow();
  });
});
