import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type OutlineGroup, outlineNodes } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { readTree } from "../import/fonts";
import { treeImages } from "../import/intake";
import { isRefusal } from "../import/refusal";
import { type ImportDeps, importResume } from "../import/run";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { applyUnder, CommandError, type StructureOp, UnitRefused } from "./document";
import { alike, NOT_ALIKE, outlineOf, unitEnding } from "./outline";
import { FIXED_WHY } from "./Panel";

// The invented upload of the second pass's item 8 (`src/test/invented-fixed-group.tex`), imported
// as the browser imports a `.tex`: its roles take no third, so the checks fix their run, which then
// takes no unit more or fewer and no move, while each role's bullets take all three. Every word is
// invented.

const UPLOAD = readFileSync(join(import.meta.dirname, "../test/invented-fixed-group.tex"));

describe.skipIf(!engineAvailable())("a fixed group of an imported resume, on the engine", () => {
  let deps: ImportDeps;
  beforeAll(async () => {
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    deps = {
      session: await startNodeSession(),
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

  it("takes no step on the roles, says why in plain words, and takes each on the bullets", async () => {
    const outcome = await importResume(
      [{ name: "invented.tex", bytes: new Uint8Array(UPLOAD) }],
      deps,
    );
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.reason}`);
    const { package: pkg, document } = outcome;
    const parts = outlineOf(document.resume)?.parts ?? [];
    const groups = [...outlineNodes(parts)].flatMap((node) =>
      node.kind === "part" && node.part.kind === "group" ? [node.part] : [],
    );
    const fixed = groups.filter((group) => group.fixed !== undefined);
    // The roles, fixed since a copy of one stopped the compile; the two lists of bullets, which take anything.
    expect(fixed.map((group) => [group.units.length, group.fixed])).toEqual([[2, "stops"]]);
    const roles = fixed[0] as OutlineGroup;
    const reason = FIXED_WHY[roles.fixed ?? "stops"];
    expect(reason).not.toMatch(/[\\{}]/);
    const [lantern, mill] = roles.units;
    if (lantern === undefined || mill === undefined) throw new Error("no roles");
    const refused: StructureOp[] = [
      { op: "addUnit", after: mill.id },
      { op: "removeUnit", id: lantern.id },
      { op: "moveUnit", id: mill.id, to: 0 },
    ];
    for (const op of refused)
      expect(() => applyUnder(pkg, document, { type: "structure", op })).toThrow(CommandError);
    // A role's last bullet, Enter at its end: its list takes a copy after it.
    const lists = groups.filter((group) => group.fixed === undefined);
    expect(lists.map((group) => group.units.length)).toEqual([2, 2]);
    const last = lists[0]?.units[1];
    const field = last?.parts.find((part) => part.kind === "text" || part.kind === "rich");
    if (last === undefined || field === undefined) throw new Error("no bullet");
    expect(unitEnding(parts, field.id)?.group.id).toBe(lists[0]?.id);
    const after = applyUnder(pkg, document, {
      type: "structure",
      op: { op: "addUnit", after: last.id },
    });
    const list = [...outlineNodes(outlineOf(after.resume)?.parts ?? [])].find(
      (node) => node.kind === "part" && node.part.kind === "group" && node.part.id === lists[0]?.id,
    );
    expect(list?.kind === "part" && list.part.kind === "group" && list.part.units.length).toBe(3);
  }, 120_000);

  it("refuses a move among units the builder found not of one shape, saying why", async () => {
    // The review's invented bodies: a run whose units but the last end in a line break, the last
    // holding the closing paragraph; and a run of skills each ending in its comma or its stop.
    const preamble =
      "\\documentclass[11pt]{article}\n\\usepackage[margin=0.8in]{geometry}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}\n";
    const bodies = [
      "\\newcommand{\\award}[2]{\\textbf{#1} \\hfill #2}\n\\begin{document}\n\\section*{Quill Wrenfield}\n\\award{Alpha Prize}{2020} \\\\\n\\award{Beta Medal}{2019} \\\\\n\\award{Gamma Ribbon}{2018}\n\nClosing words here.\n\\end{document}\n",
      "\\newcommand{\\skill}[1]{\\emph{#1}}\n\\begin{document}\n\\section*{Quill Wrenfield}\nSkills: \\skill{Lantern}, \\skill{Quill}, \\skill{Mill}.\n\nClosing words here.\n\\end{document}\n",
    ];
    for (const body of bodies) {
      const outcome = await importResume(
        [{ name: "invented.tex", bytes: new TextEncoder().encode(preamble + body) }],
        deps,
      );
      if (isRefusal(outcome)) throw new Error(`refused: ${outcome.reason}`);
      const { package: pkg, document } = outcome;
      const parts = outlineOf(document.resume)?.parts ?? [];
      const run = [...outlineNodes(parts)].flatMap((node) =>
        node.kind === "part" && node.part.kind === "group" && node.part.units.length === 3
          ? [node.part]
          : [],
      )[0];
      if (run === undefined) throw new Error("no run of three");
      expect(run.fixed).toBeUndefined();
      expect(alike(run)).toBe(false);
      const [first, , last] = run.units;
      if (first === undefined || last === undefined) throw new Error("no units");
      for (const op of [
        { op: "moveUnit", id: last.id, to: 0 },
        { op: "addUnit", after: first.id },
      ] as const) {
        let plain: string | undefined;
        try {
          applyUnder(pkg, document, { type: "structure", op });
        } catch (error) {
          if (error instanceof UnitRefused) plain = error.plain;
        }
        expect(plain).toBe(NOT_ALIKE);
      }
      // After the last, the copy the checks tried is taken.
      applyUnder(pkg, document, { type: "structure", op: { op: "addUnit", after: last.id } });
    }
  }, 120_000);
});
