import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type {
  CompileOptions,
  CompileResult,
  DumpResult,
  EngineSession,
  Engine as SessionEngine,
} from "../engine/session";
import type { DrawnPage } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { curated } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { parsePackage, type TemplatePackage } from "../templates/package";
import { INCH, US_LETTER } from "../tex/svg";
import {
  COULD_NOT_UPDATE,
  Compiler,
  type CompilerOptions,
  type Engine,
  type Shown,
} from "./compiler";
import { apply, type Document, History, newDocument } from "./document";

const { package: jake, sample } = curated("jake");

/** A request the fake engine has taken, which the test settles when it chooses. */
interface Waiting<T> {
  resolve(value: T): void;
  reject(error: Error): void;
}

/**
 * A stand-in for the engine that notes every request in order, keeps each dump and compile
 * waiting until the test settles it, and takes a format at once. Terminating it only notes that
 * it was, so a test can settle a request after it, as a worker's reply could cross the call.
 */
class FakeEngine implements Engine {
  calls: string[] = [];
  dumps: (Waiting<DumpResult> & { name: string })[] = [];
  puts: { name: string; format: Uint8Array }[] = [];
  compiles: (Waiting<CompileResult> & { body: string; options?: CompileOptions })[] = [];
  terminated = false;

  dump(_engine: SessionEngine, name: string): Promise<DumpResult> {
    this.calls.push(`dump ${name}`);
    return new Promise((resolve, reject) => this.dumps.push({ name, resolve, reject }));
  }

  putFormat(_engine: SessionEngine, name: string, format: Uint8Array): Promise<void> {
    this.calls.push(`put ${name}`);
    this.puts.push({ name, format });
    return Promise.resolve();
  }

  compile(
    _engine: SessionEngine,
    format: string,
    body: string,
    options?: CompileOptions,
  ): Promise<CompileResult> {
    this.calls.push(`compile ${format}`);
    return new Promise((resolve, reject) => this.compiles.push({ body, options, resolve, reject }));
  }

  terminate() {
    this.terminated = true;
  }
}

const FETCHED = { files: 0, bytes: 0, paths: [] };
/** A format's bytes, as a dump hands them back. */
const FORMAT = new Uint8Array([5, 4, 3, 2, 1]);
const dumped = (format = FORMAT): DumpResult => ({
  ok: true,
  format,
  ms: 1,
  log: "",
  fetched: FETCHED,
});
/**
 * A compile's output: one byte that says which compile it was, where 0 is output the page cannot
 * read.
 */
const compiled = (output: number): CompileResult => ({
  ok: true,
  output: new Uint8Array([output]),
  pages: 1,
  passes: [1],
  log: "",
  fetched: FETCHED,
});
const FAILED: CompileResult = {
  ok: false,
  pages: 0,
  passes: [1],
  log: "! Undefined control sequence.\nl.12 \\resumeItm",
  error: "Undefined control sequence.",
  errorLine: 12,
  fetched: FETCHED,
};

/** A fake page that shows which compile it came from, and fails as a draw can for output 0. */
async function draw(output: Uint8Array): Promise<DrawnPage> {
  const which = output[0];
  if (which === 0) throw new Error("the DVI could not be read");
  return {
    svg: `<svg>${which}</svg>`,
    size: US_LETTER,
    fields: new Map(),
    glyphs: [],
    pageCount: 1,
    unmatched: 0,
    // Output 7 uses a font the page cannot draw.
    missingFonts: which === 7 ? new Map([["cmex10", "no outlines"]]) : new Map(),
  };
}

/** The fake draw never reads fonts. */
const NO_FONTS = new FontLibrary(
  new TexLiveIndex({ release: "", layout: 0, bundles: [], files: {} }),
  async () => new Uint8Array(),
);

/** A compiler over fake engines, with what it made and emitted. */
function scheduler(options: CompilerOptions = {}) {
  const engines: FakeEngine[] = [];
  const shown: Shown[] = [];
  const errors: string[] = [];
  const busy: boolean[] = [];
  const compiler = new Compiler(
    () => {
      const engine = new FakeEngine();
      engines.push(engine);
      return engine;
    },
    NO_FONTS,
    {
      page: (page) => shown.push(page),
      error: (message) => errors.push(message),
      busy: (pending) => busy.push(pending),
    },
    { draw, ...options },
  );
  /** The engine made last, which requests go to. */
  const engine = () => {
    const last = engines.at(-1);
    if (last === undefined) throw new Error("no engine has been made");
    return last;
  };
  return { compiler, engines, engine, shown, errors, busy };
}

/** Let every promise that can settle do so, without moving the fake clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const opening = newDocument("jake", sample);
/** The sample with a new title for its first job. */
const titled = (title: string) =>
  apply(opening, { type: "text", field: "fennel.title", text: title });
const bodyOf = (doc: Document, pkg = jake) => generateBody(pkg, doc.resume, doc.controls).latex;
const formatOf = (doc: Document, pkg = jake) => generateFormat(pkg, doc.controls).name;

/** Open the sample and show its first page, from the output 1. */
async function opened(s: ReturnType<typeof scheduler>, pkg = jake) {
  s.compiler.open(pkg, opening);
  s.engine().dumps[0]?.resolve(dumped());
  await settle();
  s.engine().compiles[0]?.resolve(compiled(1));
  await settle();
  expect(s.shown).toHaveLength(1);
}

describe("Compiler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens a document at once: dumps its format, compiles, and shows the page", async () => {
    const s = scheduler();
    s.compiler.open(jake, opening);
    // At once, with no wait for a pause.
    const name = formatOf(opening);
    expect(s.engine().calls).toEqual([`dump ${name}`]);
    expect(s.busy).toEqual([true]);
    s.engine().dumps[0]?.resolve(dumped());
    await settle();
    expect(s.engine().calls).toEqual([`dump ${name}`, `compile ${name}`]);
    const [compile] = s.engine().compiles;
    expect(compile?.body).toBe(bodyOf(opening));
    // The harness's job, and the session's passes: two for a new document, a third if asked.
    expect(compile?.options).toEqual({ job: "doc", maxPasses: 3 });
    compile?.resolve(compiled(1));
    await settle();
    expect(s.shown).toHaveLength(1);
    const [page] = s.shown;
    expect(page?.page.svg).toBe("<svg>1</svg>");
    expect(page?.document).toBe(opening);
    expect(page?.body).toEqual(generateBody(jake, opening.resume, opening.controls));
    expect(page?.ms).toBeGreaterThanOrEqual(0);
    expect(s.busy).toEqual([true, false]);
    expect(s.errors).toEqual([]);
  });

  it("compiles once for three updates within the delay, with the last document", async () => {
    const s = scheduler();
    await opened(s);
    const [a, b, c] = [titled("Analyst"), titled("Builder"), titled("Curator")];
    s.compiler.update(a);
    await wait(60);
    s.compiler.update(b);
    await wait(60);
    s.compiler.update(c);
    await wait(99);
    expect(s.engine().compiles).toHaveLength(1);
    await wait(1);
    expect(s.engine().compiles).toHaveLength(2);
    expect(s.engine().compiles[1]?.body).toBe(bodyOf(c));
    s.engine().compiles[1]?.resolve(compiled(2));
    await settle();
    expect(s.shown.map((page) => page.document)).toEqual([opening, c]);
    // No second dump: the format is the same.
    expect(s.engine().dumps).toHaveLength(1);
  });

  it("waits longer for XeTeX, and as long as it is told", async () => {
    const xetex: TemplatePackage = { ...jake, engine: "xetex" };
    const s = scheduler();
    await opened(s, xetex);
    s.compiler.update(titled("Analyst"));
    await wait(399);
    expect(s.engine().compiles).toHaveLength(1);
    await wait(1);
    expect(s.engine().compiles).toHaveLength(2);

    const quick = scheduler({ delays: { pdftex: 10, xetex: 20 } });
    await opened(quick);
    quick.compiler.update(titled("Analyst"));
    await wait(10);
    expect(quick.engine().compiles).toHaveLength(2);
  });

  it("queues an update during a compile, and compiles the newest as soon as it lands", async () => {
    const s = scheduler();
    await opened(s);
    const [a, b, c] = [titled("Analyst"), titled("Builder"), titled("Curator")];
    s.compiler.update(a);
    await wait(100);
    expect(s.engine().compiles).toHaveLength(2);
    s.compiler.update(b);
    s.compiler.update(c);
    // One compile in flight, however long it takes.
    await wait(5_000);
    expect(s.engine().compiles).toHaveLength(2);
    s.engine().compiles[1]?.resolve(compiled(2));
    await settle();
    // Nothing newer had started, so the page for a shows; and c starts with no second wait.
    expect(s.shown.at(-1)?.document).toBe(a);
    expect(s.engine().compiles).toHaveLength(3);
    expect(s.engine().compiles[2]?.body).toBe(bodyOf(c));
    s.engine().compiles[2]?.resolve(compiled(3));
    await settle();
    expect(s.shown.map((page) => page.page.svg)).toEqual([
      "<svg>1</svg>",
      "<svg>2</svg>",
      "<svg>3</svg>",
    ]);
    expect(s.busy).toEqual([true, false, true, false]);
  });

  it("drops a result that lands after a newer compile started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = scheduler();
    await opened(s);
    const [a, b] = [titled("Analyst"), titled("Builder")];
    s.compiler.update(a);
    await wait(100);
    s.compiler.update(b);
    // a runs past the limit, so b compiles on a new engine.
    await wait(10_000);
    await settle();
    const [first, second] = s.engines;
    expect(second?.compiles[0]?.body).toBe(bodyOf(b));
    // a lands after all, as a reply that crossed the terminate would.
    first?.compiles[1]?.resolve(compiled(2));
    await settle();
    expect(s.shown.map((page) => page.document)).toEqual([opening]);
    second?.compiles[0]?.resolve(compiled(3));
    await settle();
    expect(s.shown.map((page) => page.document)).toEqual([opening, b]);
  });

  it("drops a compile in flight when another document opens, then compiles that one", async () => {
    const s = scheduler();
    await opened(s);
    const [a, other] = [titled("Analyst"), titled("Other")];
    s.compiler.update(a);
    await wait(100);
    s.compiler.open(jake, other);
    // Still one in flight.
    expect(s.engine().compiles).toHaveLength(2);
    s.engine().compiles[1]?.resolve(compiled(2));
    await settle();
    expect(s.shown.map((page) => page.document)).toEqual([opening]);
    expect(s.engine().compiles[2]?.body).toBe(bodyOf(other));
    s.engine().compiles[2]?.resolve(compiled(3));
    await settle();
    expect(s.shown.map((page) => page.document)).toEqual([opening, other]);
  });

  it("dumps a format once for each name, and again only for a new name", async () => {
    // Jake's with its margins bound to the format, as a class that fixes them would have it.
    const margins = jake.controls.margins;
    if (margins === undefined) throw new Error("Jake's Resume has margins");
    const bound = parsePackage({
      ...jake,
      preamble: `${jake.preamble}\n% margins {{margins}}`,
      controls: { ...jake.controls, margins: { ...margins, format: true } },
    });
    const wide = apply(opening, { type: "control", name: "margins", value: 0.8 });
    const [narrowName, wideName] = [formatOf(opening, bound), formatOf(wide, bound)];
    expect(narrowName).not.toBe(wideName);

    const s = scheduler();
    await opened(s, bound);
    s.compiler.update(wide);
    await wait(100);
    expect(s.engine().calls.slice(2)).toEqual([`dump ${wideName}`]);
    s.engine().dumps[1]?.resolve(dumped(new Uint8Array([9])));
    await settle();
    expect(s.engine().compiles[1]?.body).toBe(bodyOf(wide, bound));
    s.engine().compiles[1]?.resolve(compiled(2));
    await settle();
    // Back to the first name, which the engine still holds: neither dumped nor put again.
    s.compiler.update(opening);
    await wait(100);
    expect(s.engine().calls).toEqual([
      `dump ${narrowName}`,
      `compile ${narrowName}`,
      `dump ${wideName}`,
      `compile ${wideName}`,
      `compile ${narrowName}`,
    ]);
  });

  it("keeps the last page, with a plain message, when a compile or its drawing fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = scheduler();
    await opened(s);
    s.compiler.update(titled("Analyst"));
    await wait(100);
    s.engine().compiles[1]?.resolve(FAILED);
    await settle();
    expect(s.errors).toEqual([COULD_NOT_UPDATE]);
    // TeX's words go to the console, the whole log with them.
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Undefined control sequence."),
      FAILED.log,
    );

    s.compiler.update(titled("Builder"));
    await wait(100);
    const lost = new Error("compile worker: failed to load");
    s.engine().compiles[2]?.reject(lost);
    await settle();
    expect(logged).toHaveBeenLastCalledWith(expect.any(String), lost);

    s.compiler.update(titled("Curator"));
    await wait(100);
    s.engine().compiles[3]?.resolve(compiled(0));
    await settle();
    expect(s.errors).toEqual([COULD_NOT_UPDATE, COULD_NOT_UPDATE, COULD_NOT_UPDATE]);
    expect(s.shown).toHaveLength(1);
    expect(s.busy.at(-1)).toBe(false);
  });

  it("reports a format that does not dump, and compiles nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = scheduler();
    s.compiler.open(jake, opening);
    const log = "! LaTeX Error: File `nosuchpackage.sty' not found.";
    s.engine().dumps[0]?.resolve({ ok: false, ms: 1, log, error: "not found", fetched: FETCHED });
    await settle();
    expect(s.errors).toEqual([COULD_NOT_UPDATE]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("did not dump"), log);
    expect(s.engine().compiles).toEqual([]);
    expect(s.busy).toEqual([true, false]);
  });

  it("cuts off a compile past its limit, and compiles what waits on a new engine", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = scheduler();
    await opened(s);
    const [first] = s.engines;
    const [a, b] = [titled("Analyst"), titled("Builder")];
    s.compiler.update(a);
    await wait(100);
    s.compiler.update(b);
    await wait(9_999);
    expect(first?.terminated).toBe(false);
    expect(s.errors).toEqual([]);
    await wait(1);
    await settle();
    expect(first?.terminated).toBe(true);
    expect(s.engines).toHaveLength(2);
    expect(s.errors).toEqual([COULD_NOT_UPDATE]);
    // The new engine is handed the kept format, as a copy, before its first compile.
    const second = s.engine();
    const name = formatOf(opening);
    expect(second.calls).toEqual([`put ${name}`, `compile ${name}`]);
    expect(second.puts[0]?.format).toEqual(FORMAT);
    expect(second.puts[0]?.format).not.toBe(FORMAT);
    expect(second.compiles[0]?.body).toBe(bodyOf(b));
    // The terminated worker's failure was reported when it was cut off.
    first?.compiles[1]?.reject(new Error("compile worker terminated"));
    await settle();
    expect(s.errors).toEqual([COULD_NOT_UPDATE]);
    second.compiles[0]?.resolve(compiled(2));
    await settle();
    expect(s.shown.map((page) => page.document)).toEqual([opening, b]);
    expect(s.busy.at(-1)).toBe(false);
  });

  it("cuts off a dump too, and dumps on the new engine when nothing was kept", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = scheduler({ limits: { pdftex: 1_000, xetex: 2_000 } });
    s.compiler.open(jake, opening);
    await wait(1_000);
    await settle();
    expect(s.engines[0]?.terminated).toBe(true);
    expect(s.errors).toEqual([COULD_NOT_UPDATE]);
    // Nothing waited, so the new engine has nothing to do until the document changes.
    expect(s.engine().calls).toEqual([]);
    expect(s.busy).toEqual([true, false]);
    s.compiler.update(titled("Analyst"));
    await wait(100);
    expect(s.engine().calls).toEqual([`dump ${formatOf(opening)}`]);
  });

  it("stops every timer and the engine when closed, and says nothing after", async () => {
    const s = scheduler();
    await opened(s);
    s.compiler.update(titled("Analyst"));
    expect(vi.getTimerCount()).toBe(1);
    s.compiler.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(s.engine().terminated).toBe(true);
    await wait(20_000);
    expect(s.engine().compiles).toHaveLength(1);

    // With a compile in flight, and its time limit running.
    const t = scheduler();
    await opened(t);
    t.compiler.update(titled("Builder"));
    await wait(100);
    expect(vi.getTimerCount()).toBe(1);
    t.compiler.close();
    expect(vi.getTimerCount()).toBe(0);
    t.engine().compiles[1]?.resolve(compiled(2));
    t.compiler.update(titled("Curator"));
    await wait(20_000);
    expect(t.shown).toHaveLength(1);
    expect(t.errors).toEqual([]);
    expect(t.busy).toEqual([true, false, true]);
  });

  it("shows a page whose fonts it cannot draw, and warns about each font once", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = scheduler();
    await opened(s);
    for (const title of ["Analyst", "Builder"]) {
      s.compiler.update(titled(title));
      await wait(100);
      s.engine().compiles.at(-1)?.resolve(compiled(7));
      await settle();
    }
    expect(s.shown).toHaveLength(3);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("cmex10 (no outlines)"));
  });
});

/** Where the page's glyphs begin on the left, in TeX points: the left margin, for Jake's. */
const leftmost = (page: DrawnPage) => Math.min(...page.glyphs.map((glyph) => glyph.x));

// The scheduler over the real engine, as the app runs it but in Node: the session's methods run
// TeX synchronously, as the worker does, and the scheduler awaits them all the same. Needs
// `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("Compiler through the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;

  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  it("opens Jake's sample, then recompiles after an edit and after a control", async () => {
    const engine: Engine = {
      dump: async (kind, name, preamble, files) => session.dump(kind, name, preamble, files),
      putFormat: async (kind, name, format) => session.putFormat(kind, name, format),
      compile: async (kind, format, body, options) => session.compile(kind, format, body, options),
      terminate: () => {},
    };
    let onPage: ((shown: Shown) => void) | undefined;
    let onError: ((error: Error) => void) | undefined;
    /** The next page the scheduler shows, or its message if it shows none. */
    const nextPage = () =>
      new Promise<Shown>((resolve, reject) => {
        onPage = resolve;
        onError = reject;
      });
    const compiler = new Compiler(() => engine, fonts, {
      page: (shown) => onPage?.(shown),
      error: (message) => onError?.(new Error(message)),
      busy: () => {},
    });
    const history = new History(newDocument("jake", sample));

    let next = nextPage();
    compiler.open(jake, history.present);
    const first = await next;
    // Every field the body marks is on the page, with every glyph matched to its text.
    const { texts } = generateBody(jake, sample, history.present.controls);
    expect(first.page.fields.size).toBe(texts.size);
    for (const id of texts.keys())
      expect(first.page.fields.get(id)?.glyphs.length, id).toBeGreaterThan(0);
    expect(first.page.unmatched).toBe(0);

    next = nextPage();
    const title = "Staff Software Engineer";
    compiler.update(history.dispatch({ type: "text", field: "fennel.title", text: title }));
    const edited = await next;
    expect(edited.body.texts.get("fennel.title")).toBe(title);
    const glyphs = edited.page.fields.get("fennel.title")?.glyphs ?? [];
    expect(glyphs.map((glyph) => glyph.text).join("")).toBe(title.replaceAll(" ", ""));
    expect(edited.page.fields.size).toBe(texts.size);
    expect(edited.page.unmatched).toBe(0);

    next = nextPage();
    compiler.update(history.dispatch({ type: "control", name: "margins", value: 0.8 }));
    const moved = await next;
    expect(leftmost(edited.page)).toBeCloseTo(0.5 * INCH, 2);
    expect(leftmost(moved.page)).toBeCloseTo(0.8 * INCH, 2);
    expect(moved.page.unmatched).toBe(0);
    compiler.close();

    const ms = (shown: Shown) => `${Math.round(shown.ms)} ms`;
    const timings = `first page ${ms(first)}, an edit ${ms(edited)}, a margin ${ms(moved)}`;
    console.log(`jake through the compiler: ${timings}`);
  }, 60_000);
});
