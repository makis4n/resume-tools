import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type OutlineGroup, type OutlineUnit, outlineNodes } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, test } from "vitest";
import { Compiler, type Shown } from "../src/editor/compiler";
import { type Command, type Document, History } from "../src/editor/document";
import { StructureGuard } from "../src/editor/guard";
import { outlineFields, outlineOf, unitEnding, unitPlace, unitShape } from "../src/editor/outline";
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
// before to the glyph; then an entry with bullets added after itself in the same way, as Enter at
// the end of its last field before its bullets adds one, and removed; and every group of the three
// takes a unit more and one fewer, none fixed (decision 0055). The list is chosen by the template's command its bullets are set with, so that
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

/**
 * How far up, in points, a glyph may stand after an entry is added: a page that runs full shrinks
 * its glue to take it, and sets what stood above it a point or so higher.
 */
const SHRINK = 12;

/** What a compile the compiler ran came to: a page, its document stopping it, or a message. */
type Landed = { page: Shown } | { stopped: Document } | { error: string };

/** A unit's last field outside the groups within it that the page writes, by its id. */
function lastOwnField(unit: OutlineUnit): string | undefined {
  const own = unit.parts.filter(
    (part) =>
      (part.kind === "text" && part.text.trim() !== "") ||
      (part.kind === "rich" && part.text.some((run) => run.text.trim() !== "")),
  );
  const last = own.at(-1);
  return last === undefined || last.kind === "kept" || last.kind === "group" ? undefined : last.id;
}

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
      test(`${id}: a bullet, and an entry with bullets, each added and removed, the rest of the page kept`, async () => {
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
        const before = placedGlyphs(first.page.pages);
        /**
         * A unit added after the unit `after`, as Enter at the end of `field` adds it: the page then
         * the page before but for the new unit and what moves down; then removed, the page the
         * first to the glyph. What it came to, in numbers.
         */
        const addRemove = async (field: string, what: string) => {
          const at = unitEnding(outlineOf(history.present.resume)?.parts ?? [], field);
          const after = at?.group.units[at.index];
          if (at === undefined || after === undefined) throw new Error(`${id}: no ${what} ends`);
          const added = await step({ type: "structure", op: { op: "addUnit", after: after.id } });
          const now = unitPlace(outlineOf(history.present.resume)?.parts ?? [], after.id);
          const copy = now?.group.units[now.index + 1];
          if (copy === undefined || now?.group.units.length !== at.group.units.length + 1)
            throw new Error(`${id}: no copy of the ${what}`);
          const glyphs = placedGlyphs(added.pages);
          // An entry's kept text may set words of its own, as a label; a bullet's sets none. Either
          // sets them in one run, where it stands.
          const moved = movedDown(
            before,
            glyphs,
            what === "entry" ? { words: true, shrink: SHRINK } : {},
          );
          expect(moved.problem, `${id}: the page after the ${what}`).toBeUndefined();
          expect(moved.runs, `${id}: the ${what}'s glyphs in one run`).toBe(1);
          expect(glyphs, `${id}: the page changed`).not.toEqual(before);
          expect(added.pages.map((page) => page.unmatched)).toEqual(added.pages.map(() => 0));
          const removed = await step({ type: "structure", op: { op: "removeUnit", id: copy.id } });
          expect(placedGlyphs(removed.pages), `${id}: the page after the removal`).toEqual(before);
          // The glyphs before that stand nowhere they stood: those the unit moved down.
          const spot = (glyph: (typeof before)[number]) =>
            JSON.stringify([glyph.page, glyph.x, glyph.y, glyph.text, glyph.font, glyph.size]);
          const standing = new Map<string, number>();
          for (const glyph of glyphs)
            standing.set(spot(glyph), (standing.get(spot(glyph)) ?? 0) + 1);
          const lower = before.filter((glyph) => {
            const left = standing.get(spot(glyph)) ?? 0;
            standing.set(spot(glyph), left - 1);
            return left <= 0;
          }).length;
          return `group ${groups.findIndex((group) => group.id === at.group.id) + 1} of ${groups.length}, ${at.group.units.length} units, after unit ${at.index + 1} (its own glyphs ${moved.added}, ${lower} of ${before.length} glyphs moved, none up more than ${moved.rise.toFixed(1)} pt) and removed, the page then the first to the glyph; ${added.ms.toFixed(0)} ms and ${removed.ms.toFixed(0)} ms`;
        };
        console.info(`${id}: a bullet added in ${await addRemove(field.id, "bullet")}`);

        // An entry with bullets: a unit holding a list whose units hold no group, of its group's
        // last unit's shape, and not its group's last where one is not, Enter at the end of its last
        // field before its bullets.
        const leaves = (group: OutlineGroup) =>
          group.units.every((unit) => unit.parts.every((part) => part.kind !== "group"));
        const entries = groups
          .flatMap((group) => group.units.map((unit, u) => ({ group, unit, u })))
          .filter(
            ({ group, unit }) =>
              group.units.length >= 2 &&
              unit.parts.some((part) => part.kind === "group" && leaves(part)) &&
              unit.parts.every((part) => part.kind !== "group" || leaves(part)) &&
              unitShape(unit) === unitShape(group.units.at(-1) as OutlineUnit) &&
              lastOwnField(unit) !== undefined,
          );
        // Not a group's last where one is not: a run's last holds what follows it to its level's
        // end, which a copy of it brings; and an entry in a section rather than the run of sections.
        const depth = new Map(
          [...outlineNodes(outlineOf(history.present.resume)?.parts ?? [])].flatMap((node) =>
            node.kind === "part" && node.part.kind === "group"
              ? [[node.part.id, node.depth] as const]
              : [],
          ),
        );
        const entry = entries
          .map((each) => ({ ...each, last: each.u === each.group.units.length - 1 }))
          .sort(
            (a, b) =>
              Number(a.last) - Number(b.last) ||
              (depth.get(b.group.id) ?? 0) - (depth.get(a.group.id) ?? 0),
          )[0];
        const head = entry === undefined ? undefined : lastOwnField(entry.unit);
        if (head === undefined) throw new Error(`${id}: no entry with bullets`);
        console.info(`${id}: an entry with bullets added in ${await addRemove(head, "entry")}`);
        compiler.close();
      }, 600_000);
  },
);
