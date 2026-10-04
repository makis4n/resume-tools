import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { readTree } from "../import/fonts";
import { treeImages } from "../import/intake";
import { isRefusal } from "../import/refusal";
import { type ImportDeps, importResume } from "../import/run";
import { drawPages } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { DocumentStore } from "../storage/store";
import { generateBody, generateFormat } from "../templates/generate";
import { resolveTemplate } from "../templates/resolve";
import { JAKE_FORK } from "../test/jake-fork";
import { Compiler, drawOptions, type Engine, type Shown } from "./compiler";
import { History } from "./document";
import { keptSegments, outlineOf } from "./outline";
import { isRetype, RetypeGuard, retypesOf, showsTyped } from "./retype";
import { outsideCheck } from "./retype-check";

// Decision 0042's rule that nothing new leaves the browser, for an imported outline's kept text (the
// second pass's item 7): the invented fork of Jake's Resume imported as an outline, its kept text's
// words retyped through the compiler and the store as the app wires them, with no request of any
// kind. Every word is invented. The import itself sends nothing, which
// `src/import/no-network.test.ts` holds.

/** The words typed: invented, and found nowhere in the fork. */
const TYPED = "Zephyrine Quokkamaw";

const tex = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(text) });

describe("a retype of an outline's kept text, and what leaves the browser (decision 0042)", () => {
  let session: EngineSession;
  let deps: ImportDeps;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    deps = {
      session,
      fonts: new FontLibrary(new TexLiveIndex(manifest), async (path) =>
        readFileSync(join(ENGINE_DIR, "files", path)),
      ),
      tree: readTree(manifest.files, manifest.fonts),
      treeImage: treeImages(
        manifest.files,
        (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
      ),
    };
  }, 60_000);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The compile engine the app's worker is, over a Node session, as the compiler takes one. */
  const engineOf = (on: EngineSession) => (): Engine => ({
    start: async () => {},
    dump: async (kind, name, preamble, files) => on.dump(kind, name, preamble, files),
    putFormat: async (kind, name, format) => on.putFormat(kind, name, format),
    forget: async (job) => on.forget(job),
    compile: async (kind, format, body, options) => on.compile(kind, format, body, options),
    pdf: async (job, options) => on.pdf(job, options),
    dropFormat: async (kind, name) => on.dropFormat(kind, name),
    terminate: () => {},
  });

  /** The fork's outline drawn as the editor draws it, and what each segment offers to retype. */
  async function drawnFork(source: string) {
    const imported = await importResume([tex("resume.tex", source)], deps);
    if (isRefusal(imported)) throw new Error(`refused: ${imported.reason}`);
    const { package: pkg, document, job } = imported;
    const format = generateFormat(pkg, document.controls);
    expect(session.dump(pkg.engine, format.name, format.preamble, format.files).ok).toBe(true);
    const body = generateBody(pkg, document.resume, document.controls);
    const result = session.compile(pkg.engine, format.name, body.latex, {
      job: "fork",
      maxPasses: 3,
      files: job.files,
    });
    session.forget("fork");
    session.dropFormat(pkg.engine, format.name);
    if (!result.ok || result.output === undefined) throw new Error("the document did not compile");
    const pages = await drawPages(
      result.output,
      deps.fonts,
      body.texts,
      drawOptions(pkg, document),
    );
    const outline = outlineOf(document.resume);
    if (outline === undefined) throw new Error("no outline");
    const retypes = retypesOf(document, pages);
    const offered = keptSegments(outline).flatMap((segment) => {
      const found = retypes.get(segment.id);
      return found !== undefined && isRetype(found) ? [{ segment, found }] : [];
    });
    return { imported, offered };
  }

  test("a retype of kept text makes no request", async () => {
    const { imported, offered } = await drawnFork(JAKE_FORK);
    // The skills list, kept text whose lines the outline's fields cannot hold.
    const skills = offered.find(({ segment }) => segment.latex.includes("\\textbf{Languages}"));
    if (skills === undefined) throw new Error("the skills offer nothing");

    // Kept and opened as the app opens it, through the compiler, in the document's own job.
    const store = new DocumentStore({ name: `resume-tools-retype-leak-${Date.now()}` });
    const id = await store.importDocument(imported);
    const stored = await store.get(id);
    if (stored === undefined) throw new Error("not stored");
    const template = await resolveTemplate(stored.document.template, id, store);
    if (template === undefined) throw new Error("no template");
    let land: (shown: Shown) => void = () => {};
    const compiler = new Compiler(
      engineOf(session),
      deps.fonts,
      { page: (shown) => land(shown), error: () => {}, busy: () => {} },
      { formats: store.formatsFor("test") },
    );
    const next = () =>
      new Promise<Shown>((resolve) => {
        land = resolve;
      });
    const history = new History(stored.document, template.package);
    const opening = next();
    compiler.open(template.package, history.present, template.job);
    const first = await opening;
    const found = retypesOf(history.present, first.pages).get(skills.segment.id);
    if (found === undefined || !isRetype(found)) throw new Error("the skills offer nothing");
    const texts = found.pieces.map((piece) => piece.text);
    const index = texts.findIndex((text) => /Invented/.test(text));
    texts[index] = (texts[index] ?? "").replace("Invented", TYPED.split(" ")[0] ?? "");

    // The retype, its page, its check and its save, with every request of the page watched.
    const fetches = vi.spyOn(globalThis, "fetch");
    const guard = new RetypeGuard(outsideCheck(deps.fonts));
    const after = guard.start(history, found, texts, first);
    if (after === "unchanged" || "why" in after) throw new Error("not started");
    const landing = next();
    compiler.update(after);
    const page = await landing;
    expect(await guard.paged(page)).toEqual({ kept: true });
    expect(showsTyped(found, texts, page.pages)).toBe(true);
    expect(JSON.stringify(history.present.resume)).toContain("Zephyrine");
    store.save(id, history.present, stored.revision);
    expect((await store.flush()).written).toBe(1);
    expect(fetches).not.toHaveBeenCalled();
    compiler.close();
    await store.close();
  }, 300_000);

  test("offers no accent's braced letter, nor the run the accent joins, on the engine", async () => {
    // A skills line's invented word with an accent written as an OT1 document writes one.
    const accented = JAKE_FORK.replace("{: Invented, Words", String.raw`{: M\"{u}ller, Words`);
    expect(accented).not.toBe(JAKE_FORK);
    const { offered } = await drawnFork(accented);
    const texts = offered.flatMap(({ found }) => found.pieces.map((piece) => piece.text));
    // The run before the accent is offered; the accented letter and the run it joins are not.
    expect(texts).toContain(": M");
    expect(texts.some((text) => /ller/.test(text))).toBe(false);
  }, 300_000);
});
