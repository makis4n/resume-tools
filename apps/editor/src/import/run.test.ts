import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume } from "@resume-tools/resume-model";
import { strToU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import { Compiler, type Engine, type Shown } from "../editor/compiler";
import { type Document, fieldsOf, History } from "../editor/document";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { handleName, LIMITS, type NameDeps, type ServiceCache } from "../service/name";
import { MemoryPreambleCache } from "../service/preamble";
import { MemoryRateStore } from "../service/rate";
import { DocumentStore } from "../storage/store";
import { resolveTemplate, type Template } from "../templates/resolve";
import { JAKE_FORK } from "../test/jake-fork";
import { readTree } from "./fonts";
import { treeImages } from "./intake";
import { isRefusal } from "./refusal";
import {
  IMPORT_STEPS,
  type ImportDeps,
  type Imported,
  type ImportProgress,
  importResume,
  type NameRequest,
  uploadOf,
} from "./run";
import { NamingServiceError, nameOnService } from "./service";

// Every file here is invented for these tests: the fork of Jake's Resume holds invented words in
// the template's own shape (`../test/jake-fork.ts`); nothing is a real person's resume.

const tex = (name: string, text: string) => ({ name, bytes: strToU8(text) });

/** The committed answers, the seed among them, which the naming route reads first. */
const ANSWERS_DIR = fileURLToPath(new URL("../../corpus/answers/", import.meta.url));

describe("uploadOf", () => {
  test("takes one file as it is, and packs several into a zip at their names", () => {
    const one = tex("cv.tex", "\\documentclass{article}");
    expect(uploadOf([one])).toBe(one);
    const packed = uploadOf([one, tex("invented.cls", "\\ProvidesClass{invented}")]);
    if (isRefusal(packed)) throw new Error(packed.message);
    expect(packed.name).toBe("upload.zip");
    expect(Object.keys(unzipSync(packed.bytes)).sort()).toEqual(["cv.tex", "invented.cls"]);
  });

  test("refuses no file, a zip among several, and two files of one name, in plain words", () => {
    expect(uploadOf([])).toMatchObject({ refused: true, reason: "intake" });
    const zip = { name: "resume.zip", bytes: new Uint8Array([0x50, 0x4b, 3, 4]) };
    expect(uploadOf([tex("cv.tex", ""), zip])).toMatchObject({
      message: "Upload one zip on its own, or your .tex file with the files it needs beside it.",
    });
    expect(uploadOf([tex("cv.tex", ""), tex("cv.tex", "")])).toMatchObject({
      message: "This upload holds two files named cv.tex.",
    });
  });
});

describe.skipIf(!engineAvailable())("an import, on the engine (decision 0038)", () => {
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

  /**
   * The naming step as the dev server answers it with no key: the service's own handler, over the
   * committed answers alone, which it reads and never writes, and no model; no network.
   */
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
  const naming: NameRequest = (request, names, signal) =>
    nameOnService(
      request,
      (input, init) => handleName(new Request(new URL(input, "http://localhost"), init), service),
      signal,
      names,
    );

  /** The compile engine the app's worker is, over the Node session, as the compiler takes one. */
  const engine = (): Engine => ({
    start: async () => {},
    dump: async (kind, name, preamble, files) => session.dump(kind, name, preamble, files),
    putFormat: async (kind, name, format) => session.putFormat(kind, name, format),
    forget: async (job) => session.forget(job),
    compile: async (kind, format, body, options) => session.compile(kind, format, body, options),
    pdf: async (job, options) => session.pdf(job, options),
    dropFormat: async (kind, name) => session.dropFormat(kind, name),
    terminate: () => {},
  });

  /** A compiler over the session, and the next page it shows, or its message if it shows none. */
  function editor(store: DocumentStore) {
    let onPage: (shown: Shown) => void = () => {};
    let onError: (error: Error) => void = () => {};
    const compiler = new Compiler(
      engine,
      deps.fonts,
      {
        page: (shown) => onPage(shown),
        error: (message) => onError(new Error(message)),
        busy: () => {},
      },
      { formats: store.formatsFor("test") },
    );
    const nextPage = () =>
      new Promise<Shown>((resolve, reject) => {
        onPage = resolve;
        onError = reject;
      });
    return { compiler, nextPage };
  }

  /** A document's template as the app resolves it, which must be there. */
  async function templateOf(store: DocumentStore, doc: Document, id: string): Promise<Template> {
    const template = await resolveTemplate(doc.template, id, store);
    if (template === undefined) throw new Error(`no template ${doc.template}`);
    return template;
  }

  /** What a field of the page spells, its glyphs' text joined. */
  const spelt = (shown: Shown, field: string) =>
    (shown.page.fields.get(field)?.glyphs ?? []).map((glyph) => glyph.text).join("");

  test("imports a fork of Jake's Resume, which opens, edits, saves, downloads and opens after a reload", async () => {
    const steps: ImportProgress[] = [];
    const outcome = await importResume(
      [tex("resume.tex", JAKE_FORK)],
      { ...deps, name: naming },
      (step) => steps.push(step),
    );
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    const imported: Imported = outcome;
    // Each step named in plain words, in order, the compiles counted as they came.
    expect([...new Set(steps.map((step) => step.step))]).toEqual([
      "intake",
      "reference",
      "fonts",
      "signatures",
      "parse",
      "probe",
      "request",
      "naming",
      "validate",
    ]);
    expect(steps.every((step) => step.label === IMPORT_STEPS[step.step])).toBe(true);
    expect(steps.at(-1)?.compiles).toBe(imported.report.compiles);
    expect(imported.report.compiles).toBeGreaterThan(10);
    // The seed answers every macro the fork calls, as the service's cache.
    expect(imported.report.naming).toMatchObject({ missing: 0 });
    expect(imported.report.naming).toHaveProperty("hits");
    expect(imported.package.id).toMatch(/^import-[0-9a-f]{12}$/);
    expect(imported.document.template).toBe(imported.package.id);
    expect(imported.report.checks.fields.editable).toBeGreaterThan(8);
    expect(imported.upload).toEqual({ files: [tex("resume.tex", JAKE_FORK)] });
    // The job's files are the upload's but for the main file, which the body replaces.
    expect(Object.keys(imported.job.files)).not.toContain("resume.tex");
    // The import forgot its jobs.
    expect(session.written("import", "import.tex")).toBeUndefined();

    // Kept, and opened as any document is, with its package from the store.
    const name = `resume-tools-import-${Date.now()}`;
    const store = new DocumentStore({ name });
    const id = await store.importDocument(imported);
    const stored = await store.get(id);
    if (stored === undefined) throw new Error("not stored");
    const template = await templateOf(store, stored.document, id);
    expect(template.package).toEqual(imported.package);
    const { compiler, nextPage } = editor(store);
    const history = new History(stored.document, template.package);
    let next = nextPage();
    compiler.open(template.package, history.present, template.job);
    const first = await next;
    expect(first.page.fields.size).toBeGreaterThan(8);
    expect(first.page.unmatched).toBe(0);

    // An entry's title, edited as the page's overlay edits it.
    const entries = history.present.resume.sections.flatMap((section) =>
      section.kind === "entries" ? section.entries : [],
    );
    const field = [...fieldsOf(history.present.resume).keys()].find((each) =>
      entries.some((entry) => each === `${entry.id}.title`),
    );
    if (field === undefined) throw new Error("no entry title to edit");
    next = nextPage();
    compiler.update(history.dispatch({ type: "text", field, text: "Invented Lead" }));
    const edited = await next;
    expect(spelt(edited, field)).toBe("InventedLead");
    store.save(id, history.present, stored.revision);
    expect((await store.flush()).written).toBe(1);
    const pdf = await compiler.pdf();
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    compiler.close();
    await store.close();

    // After a reload: a new store over the same database, and a new compiler.
    const reloaded = new DocumentStore({ name });
    expect((await reloaded.list()).map((each) => [each.id, each.templateName])).toEqual([
      [id, imported.package.name],
    ]);
    const again = await reloaded.get(id);
    if (again === undefined) throw new Error("lost in the reload");
    expect(Resume.parse(again.document.resume)).toEqual(history.present.resume);
    const reopened = await templateOf(reloaded, again.document, id);
    const later = editor(reloaded);
    next = later.nextPage();
    later.compiler.open(reopened.package, again.document, reopened.job);
    const shown = await next;
    expect(spelt(shown, field)).toBe("InventedLead");
    expect(shown.page.unmatched).toBe(0);
    later.compiler.close();
    // Its last document gone, the package goes, and its formats with it.
    expect(await reloaded.remove(id)).toBe(imported.package.id);
    await reloaded.close();
  }, 60_000);

  test("comes through with no naming service, every macro as the probe left it, and says why", async () => {
    const unreachable: NameRequest = () =>
      Promise.reject(
        new NamingServiceError(
          0,
          "The naming service could not be reached. Check the connection and try again.",
        ),
      );
    const outcome = await importResume([tex("resume.tex", JAKE_FORK)], {
      ...deps,
      name: unreachable,
    });
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    expect(outcome.report.naming).toEqual({
      failed: "The naming service could not be reached. Check the connection and try again.",
    });
    // The template's macros answered nothing, so what they set is kept as the upload wrote it.
    expect(outcome.report.checks.words.locked.unmapped ?? 0).toBeGreaterThan(0);
    expect(outcome.document.resume.sections.some((section) => section.kind === "locked")).toBe(
      true,
    );
  }, 60_000);

  test("stops between compiles when its signal is aborted, and forgets its jobs", async () => {
    const stop = new AbortController();
    const reason = new Error("stopped by the test");
    const run = importResume(
      [tex("resume.tex", JAKE_FORK)],
      { ...deps, name: naming },
      (step) => {
        if (step.step === "signatures" && !step.compiling) stop.abort(reason);
      },
      stop.signal,
    );
    await expect(run).rejects.toBe(reason);
    expect(session.written("import", "import.tex")).toBeUndefined();
  }, 60_000);
});
