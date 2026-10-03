import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LockedSection } from "@resume-tools/resume-model";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { readTree } from "../import/fonts";
import { treeImages } from "../import/intake";
import { isRefusal } from "../import/refusal";
import { type ImportDeps, importResume, type NameRequest } from "../import/run";
import { nameOnService } from "../import/service";
import { drawPages } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { handleName, LIMITS, type NameDeps, type ServiceCache } from "../service/name";
import { MemoryPreambleCache } from "../service/preamble";
import { MemoryRateStore } from "../service/rate";
import { DocumentStore } from "../storage/store";
import { generateBody, generateFormat } from "../templates/generate";
import { resolveTemplate } from "../templates/resolve";
import { JAKE_FORK } from "../test/jake-fork";
import { Compiler, type Engine, type Shown } from "./compiler";
import { History } from "./document";
import { isRetype, RetypeGuard, retypesOf, showsTyped } from "./retype";
import { outsideCheck } from "./retype-check";

// Decision 0042's rule that nothing new leaves the browser: a locked part's words retyped, through
// the compiler and the store as the app wires them, make no request of any kind, and the naming
// request, built by the import's own builder and let through by its own gate (`assertNoText`), holds
// none of them, even for an upload whose part already says them. Every word is invented.

const ANSWERS_DIR = fileURLToPath(new URL("../../corpus/answers/", import.meta.url));

/** The words typed over the heading's name: invented, and found nowhere in the fork. */
const TYPED = "Zephyrine Quokkamaw";

const tex = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(text) });

describe.skipIf(!engineAvailable())("a retype and what leaves the browser (decision 0042)", () => {
  let session: EngineSession;
  let deps: Omit<ImportDeps, "name">;
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

  /** The naming step as the dev server answers it with no key: the committed answers alone. */
  const committed: ServiceCache = {
    get: (key) => {
      const path = join(ANSWERS_DIR, `${key}.json`);
      return /^[0-9a-f]{64}$/.test(key) && existsSync(path)
        ? readFileSync(path, "utf8")
        : undefined;
    },
    put: () => false,
  };
  const service: NameDeps = {
    cache: committed,
    preambles: new MemoryPreambleCache(),
    model: undefined,
    rates: new MemoryRateStore(),
    limits: LIMITS,
    now: Date.now,
    address: "127.0.0.1",
  };

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

  test("a retype makes no request, and the naming request holds none of the words typed", async () => {
    // Every naming request an import sends, as the service would receive it.
    const sent: string[] = [];
    const recording: NameRequest = (request, names, signal) => {
      sent.push(JSON.stringify(request).toLowerCase());
      return nameOnService(
        request,
        (input, init) => handleName(new Request(new URL(input, "http://localhost"), init), service),
        signal,
        names,
      );
    };
    const imported = await importResume([tex("resume.tex", JAKE_FORK)], {
      ...deps,
      name: recording,
    });
    if (isRefusal(imported)) throw new Error(`refused: ${imported.reason}`);
    expect(sent).toHaveLength(1);

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
    const heading = history.present.resume.sections.find(
      (section): section is LockedSection =>
        section.kind === "locked" && section.latex.includes("\\begin{center}"),
    );
    if (heading === undefined) throw new Error("the heading is not kept as a part");
    const found = retypesOf(history.present, first.pages).get(heading.id);
    if (found === undefined || !isRetype(found)) throw new Error("the heading offers nothing");
    const name = found.pieces[0]?.text ?? "";
    expect(name.length).toBeGreaterThan(0);
    const texts = found.pieces.map((piece) => piece.text);
    texts[0] = TYPED;

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
    store.save(id, history.present, stored.revision);
    expect((await store.flush()).written).toBe(1);
    expect(fetches).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    compiler.close();
    await store.close();

    // The request the import sent before holds none of the words typed.
    for (const word of TYPED.toLowerCase().split(" ")) expect(sent[0]).not.toContain(word);

    // And the import's request builder and its gate, given the resume as the retype left it, its
    // heading saying the words typed: the gate lets the request through, so that the import is not
    // refused, and the request holds none of them.
    const retyped = JAKE_FORK.replace(name, TYPED);
    expect(retyped).not.toBe(JAKE_FORK);
    const again = await importResume([tex("resume.tex", retyped)], { ...deps, name: recording });
    if (isRefusal(again)) throw new Error(`refused: ${again.reason}`);
    expect(sent).toHaveLength(2);
    for (const word of TYPED.toLowerCase().split(" ")) expect(sent[1]).not.toContain(word);
  }, 300_000);

  test("offers no accent's braced letter, nor the run the accent joins, on the engine", async () => {
    // The heading's invented name with an accent written as an OT1 document writes one.
    const accented = JAKE_FORK.replace("Quill Invented", String.raw`Quill M\"{u}ller`);
    expect(accented).not.toBe(JAKE_FORK);
    const naming: NameRequest = (request, names, signal) =>
      nameOnService(
        request,
        (input, init) => handleName(new Request(new URL(input, "http://localhost"), init), service),
        signal,
        names,
      );
    const imported = await importResume([tex("resume.tex", accented)], { ...deps, name: naming });
    if (isRefusal(imported)) throw new Error(`refused: ${imported.reason}`);
    const { package: pkg, document, job } = imported;
    const format = generateFormat(pkg, document.controls);
    expect(session.dump(pkg.engine, format.name, format.preamble, format.files).ok).toBe(true);
    const body = generateBody(pkg, document.resume, document.controls);
    const result = session.compile(pkg.engine, format.name, body.latex, {
      job: "accent",
      maxPasses: 3,
      files: job.files,
    });
    session.forget("accent");
    session.dropFormat(pkg.engine, format.name);
    if (!result.ok || result.output === undefined) throw new Error("the document did not compile");
    const pages = await drawPages(result.output, deps.fonts, body.texts);
    const heading = document.resume.sections.find(
      (section): section is LockedSection =>
        section.kind === "locked" && section.latex.includes("\\begin{center}"),
    );
    if (heading === undefined) throw new Error("the heading is not kept as a part");
    const found = retypesOf(document, pages).get(heading.id);
    if (found === undefined || !isRetype(found)) throw new Error("the heading offers nothing");
    // The run before the accent is offered; the accented letter and the run it joins are not.
    expect(found.pieces.map((piece) => piece.text)).toEqual([
      "Quill M",
      "555-0100",
      "quill@example.invalid",
      "quill.example",
    ]);
  }, 300_000);
});
