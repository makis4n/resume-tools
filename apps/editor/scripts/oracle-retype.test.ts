import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LockedSection } from "@resume-tools/resume-model";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Compiler, type Engine, type Shown } from "../src/editor/compiler";
import { type Document, History } from "../src/editor/document";
import {
  isRetype,
  NOT_RETYPED,
  type Retype,
  RetypeGuard,
  type RetypeVerdict,
  retypesOf,
  showsTyped,
} from "../src/editor/retype";
import { outsideCheck, outsideDifference } from "../src/editor/retype-check";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { readTree } from "../src/import/fonts";
import { treeImages } from "../src/import/intake";
import { isRefusal } from "../src/import/refusal";
import { type Imported, importResume } from "../src/import/run";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { DocumentStore } from "../src/storage/store";
import { resolveTemplate } from "../src/templates/resolve";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle";
import { uploadOf } from "./corpus-reference";

// Milestone 3 item 16's done-test (decision 0042): on each upstream sample, a locked part's words
// retyped as the editor retypes them, through the compiler, in the document's own job, kept only
// where the document compiles, the page outside the part is the page before it to the glyph and
// the part shows the words typed; and a retype that must be taken back, taken back. Every word
// typed here is made from the page's own by an invented substitution of its letters, and a part
// is chosen by the template's commands it calls, so that no sample's text is in this file, and
// numbers alone, with the template's command names, reach the test's output.
//
// TODO(the second pass's item 7): a `.tex` import is an outline now (decision 0049), which keeps
// no locked section, so there is nothing here to retype until item 7 gives kept text the retype.

const engineManifest = () =>
  JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest;

/** An upstream sample imported as the browser imports a resume, on a session of its own. */
async function importedSample(id: string, fonts: FontLibrary): Promise<Imported> {
  const oracle = Oracle.parse(JSON.parse(readFileSync(ORACLE_FILE, "utf8")));
  const doc = oracle.documents.find((each) => each.id === id);
  if (doc === undefined) throw new Error(`${id} is no oracle sample`);
  const manifest = engineManifest();
  const zip = uploadOf(
    oracleDocument(doc),
    (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
    () => undefined,
  );
  const outcome = await importResume([{ name: `${id}.zip`, bytes: zip }], {
    session: await startNodeSession(),
    fonts,
    tree: readTree(manifest.files, manifest.fonts),
    treeImage: treeImages(
      manifest.files,
      (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
    ),
  });
  if (isRefusal(outcome)) throw new Error(`${id} refused: ${outcome.reason}`);
  return outcome;
}

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

/** What a compile the compiler ran came to: a page, its document stopping it, or a message. */
type Landed = { page: Shown } | { stopped: Document } | { error: string };

/**
 * An invented spelling of a text, of its length and its shape: each letter another, in the same
 * case, from an invented cycle, each digit another digit, and every other character as it is.
 */
function invented(text: string): string {
  const cycle = "quilwrenfotsabdkm";
  let at = 0;
  return [...text]
    .map((char) => {
      if (/\d/.test(char)) return String((Number(char) + 3) % 10);
      if (!/\p{L}/u.test(char)) return char;
      const letter = cycle[at++ % cycle.length] as string;
      return char === char.toUpperCase() ? letter.toUpperCase() : letter;
    })
    .join("");
}

/** A text with its first word of four letters or more spelled anew (`invented`), and the rest kept. */
const firstWordAnew = (text: string) =>
  text.replace(/\p{L}{4,}/u, (word) => invented(word).slice(0, word.length));

/** The locked section of a document whose LaTeX calls a template's command, by its name. */
function partCalling(document: Document, command: RegExp): LockedSection {
  const found = document.resume.sections.find(
    (section): section is LockedSection => section.kind === "locked" && command.test(section.latex),
  );
  if (found === undefined) throw new Error(`no locked part calls ${command}`);
  return found;
}

describe.skip("a locked part retyped on the oracle's samples (decision 0042)", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  const stores: DocumentStore[] = [];
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = engineManifest();
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);
  afterAll(async () => {
    for (const store of stores) await store.close();
  });

  /**
   * A sample imported, kept in a store of its own and opened through the compiler, as the app
   * opens it; and how to retype a part of it and wait for what the compile came to.
   */
  async function opened(id: string) {
    const imported = await importedSample(id, fonts);
    const name = `resume-tools-retype-${id}-${Date.now()}`;
    const store = new DocumentStore({ name });
    stores.push(store);
    const docId = await store.importDocument(imported);
    const stored = await store.get(docId);
    if (stored === undefined) throw new Error("not stored");
    const template = await resolveTemplate(stored.document.template, docId, store);
    if (template === undefined) throw new Error("no template");
    let land: (landed: Landed) => void = () => {};
    const compiler = new Compiler(
      engineOf(session),
      fonts,
      {
        page: (page) => land({ page }),
        stopped: (document) => land({ stopped: document }),
        error: (error) => land({ error }),
        busy: () => {},
      },
      { formats: store.formatsFor("test") },
    );
    const next = () =>
      new Promise<Landed>((resolve) => {
        land = resolve;
      });
    const history = new History(stored.document, template.package);
    const opening = next();
    compiler.open(template.package, history.present, template.job);
    const first = await opening;
    if (!("page" in first)) throw new Error(`${id} did not open`);
    const guard = new RetypeGuard(outsideCheck(fonts));
    /** Retype `retype`'s runs as `texts`, on the page `shown`: the verdict, and the page after. */
    const retype = async (found: Retype, texts: string[], shown: Shown) => {
      const after = guard.start(history, found, texts, shown);
      if (after === "unchanged" || "why" in after) throw new Error(`not started: ${String(after)}`);
      const landing = next();
      compiler.update(after);
      const landed = await landing;
      let verdict: RetypeVerdict | undefined;
      if ("page" in landed) verdict = await guard.paged(landed.page);
      else if ("stopped" in landed) verdict = guard.stopped(landed.stopped);
      else verdict = guard.failed();
      if (verdict === undefined) throw new Error("no verdict");
      return { verdict, landed, after };
    };
    return {
      imported,
      store,
      name,
      docId,
      stored,
      history,
      compiler,
      next,
      first: first.page,
      retype,
    };
  }

  /**
   * Retype one run of `part` with `typed` made from its text, keep it, and check what the
   * milestone asks: the document compiles, the page outside the part is the page before it to the
   * glyph, the part shows the words typed, and the kept document is what a new store reads back.
   */
  async function keeps(
    id: string,
    setup: Awaited<ReturnType<typeof opened>>,
    part: LockedSection,
    run: (retype: Retype) => number,
    typed: (text: string) => string,
  ) {
    const { first, history, store, name, docId, stored } = setup;
    const found = retypesOf(history.present, first.pages).get(part.id);
    if (found === undefined || !isRetype(found)) throw new Error(`${id}: the part offers nothing`);
    const index = run(found);
    const texts = found.pieces.map((piece) => piece.text);
    texts[index] = typed(texts[index] ?? "");
    const { verdict, landed, after } = await setup.retype(found, texts, first);
    expect(verdict, `${id}'s retype`).toEqual({ kept: true });
    if (!("page" in landed)) throw new Error("no page");
    const page = landed.page;
    // Checked again here, apart from the guard: the outputs' streams outside the part, and the
    // part's glyphs.
    expect(
      (
        await outsideDifference(
          fonts,
          first.output as Uint8Array,
          page.output as Uint8Array,
          part.id,
        )
      )?.kind,
      "the page outside the part",
    ).toBeUndefined();
    expect(showsTyped(found, texts, page.pages), "the part shows the words typed").toBe(true);
    expect(page.pages.length, "pages").toBe(first.pages.length);
    expect(history.present).toBe(after);
    // Kept as the app keeps it, and read back by a new store over the same database.
    store.save(docId, history.present, stored.revision);
    expect((await store.flush()).written).toBe(1);
    const again = new DocumentStore({ name });
    const reread = await again.get(docId);
    await again.close();
    const latex = (document: Document | undefined) =>
      document?.resume.sections.find((section) => section.id === part.id);
    expect(latex(reread?.document)).toEqual(latex(history.present));
    expect(latex(reread?.document)).not.toEqual(part);
    // Numbers alone: which run of how many, how many glyphs the part sets, the compile's time.
    console.log(
      `${id}: retyped run ${index + 1} of ${found.pieces.length} of a part of ${found.glyphs.length} glyphs, kept; the page took ${page.ms.toFixed(0)} ms`,
    );
    return page;
  }

  test("Jake's sample: its heading and its skills retyped and kept, and a retype too long taken back", async () => {
    const setup = await opened("jake-0000");
    const { history } = setup;
    // The heading block, kept whole: the first locked part, which centres it.
    const heading = partCalling(history.present, /\\begin\{center\}/);
    const page = await keeps("jake-0000", setup, heading, () => 0, invented);
    // The skills block, a list of its own: each line's text after its label.
    const skills = partCalling(history.present, /\\begin\{itemize\}/);
    const next = await keeps("jake-0000", { ...setup, first: page }, skills, () => 1, invented);
    // The heading's name typed six times over runs onto more lines, which moves the sections
    // under it: taken back. (The skills, the page's last part, move nothing when they grow.)
    const found = retypesOf(history.present, next.pages).get(heading.id);
    if (found === undefined || !isRetype(found)) throw new Error("the heading offers nothing");
    const before = history.present;
    const texts = found.pieces.map((piece) => piece.text);
    texts[0] = Array(6)
      .fill(invented(texts[0] ?? ""))
      .join(" ");
    const { verdict } = await setup.retype(found, texts, next);
    expect(verdict).toEqual({ kept: false, why: "moved" });
    expect(history.present).toBe(before);
    expect(history.canRedo).toBe(false);
    // The page before it comes again.
    const landing = setup.next();
    setup.compiler.update(history.present);
    const back = await landing;
    if (!("page" in back)) throw new Error("no page after taking back");
    expect(back.page.pages.map((each) => each.svg)).toEqual(next.pages.map((each) => each.svg));
    console.log(
      "jake-0000: the heading's name typed six times over taken back, as it moved the page",
    );
    setup.compiler.close();
  }, 600_000);

  test("AltaCV's sample: a wheel chart's label retyped and kept, and a part with no words offers nothing", async () => {
    const setup = await opened("altacv-0000");
    const { history, first } = setup;
    const chart = partCalling(history.present, /\\wheelchart\b/);
    await keeps("altacv-0000", setup, chart, () => 0, invented);
    // The bibliography's part sets no word the page shows as its own: nothing to retype, and
    // why in plain words.
    const bibliography = partCalling(history.present, /\\printbibliography\b/);
    const found = retypesOf(history.present, first.pages).get(bibliography.id);
    expect(found).toEqual({ reason: NOT_RETYPED.notShown });
    setup.compiler.close();
  }, 600_000);

  test("Awesome-CV's sample: a word of its summary paragraph retyped and kept", async () => {
    const setup = await opened("awesome-cv-0000");
    const summary = partCalling(setup.history.present, /\\begin\{cvparagraph\}/);
    await keeps("awesome-cv-0000", setup, summary, () => 0, firstWordAnew);
    setup.compiler.close();
  }, 600_000);
});
