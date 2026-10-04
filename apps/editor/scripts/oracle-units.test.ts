import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type OutlineGroup, outlineNodes } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, test } from "vitest";
import { Compiler, type Shown } from "../src/editor/compiler";
import { type Command, type Document, History } from "../src/editor/document";
import { StructureGuard } from "../src/editor/guard";
import { outlineFields, outlineOf, unitEnding, unitPlace } from "../src/editor/outline";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { movedDown, placedGlyphs } from "../src/test/moved-down";
import { engineManifest, engineOf, fetched, importedSample } from "./oracle-samples";

// The second pass's item 8 (decision 0049) on the upstream samples, each imported as the browser
// imports a resume and opened through the compiler on the engine, as the app opens it: a bullet
// added after a list's first, as Enter at the end of its text adds one, the page then the page
// before but for the new bullet and what moves down; the bullet removed, the page then the page
// before to the glyph; and every group of the three takes a unit more and one fewer, none fixed
// (decision 0055). The list is chosen by the template's command its bullets are set with, so that
// no sample's text is in this file, and numbers alone reach the test's output.

/** Each sample's list: the kept text its bullets begin with, which no unit before it holds. */
const SAMPLES: Readonly<Record<string, RegExp>> = {
  // The first experience's bullets.
  "jake-0000": /^\\resumeItem\{$/,
  // The first job's description, in the left column.
  "altacv-0000": /^\\item\s*$/,
  // The first job with a description's items.
  "awesome-cv-0000": /^\\item\s*$/,
};

/** What a compile the compiler ran came to: a page, its document stopping it, or a message. */
type Landed = { page: Shown } | { stopped: Document } | { error: string };

/** The first group of an outline whose units begin with kept text `begins` matches. */
function listOf(document: Document, begins: RegExp): OutlineGroup | undefined {
  for (const node of outlineNodes(outlineOf(document.resume)?.parts ?? [])) {
    if (node.kind !== "part" || node.part.kind !== "group") continue;
    const group = node.part;
    const first = group.units[0]?.parts[0];
    if (group.units.length >= 2 && first?.kind === "kept" && begins.test(first.latex)) return group;
  }
  return undefined;
}

describe.skipIf(!fetched || !engineAvailable())(
  "adding and removing a bullet on the oracle's samples, imported as outlines (the second pass's item 8)",
  () => {
    let session: EngineSession;
    let fonts: FontLibrary;
    beforeAll(async () => {
      session = await startNodeSession();
      const manifest = engineManifest();
      fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
        readFileSync(join(ENGINE_DIR, "files", path)),
      );
    }, 60_000);

    for (const [id, begins] of Object.entries(SAMPLES))
      test(`${id}: a bullet added after a list's first and removed, the rest of the page kept`, async () => {
        const imported = await importedSample(id, fonts);
        const { package: pkg, job } = imported;
        let land: (landed: Landed) => void = () => {};
        const compiler = new Compiler(engineOf(session), fonts, {
          page: (page) => land({ page }),
          stopped: (document) => land({ stopped: document }),
          error: (error) => land({ error }),
          busy: () => {},
        });
        const next = () =>
          new Promise<Landed>((resolve) => {
            land = resolve;
          });
        const history = new History(imported.document, pkg);
        const opening = next();
        compiler.open(pkg, history.present, job);
        const first = await opening;
        if (!("page" in first)) throw new Error(`${id} did not open`);
        // No group of the sample is fixed (decision 0055), so every one takes the steps.
        const groups = [...outlineNodes(outlineOf(history.present.resume)?.parts ?? [])].flatMap(
          (node) => (node.kind === "part" && node.part.kind === "group" ? [node.part] : []),
        );
        expect(groups.filter((group) => group.fixed !== undefined)).toEqual([]);

        // Enter at the end of the list's first bullet: the unit its last field ends.
        const list = listOf(history.present, begins);
        const unit = list?.units[0];
        const fields = unit === undefined ? [] : [...outlineFields(unit.parts)];
        const field = fields.at(-1)?.part;
        if (list === undefined || field === undefined) throw new Error(`${id}: no list`);
        const outline = outlineOf(history.present.resume);
        const place = unitEnding(outline?.parts ?? [], field.id);
        expect(place?.group.id).toBe(list.id);
        expect(place?.index).toBe(0);

        const guard = new StructureGuard();
        /** A step as the app takes one: held until its page, which lets it go. */
        const step = async (command: Command) => {
          const before = history.present;
          const landing = next();
          compiler.update(history.dispatch(command));
          expect(guard.changed(history, before, true)).toBe(false);
          const landed = await landing;
          if (!("page" in landed)) throw new Error(`${id}: no page after the step`);
          expect(guard.paged(landed.page.document)).toBe(true);
          return landed.page;
        };
        const added = await step({
          type: "structure",
          op: { op: "addUnit", after: list.units[0]?.id ?? "" },
        });
        const now = unitPlace(
          outlineOf(history.present.resume)?.parts ?? [],
          list.units[0]?.id ?? "",
        );
        const copy = now?.group.units[1];
        if (copy === undefined) throw new Error(`${id}: no copy`);
        const before = placedGlyphs(first.page.pages);
        const after = placedGlyphs(added.pages);
        const moved = movedDown(before, after);
        expect(moved.problem, `${id}: the page after the bullet`).toBeUndefined();
        expect(after, `${id}: the page changed`).not.toEqual(before);
        expect(added.pages.map((page) => page.unmatched)).toEqual(added.pages.map(() => 0));
        const removed = await step({ type: "structure", op: { op: "removeUnit", id: copy.id } });
        expect(placedGlyphs(removed.pages), `${id}: the page after the removal`).toEqual(before);
        // The glyphs before that stand nowhere they stood: those the bullet moved down.
        const spot = (glyph: (typeof before)[number]) =>
          JSON.stringify([glyph.page, glyph.x, glyph.y, glyph.text, glyph.font, glyph.size]);
        const standing = new Map<string, number>();
        for (const glyph of after) standing.set(spot(glyph), (standing.get(spot(glyph)) ?? 0) + 1);
        const lower = before.filter((glyph) => {
          const left = standing.get(spot(glyph)) ?? 0;
          standing.set(spot(glyph), left - 1);
          return left <= 0;
        }).length;
        console.info(
          `${id}: list ${groups.indexOf(list) + 1} of ${groups.length} groups, ${list.units.length} bullets; a bullet added after its first (its own glyphs ${moved.added}, ${lower} of ${before.length} glyphs moved) and removed, the page then the first to the glyph; ${added.ms.toFixed(0)} ms and ${removed.ms.toFixed(0)} ms`,
        );
        compiler.close();
      }, 600_000);
  },
);
