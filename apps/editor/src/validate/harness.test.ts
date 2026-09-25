import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { CURATED } from "../templates/curated";
import { parsePackage, type TemplatePackage } from "../templates/package";
import { CHECKS, type Check, type Report, validateCurated, validatePackage } from "./harness";

type PackageInput = z.input<typeof TemplatePackage>;

/** What each check makes sure of, as the name of the test that asserts it found nothing. */
const ENSURES: Record<Check, string> = {
  dump: "dumps its preamble as a format",
  compile: "compiles its sample with no error in the log",
  converges: "converges: the same body compiles again in one pass, to the same output",
  pages: "sets its sample on one page",
  fields: "keeps every field's markers, and the page finds each field with glyphs",
  alignment: "matches every glyph of every field to a character of its text",
  fonts: "uses only fonts the page can draw",
  special: "writes each field's paragraph special right after its begin marker",
};

/**
 * A package on `article`, invented for these tests, that sets every field plainly, one to a
 * line. Each negative case below changes one snippet of it.
 */
const PLAIN: PackageInput = {
  version: 1,
  id: "plain",
  name: "Plain",
  engine: "pdftex",
  source: { url: "https://example.com/plain", license: "MIT", attribution: "Invented for tests" },
  preamble: "\\documentclass{article}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}",
  controls: {},
  snippets: {
    document: "\\begin{document}\n{{header}}\n{{sections}}\n\\end{document}",
    header: "{\\Large {{first}} {{last}}}\\par",
    link: { other: "{{label}}\\par" },
    section: {
      entries: "\\section*{{{title}}}\n{{entries}}",
      list: "\\section*{{{title}}}\n{{items}}",
      labelled: "\\section*{{{title}}}\n{{items}}",
      paragraph: "\\section*{{{title}}}\n{{text}}\\par",
    },
    entry: "{{title}}\\par\n{{bullets}}",
    bullet: "{{text}}\\par",
    item: "{{text}}\\par",
    labelledItem: "{{label}}: {{text}}\\par",
  },
};

/** The plain package under an id of its own, with some of its snippets replaced. */
function plainWith(id: string, snippets: Partial<PackageInput["snippets"]>): TemplatePackage {
  return parsePackage({ ...PLAIN, id, snippets: { ...PLAIN.snippets, ...snippets } });
}

/** An invented resume with one entry and one bullet, which the plain package sets on one page. */
const RESUME = Resume.parse({
  version: 1,
  header: { name: { first: "Ines", last: "Calloway" }, links: [] },
  sections: [
    {
      id: "work",
      kind: "entries",
      role: "experience",
      title: "Experience",
      entries: [
        {
          id: "tern",
          title: "Typesetter",
          bullets: [{ id: "tern-1", text: [{ text: "Set the quarterly report" }] }],
        },
      ],
    },
  ],
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("the validation harness", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let reports: Report[] = [];

  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    reports = await validateCurated(session, fonts);
  }, 60_000 * CURATED.size);

  for (const id of CURATED.keys()) {
    describe(`over the curated package ${id} and its sample`, () => {
      const report = () => {
        const found = reports.find((each) => each.package === id);
        if (!found) throw new Error(`the harness made no report for ${id}`);
        return found;
      };

      for (const check of CHECKS)
        it(ENSURES[check], () => {
          expect(report().findings.filter((finding) => finding.check === check)).toEqual([]);
        });

      it("compiles in good time, and says how long it took", () => {
        const { format, passes, pages, fields } = report();
        const timings = passes.map((ms) => `${Math.round(ms)} ms`).join(", ");
        console.log(`${id}: format ${format}; passes ${timings}; pages ${pages}; fields ${fields}`);
        // Generous, so that a pathological slowdown fails CI and an ordinary slow runner does not.
        expect(passes[0]).toBeLessThan(2_000);
      });
    });
  }

  describe("over an invented package", () => {
    it("reports a field whose markers never reach the page, and nothing else", async () => {
      // A box \settowidth measures is never shipped out, so the specials in it never reach the
      // page (decision 0007), and the bullet cannot be found by a click.
      const lost = plainWith("lost-marker", { bullet: "\\settowidth{\\dimen0}{{{text}}}" });
      const report = await validatePackage(session, fonts, lost, RESUME);
      expect(report.findings).toEqual([
        { check: "fields", field: "tern-1.text", message: expect.stringContaining("tern-1.text") },
      ]);
      // Everything else was read, and passed.
      expect(report.pages).toBe(1);
      expect(report.fields).toBe(4);
    }, 60_000);

    it("reports a font the page cannot draw, and nothing else, rather than throw", async () => {
      // LaTeX 2023 sets itemize's own bullet from TS1, whose metrics tfm.ts refuses (decision
      // 0007), so drawPage throws; the harness reports the font instead.
      const bulleted = plainWith("ts1-bullet", {
        entry: [
          "{{title}}\\par",
          "{{#bullets}}",
          "\\begin{itemize}",
          "{{bullets}}",
          "\\end{itemize}",
          "{{/bullets}}",
        ].join("\n"),
        bullet: "\\item {{text}}",
      });
      const report = await validatePackage(session, fonts, bulleted, RESUME);
      expect(report.findings).toEqual([
        { check: "fonts", message: expect.stringMatching(/^the page cannot draw tcrm1000: /) },
      ]);
      // The markers are read from the output, so every field is still found.
      expect(report.fields).toBe(5);
    }, 60_000);
  });
});
