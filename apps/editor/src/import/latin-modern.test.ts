import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { readTree } from "./fonts";
import { type Intake, intake } from "./intake";
import {
  type InLatinModern,
  inLatinModern,
  isComputerModernT1,
  LATIN_MODERN,
  undrawableFonts,
  withLatinModern,
} from "./latin-modern";
import { type Reference, reference } from "./reference";
import { isRefusal, type Refusal } from "./refusal";

// Every document here is invented for these tests.

describe("Latin Modern's lines (decision 0026)", () => {
  test("reads the EC and TC fonts by name, and no other", () => {
    for (const name of ["ecrm1000", "ecbx1200", "ectt0900", "eccc1000", "tcrm1095", "tcss1000"])
      expect(isComputerModernT1(name), name).toBe(true);
    for (const name of ["cmr10", "cmbx12", "ec-lmr10", "ts1-lmr10", "lmr10", "ptmr8t", "ecrm10"])
      expect(isComputerModernT1(name), name).toBe(false);
  });

  test("puts T1 and Latin Modern right after the class, as the ports load them", () => {
    expect(LATIN_MODERN).toEqual(["\\usepackage[T1]{fontenc}", "\\usepackage{lmodern}"]);
    expect(withLatinModern("\\documentclass[11pt]{article}\n\\usepackage{xcolor}\n")).toBe(
      "\\documentclass[11pt]{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n\\usepackage{xcolor}\n",
    );
    // Whatever follows the class on its line stays after the lines, a comment among it.
    expect(withLatinModern("% A note\n\\documentclass{article} % a note\n")).toBe(
      "% A note\n\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n % a note\n",
    );
    // A class commented out is no class.
    expect(withLatinModern("% \\documentclass{article}\n\\usepackage{xcolor}\n")).toBeUndefined();
  });
});

describe.skipIf(!engineAvailable())("reading an import in Latin Modern, on the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files, manifest.fonts);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 120_000);

  /** An invented upload of one main file, taken in and compiled to its reference. */
  async function uploaded(source: string): Promise<{ taken: Intake; made: Reference }> {
    const taken = intake(
      { name: "invented.zip", bytes: zipSync({ "cv.tex": strToU8(source) }) },
      { tree },
    );
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    return { taken, made };
  }

  /** A swap that did not refuse. */
  const swapped = (found: InLatinModern | Refusal | undefined): InLatinModern => {
    if (found === undefined || isRefusal(found)) throw new Error("no swap");
    return found;
  };

  const BODY = String.raw`\begin{document}
\section*{Invented heading}
Invented words, set to be read.
\begin{itemize}
  \item An invented point
\end{itemize}
\end{document}
`;

  test("swaps Computer Modern's T1 and TS1 fonts, which the page cannot draw, for Latin Modern", async () => {
    // T1 with Computer Modern, and LaTeX's itemize bullet from TS1: EC and TC fonts.
    const { taken, made } = await uploaded(
      `\\documentclass[11pt]{article}\n\\usepackage[T1]{fontenc}\n${BODY}`,
    );
    const cannot = await undrawableFonts(fonts, made.fonts);
    expect(cannot.length).toBeGreaterThan(1);
    expect(cannot.every(isComputerModernT1)).toBe(true);
    expect(cannot.some((name) => name.startsWith("tc"))).toBe(true);
    const read = swapped(await inLatinModern(session, fonts, taken, made));
    expect(read.swapped).toEqual(cannot);
    expect(read.intake.main.text).toBe(
      `\\documentclass[11pt]{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n\\usepackage[T1]{fontenc}\n${BODY}`,
    );
    expect(read.intake.files).toBe(taken.files);
    // The page draws every font the document now sets, Latin Modern's in T1 and TS1.
    expect(await undrawableFonts(fonts, read.reference.fonts)).toEqual([]);
    expect(read.reference.fonts.tex).toEqual(expect.arrayContaining(["ec-lmr10", "ts1-lmr10"]));
    expect(read.reference.pages).toHaveLength(1);
  }, 120_000);

  test("leaves a document the page can draw as it is, Latin Modern already or Computer Modern in OT1", async () => {
    const plain = String.raw`\begin{document}
Invented words, set to be read.
\end{document}
`;
    for (const source of [
      `\\documentclass{article}\n${plain}`,
      `\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n${BODY}`,
    ]) {
      const { taken, made } = await uploaded(source);
      expect(await undrawableFonts(fonts, made.fonts)).toEqual([]);
      expect(await inLatinModern(session, fonts, taken, made)).toBeUndefined();
    }
  }, 120_000);
});
