import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { curated } from "../templates/curated";
import {
  type ControlValues,
  controlValuesFor,
  defaultControls,
  parsePackage,
} from "../templates/package";
import { Compiler, type Engine, type Shown } from "./compiler";
import { apply, type Document, History, newDocument } from "./document";
import { applyFit, fit, fitSteps, type Trier } from "./fit";

const { package: jake, sample } = curated("jake");

/** The three controls the search steps, as each setting has them. */
const stepped = ({ density, margins, fontSize }: ControlValues) => ({ density, margins, fontSize });

describe("fitSteps", () => {
  it("lists Jake's steps from its defaults: density, margins, then the font size to its least", () => {
    const steps = fitSteps(jake, {});
    // From normal, 0.5 in and 11 pt, a step each round while each has one left.
    expect(steps.map(stepped)).toEqual([
      { density: "compact", margins: 0.5, fontSize: 11 },
      { density: "compact", margins: 0.4, fontSize: 11 },
      { density: "compact", margins: 0.4, fontSize: 10.5 },
      { density: "compact", margins: 0.4, fontSize: 10 },
      { density: "compact", margins: 0.4, fontSize: 9.5 },
      { density: "compact", margins: 0.4, fontSize: 9 },
    ]);
    // Every other control stays at the document's value, the default here.
    const others = { pageSize: "letter", font: "lm", accent: "#000000", dateFormat: "MMM yyyy" };
    for (const step of steps) expect(step).toMatchObject(others);
  });

  it("starts from the document's own choices, and leaves the others as they are", () => {
    const own: ControlValues = {
      pageSize: "a4",
      margins: 0.6,
      fontSize: 12,
      font: "charter",
      density: "relaxed",
    };
    const steps = fitSteps(jake, own);
    expect(steps.map(stepped)).toEqual([
      { density: "normal", margins: 0.6, fontSize: 12 },
      { density: "normal", margins: 0.5, fontSize: 12 },
      { density: "normal", margins: 0.5, fontSize: 11.5 },
      { density: "compact", margins: 0.5, fontSize: 11.5 },
      { density: "compact", margins: 0.4, fontSize: 11.5 },
      { density: "compact", margins: 0.4, fontSize: 11 },
      { density: "compact", margins: 0.4, fontSize: 10.5 },
      { density: "compact", margins: 0.4, fontSize: 10 },
      { density: "compact", margins: 0.4, fontSize: 9.5 },
      { density: "compact", margins: 0.4, fontSize: 9 },
    ]);
    for (const step of steps)
      expect(step).toMatchObject({ pageSize: "a4", font: "charter", accent: "#000000" });
    // At every control's least there is nothing to try.
    expect(fitSteps(jake, { density: "compact", margins: 0.4, fontSize: 9 })).toEqual([]);
  });

  it("skips the controls a package does not offer", () => {
    const { fontSize, dateFormat } = jake.controls;
    const sizesOnly = parsePackage({ ...jake, controls: { fontSize, dateFormat } });
    expect(fitSteps(sizesOnly, {})).toEqual([
      { fontSize: 10.5, dateFormat: "MMM yyyy" },
      { fontSize: 10, dateFormat: "MMM yyyy" },
      { fontSize: 9.5, dateFormat: "MMM yyyy" },
      { fontSize: 9, dateFormat: "MMM yyyy" },
    ]);
    const none = parsePackage({ ...jake, controls: { dateFormat } });
    expect(fitSteps(none, {})).toEqual([]);
  });

  it("steps through the sizes an imported class declares, and no other", () => {
    // As `article` declares 10, 11 and 12 points and ignores any other (decision 0026).
    const { fontSize, dateFormat } = jake.controls;
    if (fontSize === undefined) throw new Error("Jake's Resume offers a font size");
    const declared = parsePackage({
      ...jake,
      controls: { fontSize: { ...fontSize, default: 12, sizes: [10, 11, 12] }, dateFormat },
    });
    expect(fitSteps(declared, {}).map((step) => step.fontSize)).toEqual([11, 10]);
    const schema = controlValuesFor(declared);
    for (const start of [10, 11, 12])
      for (const step of fitSteps(declared, { fontSize: start }))
        expect(schema.safeParse(step).success, JSON.stringify(step)).toBe(true);
  });

  it("gives only values the package takes, from every starting point", () => {
    const schema = controlValuesFor(jake);
    for (const density of ["compact", "normal", "relaxed"] as const)
      for (let tenth = 4; tenth <= 10; tenth++)
        for (let half = 18; half <= 24; half++) {
          const start = { density, margins: tenth / 10, fontSize: half / 2 };
          const steps = fitSteps(jake, start);
          for (const step of steps)
            expect(schema.safeParse(step).success, JSON.stringify(step)).toBe(true);
          // Each step is one control a step further, so the steps run out at every least.
          expect(steps.at(-1) ?? start).toMatchObject({
            density: "compact",
            margins: 0.4,
            fontSize: 9,
          });
        }
  });

  it("steps a value off the grid onto it, and never out of the control's range", () => {
    // No document holds such a value, since the package's schema refuses it, and the compiler
    // refuses to try one; a step from one lands on the grid and within the range all the same.
    const sizes = fitSteps(jake, { fontSize: 10.25 }).map((step) => step.fontSize);
    // The size's first step, after the density's and the margins', is 10, and the last is 9.
    expect(sizes).toEqual([10.25, 10.25, 10, 9.5, 9]);
    const margins = fitSteps(jake, { margins: 0.44 }).map((step) => step.margins);
    expect(margins).toEqual([0.44, 0.4, 0.4, 0.4, 0.4, 0.4]);
    const tightest = { density: "compact", margins: 0.4 } as const;
    const large = fitSteps(jake, { ...tightest, fontSize: 13 }).map((step) => step.fontSize);
    expect(large).toEqual([12, 11.5, 11, 10.5, 10, 9.5, 9]);
  });
});

/**
 * A stand-in for the compiler, whose open document is the one the test gives, and which answers
 * each trial with the next page count it was given, or with `error`.
 */
class FakeTrier implements Trier {
  readonly tried: ControlValues[] = [];
  /** Called with each trial as it is asked for, before it answers. */
  onTry: (values: ControlValues) => void = () => {};

  constructor(
    public document: Document | undefined,
    private readonly pages: number[],
    private readonly error?: Error,
  ) {}

  async tryControls(values: ControlValues): Promise<number> {
    this.tried.push(values);
    this.onTry(values);
    if (this.error) throw this.error;
    const pages = this.pages[this.tried.length - 1];
    if (pages === undefined) throw new Error("the test gave no more page counts");
    return pages;
  }
}

describe("fit", () => {
  const doc = newDocument("jake", sample);
  const steps = fitSteps(jake, doc.controls);

  it("tries each step in turn, and stops at the first that sets one page", async () => {
    const compiler = new FakeTrier(doc, [2, 2, 1, 1]);
    expect(await fit(compiler, jake, doc)).toEqual({ values: steps[2], tried: 3 });
    expect(compiler.tried).toEqual(steps.slice(0, 3));
  });

  it("finds nothing when no step sets one page", async () => {
    const compiler = new FakeTrier(doc, [2, 2, 2, 2, 2, 2]);
    expect(await fit(compiler, jake, doc)).toBeUndefined();
    expect(compiler.tried).toEqual(steps);
    // A document at every least has nothing to try.
    const least = apply(doc, { type: "control", name: "fontSize", value: 9 });
    const tight = [
      { type: "control", name: "margins", value: 0.4 },
      { type: "control", name: "density", value: "compact" },
    ] as const;
    const tightest = tight.reduce<Document>((before, command) => apply(before, command), least);
    const none = new FakeTrier(tightest, []);
    expect(await fit(none, jake, tightest)).toBeUndefined();
    expect(none.tried).toEqual([]);
  });

  it("stops when the document changes underneath it", async () => {
    const edited = apply(doc, { type: "text", field: "fennel.title", text: "Staff Engineer" });
    // An edit lands while the second step compiles.
    const compiler = new FakeTrier(doc, [2, 1, 1]);
    compiler.onTry = () => {
      if (compiler.tried.length === 2) compiler.document = edited;
    };
    expect(await fit(compiler, jake, doc)).toBeUndefined();
    expect(compiler.tried).toHaveLength(2);
    // A document the compiler does not have open is not tried at all.
    const other = new FakeTrier(edited, [1]);
    expect(await fit(other, jake, doc)).toBeUndefined();
    expect(other.tried).toEqual([]);
  });

  it("fails when a step's compile fails", async () => {
    const failed = new Error("the trial did not compile");
    await expect(fit(new FakeTrier(doc, [], failed), jake, doc)).rejects.toBe(failed);
  });

  it("takes no margins step that sets more pages than the setting before it (decision 0040)", async () => {
    // The density to compact sets two pages; the margins a tenth narrower set three, as one margin
    // on every side can widen a top the document had narrower: the search goes on from compact,
    // stepping the margins no more.
    const compiler = new FakeTrier(doc, [2, 3, 2, 1]);
    const compact = steps[0] as ControlValues;
    const tail = fitSteps(jake, compact, { margins: false });
    expect(tail.every((step) => step.margins === compact.margins)).toBe(true);
    const found = await fit(compiler, jake, doc);
    expect(compiler.tried).toEqual([steps[0], steps[1], tail[0], tail[1]]);
    expect(found).toEqual({ values: tail[1], tried: 4 });
  });

  it("tries the document's own values first where the margins step first, as an import's do", async () => {
    // A package with no density control, as an imported one: its first step is the margins',
    // whose pages are held to the document's own.
    const plain = parsePackage({
      ...jake,
      id: "jake-without-density",
      controls: { ...jake.controls, density: undefined },
    });
    const own = { ...defaultControls(plain), ...doc.controls };
    const first = fitSteps(plain, doc.controls)[0] as ControlValues;
    expect(first.margins).toBeLessThan(own.margins ?? 0);
    const tail = fitSteps(plain, own, { margins: false });
    const refused = new FakeTrier(doc, [2, 3, 1]);
    expect(await fit(refused, plain, doc)).toEqual({ values: tail[0], tried: 3 });
    expect(refused.tried).toEqual([own, first, tail[0]]);
    // A step that sets no more pages than the document's own is taken.
    const taken = new FakeTrier(doc, [2, 2, 1]);
    const second = fitSteps(plain, doc.controls)[1];
    expect(await fit(taken, plain, doc)).toEqual({ values: second, tried: 3 });
  });
});

describe("applyFit", () => {
  it("sets each control the fit changed as one step, which one undo takes back", () => {
    const history = new History(newDocument("jake", sample));
    const opened = history.present;
    // A visit to a field whose step has not ended yet: the fit is a step of its own all the same.
    history.dispatch({ type: "text", field: "fennel.title", text: "Staff Engineer" }, "field:x");
    const edited = history.present;
    const values: ControlValues = {
      ...defaultControls(jake),
      density: "compact",
      margins: 0.4,
      fontSize: 10,
    };
    const fitted = applyFit(history, jake, values);
    expect(fitted).toBe(history.present);
    expect(fitted.controls).toEqual({ density: "compact", margins: 0.4, fontSize: 10 });
    // Nothing else in the document changes.
    expect(fitted.resume).toBe(edited.resume);
    expect(history.undo()).toBe(edited);
    expect(history.undo()).toBe(opened);
    expect(history.canUndo).toBe(false);
  });

  it("sets only the controls the fit changed, and keeps the document's other choices", () => {
    const history = new History(
      apply(newDocument("jake", sample), { type: "control", name: "font", value: "palatino" }),
    );
    const before = history.present;
    // Only the density moved: the margins and the size are still the package's defaults.
    applyFit(history, jake, { ...defaultControls(jake), font: "palatino", density: "compact" });
    expect(history.present.controls).toEqual({ font: "palatino", density: "compact" });
    expect(history.undo()).toBe(before);
    // A later command is a step of its own, not part of the fit's.
    applyFit(history, jake, { ...defaultControls(jake), font: "palatino", margins: 0.4 });
    history.dispatch({ type: "control", name: "accent", value: "#1F4E79" }, "fit");
    expect(history.undo()?.controls).toEqual({ font: "palatino", margins: 0.4 });
  });
});

/** Invented bullets, a line or two each, that `grown` adds to a resume's first job. */
const MORE_BULLETS = [
  "Kept the nightly build under ten minutes by caching dependencies and splitting the slowest suites across four workers.",
  "Wrote the on-call guide for the billing service and ran the first three drills with the new rotation.",
  "Moved image resizing to a job queue, so that a slow upload no longer held up the pages behind it.",
  "Reviewed about forty pull requests a month, and started the checklist the team still uses for schema changes.",
];

/** A resume with `count` more bullets under its first job, too long for one page when many. */
function grown(resume: Resume, count: number): Resume {
  const bullets = Array.from({ length: count }, (_, i) => ({
    id: `more-${i + 1}`,
    text: [{ text: MORE_BULLETS[i % MORE_BULLETS.length] ?? "" }],
  }));
  let added = false;
  const sections = resume.sections.map((section) => {
    if (added || section.kind !== "entries" || section.role !== "experience") return section;
    added = true;
    const [first, ...rest] = section.entries;
    if (first === undefined) return section;
    return {
      ...section,
      entries: [{ ...first, bullets: [...first.bullets, ...bullets] }, ...rest],
    };
  });
  return { ...resume, sections };
}

// The search through the real engine, as the app runs it but in Node. Needs `.engine/`
// (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("fit through the engine", () => {
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

  it("fits Jake's sample, grown past a page, onto one, and one undo takes the fit back", async () => {
    // The session started before the test, so there is nothing left to start.
    const engine: Engine = {
      start: async () => {},
      dump: async (kind, name, preamble, files) => session.dump(kind, name, preamble, files),
      putFormat: async (kind, name, format) => session.putFormat(kind, name, format),
      forget: async (job) => session.forget(job),
      compile: async (kind, format, body, options) => session.compile(kind, format, body, options),
      pdf: async (job, options) => session.pdf(job, options),
      terminate: () => {},
    };
    let pages = 0;
    let onPage: ((shown: Shown) => void) | undefined;
    let onError: ((error: Error) => void) | undefined;
    /** The next page the compiler shows, or its message if it shows none. */
    const nextPage = () =>
      new Promise<Shown>((resolve, reject) => {
        onPage = resolve;
        onError = reject;
      });
    const compiler = new Compiler(() => engine, fonts, {
      page: (shown) => {
        pages++;
        onPage?.(shown);
      },
      error: (message) => onError?.(new Error(message)),
      busy: () => {},
    });
    // Long enough that compact spacing and the narrowest margins are not enough by themselves.
    const history = new History(newDocument("jake", grown(sample, 44)));

    let next = nextPage();
    compiler.open(jake, history.present);
    const long = await next;
    expect(long.page.pageCount).toBe(2);

    const before = history.present;
    const started = performance.now();
    const found = await fit(compiler, jake, before);
    const ms = performance.now() - started;
    if (found === undefined) throw new Error("no step fits the grown sample on one page");
    // The search went through the density and the margins to the font size.
    expect(found.values).toMatchObject({ density: "compact", margins: 0.4 });
    expect(found.values.fontSize).toBeLessThan(11);
    // The trials compiled in a job of their own and showed nothing.
    expect(pages).toBe(1);

    next = nextPage();
    compiler.update(applyFit(history, jake, found.values));
    const fitted = await next;
    expect(fitted.page.pageCount).toBe(1);
    expect(fitted.page.unmatched).toBe(0);
    expect(history.present.resume).toBe(before.resume);
    expect(history.undo()).toBe(before);
    compiler.close();

    const { density, margins, fontSize } = found.values;
    console.log(
      `fit: ${found.tried} compiles in ${Math.round(ms)} ms, to ${density}, ${margins} in, ${fontSize} pt`,
    );
  }, 60_000);
});
