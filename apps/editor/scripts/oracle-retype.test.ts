import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RichText } from "@resume-tools/resume-model";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Compiler, type Engine, type Shown } from "../src/editor/compiler";
import { type Command, type Document, fieldsOf, History } from "../src/editor/document";
import { keptSegments, outlineOf, writtenFields } from "../src/editor/outline";
import {
  isRetype,
  type Retype,
  RetypeGuard,
  type RetypeVerdict,
  retypesOf,
  showsTyped,
} from "../src/editor/retype";
import { outsideCheck, outsideDifference } from "../src/editor/retype-check";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { readTree } from "../src/import/fonts";
import { treeImages } from "../src/import/intake";
import { isRefusal } from "../src/import/refusal";
import { type Imported, importResume } from "../src/import/run";
import type { DrawnPage } from "../src/page/draw";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { DocumentStore } from "../src/storage/store";
import { resolveTemplate } from "../src/templates/resolve";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle";
import { uploadOf } from "./corpus-reference";

// The second pass's item 7 (decision 0049) on the upstream samples, each imported as the browser
// imports a resume, as an outline, kept in a store and opened through the compiler on the engine,
// as the app opens it: a field on its first page and one on its last typed, as the overlay sends
// what is typed, kept in the store, read back by a new store over the same database and shown again
// on the page; and a run of its kept text retyped as decision 0042 retypes a locked part's, kept
// only where the document compiles, the page outside the kept text is the page before it to the
// glyph and the kept text shows the words typed. Every text typed is made from the sample's own by
// an invented substitution of its letters, the fields and the kept text chosen by where they are
// and the template's commands around them, so that no sample's text is in this file, and numbers
// alone, with the template's command names, reach the test's output.

const engineManifest = () =>
  JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest;

/** Whether this machine has fetched the oracle's samples, which `corpus oracle` fetches. */
const fetched = existsSync(join(ORACLE_DIR, "jake-0000", "resume.tex"));

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

/** A text's letters and digits alone, lowercased, as the page's glyphs and a field's text compare. */
const lettersOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** A field's glyphs' texts on the pages, joined, as the page reads them. */
const spelt = (pages: readonly DrawnPage[], field: string) =>
  pages
    .flatMap((page) => page.glyphs)
    .filter((glyph) => glyph.field === field)
    .map((glyph) => glyph.text ?? "")
    .join("");

/** A field's text as it is typed: plain, or a rich field's runs joined. */
const textOf = (value: string | RichText) =>
  typeof value === "string" ? value : value.map((run) => run.text).join("");

/**
 * The fields of a document a page shows whole, in the order it draws them: each with a layout, the
 * overlay's place, holding a word of four letters or more, every letter and digit of its text a
 * glyph of it on the page.
 */
function wholeFields(document: Document, page: DrawnPage): string[] {
  const fields = fieldsOf(document.resume);
  return [...page.fields].flatMap(([id, field]) => {
    const value = fields.get(id)?.get(document.resume);
    if (field.layout === undefined || value === undefined) return [];
    if (typeof value !== "string" && !Array.isArray(value)) return [];
    const text = textOf(value);
    if (!/\p{L}{4,}/u.test(text)) return [];
    const glyphs = page.glyphs.filter((glyph) => glyph.field === id);
    return lettersOf(glyphs.map((glyph) => glyph.text ?? "").join("")) === lettersOf(text)
      ? [id]
      : [];
  });
}

/** The command that types `field`'s text anew (`invented`), as the overlay or the rich editor sends it. */
function typing(document: Document, field: string): { command: Command; typed: string } {
  const ref = fieldsOf(document.resume).get(field);
  if (ref?.kind === "text") {
    const typed = invented(ref.get(document.resume) ?? "");
    return { command: { type: "text", field, text: typed }, typed };
  }
  if (ref?.kind === "rich") {
    const runs = ref.get(document.resume).map((run) => ({ ...run, text: invented(run.text) }));
    return { command: { type: "rich", field, runs }, typed: textOf(runs) };
  }
  throw new Error(`${field} is not a text field`);
}

/**
 * What each sample's test types and retypes: the kept text whose run is retyped, by a command the
 * LaTeX around it calls; and how many pages the sample sets.
 */
const SAMPLES: Readonly<Record<string, { kept: RegExp; pages: number }>> = {
  // The skills block, after its section's title: each line's text after its label.
  "jake-0000": { kept: /\\textbf\{/, pages: 1 },
  // The contacts after the photo: a web address's words.
  "altacv-0000": { kept: /\\homepage\b/, pages: 2 },
  // The header's contacts.
  "awesome-cv-0000": { kept: /\\mobile\b/, pages: 3 },
};

describe.skipIf(!fetched || !engineAvailable())(
  "typing and retyping on the oracle's samples, imported as outlines (the second pass's item 7)",
  () => {
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
     * opens it; and how to send it a command, or retype its kept text, and wait for what the
     * compile came to.
     */
    async function opened(id: string) {
      const imported = await importedSample(id, fonts);
      const name = `resume-tools-typing-${id}-${Date.now()}`;
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
      /** A visit to a field, as the overlay makes one: its command, then its page. */
      const send = async (command: Command, field: string) => {
        const landing = next();
        compiler.update(history.dispatch(command, `field:${field}`));
        history.seal();
        const landed = await landing;
        if (!("page" in landed)) throw new Error(`${id}: no page after typing`);
        return landed.page;
      };
      const guard = new RetypeGuard(outsideCheck(fonts));
      /**
       * Retype `found`'s runs as `texts` on `on`, whose present the page `shown` shows: the verdict,
       * and the page after.
       */
      const retype = async (on: History, found: Retype, texts: string[], shown: Shown) => {
        const after = guard.start(on, found, texts, shown);
        if (after === "unchanged" || "why" in after)
          throw new Error(`not started: ${String(after)}`);
        const landing = next();
        compiler.update(after);
        const landed = await landing;
        let verdict: RetypeVerdict | undefined;
        if ("page" in landed) verdict = await guard.paged(landed.page);
        else if ("stopped" in landed) verdict = guard.stopped(landed.stopped);
        else verdict = guard.failed();
        if (verdict === undefined) throw new Error("no verdict");
        return { verdict, landed };
      };
      return {
        store,
        name,
        docId,
        stored,
        template,
        history,
        compiler,
        next,
        first: first.page,
        send,
        retype,
      };
    }

    for (const [id, sample] of Object.entries(SAMPLES))
      test(`${id}: a field on its first page and one on its last typed, kept and read back; its kept text retyped`, async () => {
        const setup = await opened(id);
        const { history, store, name, docId, stored, compiler, first } = setup;
        expect(first.pages, "pages").toHaveLength(sample.pages);

        // A field on the first page, and one on the last: the first the page shows whole there,
        // and the last on the last page, which for a sample of one page is another of the first.
        const top = wholeFields(history.present, first.pages[0] as DrawnPage)[0];
        const bottom = wholeFields(history.present, first.pages.at(-1) as DrawnPage).at(-1);
        if (top === undefined || bottom === undefined || top === bottom)
          throw new Error(`${id}: no field to type in`);
        const typedTop = typing(history.present, top);
        await setup.send(typedTop.command, top);
        const typedBottom = typing(history.present, bottom);
        const page = await setup.send(typedBottom.command, bottom);
        expect(lettersOf(spelt(page.pages, top)), "the first page's field").toBe(
          lettersOf(typedTop.typed),
        );
        expect(lettersOf(spelt(page.pages, bottom)), "the last page's field").toBe(
          lettersOf(typedBottom.typed),
        );
        expect(page.pages.map((each) => each.unmatched)).toEqual(first.pages.map(() => 0));

        // Saved as the app saves an edit, read back by a new store over the same database, and
        // opened again: the page shows what was typed.
        store.save(docId, history.present, stored.revision);
        expect((await store.flush()).written).toBe(1);
        const again = new DocumentStore({ name });
        const reread = await again.get(docId);
        await again.close();
        if (reread === undefined) throw new Error(`${id}: not read back`);
        const fields = fieldsOf(reread.document.resume);
        expect(textOf(fields.get(top)?.get(reread.document.resume) as string | RichText)).toBe(
          typedTop.typed,
        );
        expect(textOf(fields.get(bottom)?.get(reread.document.resume) as string | RichText)).toBe(
          typedBottom.typed,
        );
        const reloaded = new History(reread.document, setup.template.package);
        const landing = setup.next();
        compiler.open(setup.template.package, reloaded.present, setup.template.job);
        const reopened = await landing;
        if (!("page" in reopened)) throw new Error(`${id}: did not open again`);
        expect(lettersOf(spelt(reopened.page.pages, top))).toBe(lettersOf(typedTop.typed));
        expect(lettersOf(spelt(reopened.page.pages, bottom))).toBe(lettersOf(typedBottom.typed));
        const firstPage = top.split(".")[0];
        const lastPage = bottom.split(".")[0];
        console.info(
          `${id}: typed a field on page 1 (${firstPage}) and on page ${first.pages.length} (${lastPage}), kept and read back`,
        );

        // A run of kept text retyped, on the page the reopened document shows: its first word of
        // four letters or more spelled anew.
        const shown = reopened.page;
        const outline = outlineOf(shown.document.resume);
        if (outline === undefined) throw new Error(`${id}: no outline`);
        const retypes = retypesOf(shown.document, shown.pages);
        const segment = keptSegments(outline).find((each) => {
          const found = retypes.get(each.id);
          return sample.kept.test(each.latex) && found !== undefined && isRetype(found);
        });
        const found = segment && retypes.get(segment.id);
        if (segment === undefined || found === undefined || !isRetype(found))
          throw new Error(`${id}: no kept text to retype`);
        const index = found.pieces.findIndex((piece) => /\p{L}{4,}/u.test(piece.text));
        const texts = found.pieces.map((piece) => piece.text);
        texts[index] = firstWordAnew(texts[index] ?? "");
        const { verdict, landed } = await setup.retype(reloaded, found, texts, shown);
        expect(verdict, `${id}'s retype`).toEqual({ kept: true });
        if (!("page" in landed)) throw new Error("no page");
        // Checked again here, apart from the guard: the outputs' streams outside the kept text.
        expect(
          (
            await outsideDifference(
              fonts,
              shown.output as Uint8Array,
              landed.page.output as Uint8Array,
              segment.id,
              writtenFields(outline),
            )
          )?.kind,
          "the page outside the kept text",
        ).toBeUndefined();
        expect(
          showsTyped(found, texts, landed.page.pages),
          "the kept text shows the words typed",
        ).toBe(true);
        console.info(
          `${id}: retyped run ${index + 1} of ${found.pieces.length} of kept text of ${found.glyphs.length} glyphs, kept; the page took ${landed.page.ms.toFixed(0)} ms`,
        );
        compiler.close();
      }, 600_000);
  },
);
