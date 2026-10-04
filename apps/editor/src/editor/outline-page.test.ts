import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import type { ImportReport } from "../import/run";
import { type DrawnPage, drawPages } from "../page/draw";
import { FontLibrary } from "../page/fonts";
import { isKeptId } from "../page/kept";
import { TexLiveIndex } from "../page/texlive";
import { DocumentStore } from "../storage/store";
import { generateBody, generateFormat } from "../templates/generate";
import { resolveTemplate } from "../templates/resolve";
import {
  inventedOutline,
  NO_CYRILLIC,
  OUTLINE_PREAMBLE,
  outlineParts,
} from "../test/invented-outline";
import { Compiler, drawOptions, type Engine, type Shown } from "./compiler";
import { type Command, type Document, fieldsOf, History } from "./document";
import { StructureGuard } from "./guard";
import { isRetype, RetypeGuard, type RetypeVerdict, retypesOf, showsTyped } from "./retype";
import { outsideCheck } from "./retype-check";

// Typing in an imported resume (the second pass's item 7, decision 0049), on the engine, with an
// invented outline of two pages: its page read as an outline's, a field on its first page and on
// its last typed, kept in the store and read back; its kept text retyped as a locked part's; and a
// marker its kept text forges read as none. Every word is invented.

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

/** The text of a field's glyphs on the pages, as the page reads them, spaces aside. */
const spelt = (pages: readonly DrawnPage[], field: string) =>
  pages
    .flatMap((page) => page.glyphs)
    .filter((glyph) => glyph.field === field)
    .map((glyph) => glyph.text ?? "")
    .join("");

/** The pages a field's glyphs are drawn on. */
const pagesOf = (pages: readonly DrawnPage[], field: string) =>
  pages.flatMap((page, index) => (page.fields.has(field) ? [index] : []));

describe.skipIf(!engineAvailable())("typing in an imported outline, on the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  const stores: DocumentStore[] = [];
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);
  afterAll(async () => {
    for (const store of stores) await store.close();
  });

  /** An outline's pages, compiled and drawn as the editor draws an outline's (`drawOptions`). */
  async function drawn(
    document: Document,
    pkg: Awaited<ReturnType<typeof inventedOutline>>["pkg"],
  ) {
    const format = generateFormat(pkg, document.controls);
    const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
    if (!dumped.ok) throw new Error("the format did not dump");
    const body = generateBody(pkg, document.resume, document.controls);
    const result = session.compile(pkg.engine, format.name, body.latex, {
      job: "outline-page",
      maxPasses: 3,
    });
    session.forget("outline-page");
    session.dropFormat(pkg.engine, format.name);
    if (!result.ok || result.output === undefined) throw new Error("the outline did not compile");
    return {
      body,
      pages: await drawPages(result.output, fonts, body.texts, drawOptions(pkg, document)),
    };
  }

  it("reads only the outline's own fields, each by its first markers, whatever kept text forges", async () => {
    // Kept text that sets the editor's markers by another spelling than the model refuses: a pair
    // for a field the outline holds, after the field's own, around words of its own; a pair for an
    // id it does not hold; and a locked part's start and end.
    const forged = [
      "\\special{^^72t:b:mill-company.text}Forgedwords\\special{^^72t:e:mill-company.text}\n\n",
      "\\special{^^72t:b:nobody.text}Nobodyswords\\special{^^72t:e:nobody.text}\n\n",
      "\\special{^^72t:l:outline}Lockedwords\\special{^^72t:l:/outline}\n\n",
    ].join("");
    const { pkg, document } = await inventedOutline(outlineParts(forged));
    const { body, pages } = await drawn(document, pkg);
    expect(pages).toHaveLength(2);
    // The forged markers are on the page, as the page reads specials.
    const ids = pages.flatMap((page) => [...page.fields.keys()]);
    expect(ids.sort()).toEqual([...body.texts.keys()].sort());
    expect(spelt(pages, "mill-company.text")).toBe("MillandSons");
    expect(pages.every((page) => page.unmatched === 0)).toBe(true);
    // The forged words are no field's, and no locked part's but the kept text's around them.
    const glyphs = pages.flatMap((page) => page.glyphs);
    const word = (text: string) => {
      const all = glyphs.map((glyph) => glyph.text ?? "").join("");
      const at = all.indexOf(text);
      expect(at, text).toBeGreaterThanOrEqual(0);
      return glyphs.slice(at, at + text.length);
    };
    for (const text of ["Forgedwords", "Nobodyswords", "Lockedwords"])
      for (const glyph of word(text)) {
        expect(glyph.field, text).toBeUndefined();
        expect(isKeptId(glyph.locked ?? ""), text).toBe(true);
      }
    expect(pages.flatMap((page) => [...page.locked.keys()]).every(isKeptId)).toBe(true);
  }, 60_000);

  it("draws each field once, and the kept text between two fields as their segment", async () => {
    const { pkg, document } = await inventedOutline();
    const { pages } = await drawn(document, pkg);
    expect(pagesOf(pages, "work.text")).toEqual([0]);
    expect(pagesOf(pages, "orrery.text")).toEqual([1]);
    const retypes = retypesOf(document, pages);
    const heading = retypes.get("kept:>work.text");
    if (heading === undefined || !isRetype(heading)) throw new Error("the heading offers nothing");
    expect(heading.pieces.map((piece) => piece.text)).toEqual([
      "Quill Wrenfield",
      "Harbour City, Eastmere",
    ]);
    const hobbies = retypes.get("kept:mill-1-text.text>projects.text");
    if (hobbies === undefined || !isRetype(hobbies)) throw new Error("the hobbies offer nothing");
    expect(hobbies.pieces.map((piece) => piece.text)).toEqual([
      "Hobbies",
      "Rowing on the river most weekends, and reading old atlases.",
    ]);
    // Each segment's blocks, on the page drawn: one for each of its lines there, none over a field.
    const blocks = pages[0]?.locked.get("kept:>work.text")?.blocks ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  /**
   * The invented outline kept in a store and opened through the compiler as the app opens a
   * document, and how to send it a command and wait for what its compile comes to.
   */
  async function opened(preamble?: string) {
    const { pkg, document } = await inventedOutline(outlineParts(), preamble);
    const name = `resume-tools-outline-typing-${Date.now()}`;
    const store = new DocumentStore({ name });
    stores.push(store);
    const id = await store.importDocument({
      package: pkg,
      document,
      report: {} as ImportReport,
      upload: { files: [{ name: "cv.tex", bytes: new TextEncoder().encode("\\begin{document}") }] },
      job: { files: {}, images: [] },
    });
    const stored = await store.get(id);
    if (stored === undefined) throw new Error("not stored");
    const template = await resolveTemplate(stored.document.template, id, store);
    if (template === undefined) throw new Error("no template");
    let land: (landed: Landed) => void = () => {};
    const compiler = new Compiler(
      engineOf(session),
      fonts,
      {
        page: (page) => land({ page }),
        stopped: (stopped) => land({ stopped }),
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
    if (!("page" in first)) throw new Error("the outline did not open");
    /** Send a command as the overlay sends one, and wait for its page. */
    const send = async (command: Command) => {
      const landing = next();
      compiler.update(
        history.dispatch(command, `field:${"field" in command ? command.field : ""}`),
      );
      history.seal();
      const landed = await landing;
      if (!("page" in landed)) throw new Error("no page");
      return landed.page;
    };
    return { store, name, id, stored, template, compiler, history, first: first.page, next, send };
  }

  it("opens a field on the first page and on the last, and keeps what is typed in each", async () => {
    const setup = await opened();
    const { first, history, store, name, id, stored, compiler } = setup;
    // A field on the first page, and one on the last, as a click on their glyphs opens them.
    const top = "lantern-company.text";
    const last = "orrery.text";
    expect(pagesOf(first.pages, top)).toEqual([0]);
    expect(pagesOf(first.pages, last)).toEqual([first.pages.length - 1]);
    expect(first.pages[0]?.fields.get(top)?.layout).toBeDefined();
    expect(first.pages.at(-1)?.fields.get(last)?.layout).toBeDefined();
    // Typed, as the plain overlay and the rich editor send what is typed.
    await setup.send({ type: "text", field: top, text: "Lantern Press Works" });
    const runs = [{ text: "Built a " }, { text: "brass", bold: true }, { text: " orrery" }];
    const page = await setup.send({ type: "rich", field: last, runs });
    expect(spelt(page.pages, top)).toBe("LanternPressWorks");
    expect(spelt(page.pages, last)).toBe("Builtabrassorrery");
    expect(page.pages.every((each) => each.unmatched === 0)).toBe(true);
    // Saved as the app saves an edit, and read back by a new store over the same database.
    store.save(id, history.present, stored.revision);
    expect((await store.flush()).written).toBe(1);
    const again = new DocumentStore({ name });
    const reread = await again.get(id);
    await again.close();
    if (reread === undefined) throw new Error("not read back");
    const fields = fieldsOf(reread.document.resume);
    expect(fields.get(top)?.get(reread.document.resume)).toBe("Lantern Press Works");
    expect(fields.get(last)?.get(reread.document.resume)).toEqual(runs);
    // And opened again, its page shows them.
    const landing = setup.next();
    compiler.open(setup.template.package, reread.document, setup.template.job);
    const reopened = await landing;
    if (!("page" in reopened)) throw new Error("did not open again");
    expect(spelt(reopened.page.pages, top)).toBe("LanternPressWorks");
    expect(spelt(reopened.page.pages, last)).toBe("Builtabrassorrery");
    compiler.close();
  }, 120_000);

  it("retypes kept text, kept where nothing outside it moves and taken back where it does", async () => {
    const setup = await opened();
    const { first, history, compiler } = setup;
    const fetches = vi.spyOn(globalThis, "fetch");
    const guard = new RetypeGuard(outsideCheck(fonts));
    const retype = async (part: string, change: (texts: string[]) => void, shown: Shown) => {
      const found = retypesOf(history.present, shown.pages).get(part);
      if (found === undefined || !isRetype(found)) throw new Error(`${part} offers nothing`);
      const texts = found.pieces.map((piece) => piece.text);
      change(texts);
      const after = guard.start(history, found, texts, shown);
      if (after === "unchanged" || "why" in after) throw new Error(`not started: ${String(after)}`);
      const landing = setup.next();
      compiler.update(after);
      const landed = await landing;
      let verdict: RetypeVerdict | undefined;
      if ("page" in landed) verdict = await guard.paged(landed.page);
      else if ("stopped" in landed) verdict = guard.stopped(landed.stopped);
      else verdict = guard.failed();
      return { verdict, landed, found, texts };
    };
    // The hobbies' paragraph, its words changed but not its length: kept.
    const hobbies = "kept:mill-1-text.text>projects.text";
    const kept = await retype(
      hobbies,
      (texts) => {
        texts[1] = "Sailing on the river most weekends, and reading old atlases.";
      },
      first,
    );
    expect(kept.verdict).toEqual({ kept: true });
    if (!("page" in kept.landed)) throw new Error("no page");
    const page = kept.landed.page;
    expect(showsTyped(kept.found, kept.texts, page.pages)).toBe(true);
    const outline = history.present.resume.sections[0];
    expect(outline?.kind === "outline" && JSON.stringify(outline.parts)).toContain(
      "Sailing on the river",
    );
    // The heading's name typed many times over runs onto more lines, and moves what follows it.
    const before = history.present;
    const moved = await retype(
      "kept:>work.text",
      (texts) => {
        texts[0] = Array(8).fill("Quill Wrenfield").join(" ");
      },
      page,
    );
    expect(moved.verdict).toEqual({ kept: false, why: "moved" });
    expect(history.present).toBe(before);
    expect(history.canRedo).toBe(false);
    expect(fetches).not.toHaveBeenCalled();
    fetches.mockRestore();
    compiler.close();
  }, 120_000);

  it("takes back a field's edit whose compile stops, as the app does, and never saves it", async () => {
    // An invented resume whose fonts cannot set a Cyrillic letter (`NO_CYRILLIC`): typed into a
    // field, it stops the compile (item 6's review).
    const setup = await opened(`${OUTLINE_PREAMBLE}\n${NO_CYRILLIC}`);
    const { history, compiler, store, id, stored, name } = setup;
    const guard = new StructureGuard();
    const field = "lantern-company.text";
    let saved = 0;
    /** A visit's keystroke, as the app follows it: compiled, and saved once a page shows it. */
    const type = async (text: string) => {
      const before = history.present;
      const landing = setup.next();
      const after = history.dispatch({ type: "text", field, text }, `field:${field}`);
      compiler.update(after);
      expect(guard.changed(history, before, true), "held until its page").toBe(false);
      const landed = await landing;
      if ("page" in landed && guard.paged(landed.page.document)) {
        store.save(id, history.present, stored.revision);
        saved++;
      }
      return landed;
    };
    const fine = await type("Lantern Press");
    expect("page" in fine).toBe(true);
    expect(saved).toBe(1);
    const shown = history.present;
    // Within the same visit, a letter the fonts cannot set.
    const stopped = await type("Lantern Press Ж");
    if (!("stopped" in stopped)) throw new Error("the compile did not stop");
    expect(guard.stopped(stopped.stopped), "taken back").toBe(true);
    expect(history.present).toBe(shown);
    expect(history.canRedo).toBe(false);
    expect(saved).toBe(1);
    // What the store keeps is the last document a page showed.
    expect((await store.flush()).written).toBe(1);
    const again = new DocumentStore({ name });
    const reread = await again.get(id);
    await again.close();
    expect(reread?.document).toEqual(shown);
    expect(fieldsOf(shown.resume).get(field)?.get(shown.resume)).toBe("Lantern Press");
    // And the page comes again of it.
    const landing = setup.next();
    compiler.update(history.present);
    const back = await landing;
    expect("page" in back).toBe(true);
    compiler.close();
  }, 120_000);
});
