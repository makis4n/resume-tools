import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import { strToU8 } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "../../scripts/corpus-oracle";
import { uploadOf as zipOf } from "../../scripts/corpus-reference";
import { engineManifest, fetched } from "../../scripts/oracle-samples";
import { newDocument } from "../editor/document";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { memoryConsent } from "../pdf/consent";
import { type FetchLike, modelLabeller } from "../pdf/model-labeller";
import { readPdf } from "../pdf/node";
import { isPdfRefusal } from "../pdf/refusals";
import { resumeOfPdf } from "../pdf/resume";
import { CURATED } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { defaultControls } from "../templates/package";
import { type BridgeDeps, pageFile, referencePdf } from "./bridge";
import { readTree } from "./fonts";
import type { Upload } from "./intake";
import { treeImages } from "./intake";
import { isRefusal } from "./refusal";
import { reportOfImport, SUCCESS_RATE } from "./report";
import { importResume } from "./run";

// The bridge between the two ways in (milestone 3 second pass, item 16), on the engine: a refused
// `.tex` has no page to make a PDF of, so its offer is the person's own PDF; and the page of one
// that compiles becomes a PDF that the PDF path reads, labels by rules with nothing sent on a no,
// and files into a resume that a built-in template sets. The invented resumes are under
// `src/test/`; the upstream samples, where fetched, are read for numbers only, and their text
// reaches neither the output nor any service.

const invented = (name: string): Upload[] => [
  { name: "cv.tex", bytes: strToU8(readFileSync(join(__dirname, "../test", name), "utf8")) },
];

/** A reading service that counts what it is sent, and answers nothing useful. */
function counted() {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(input);
    return new Response("{}", { status: 500 });
  };
  return { fetch, calls };
}

describe.skipIf(!engineAvailable())("the bridge on the engine", () => {
  let deps: BridgeDeps;
  let session: EngineSession;

  beforeAll(async () => {
    const manifest = engineManifest();
    session = await startNodeSession();
    deps = {
      session,
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

  /** Read a page's PDF as the PDF import does, labelled under `answer`, and count what is sent. */
  async function moved(pdf: Uint8Array, answer: "no" | undefined) {
    const read = await readPdf(pdf);
    if (isPdfRefusal(read)) throw new Error(`the page's PDF was refused: ${read.reason}`);
    const { fetch, calls } = counted();
    const labeller = modelLabeller({ consent: memoryConsent(answer), fetch });
    const reading = await resumeOfPdf(read, { labeller });
    return { reading, calls };
  }

  /** Whether a built-in template sets this resume: its document made and compiled. */
  function sets(template: string, resume: Resume): boolean {
    const document = newDocument(template, resume);
    const pkg = CURATED.get(template)?.package;
    if (pkg === undefined) throw new Error(`no template ${template}`);
    const values = defaultControls(pkg);
    const format = generateFormat(pkg, values);
    if (!session.dump(pkg.engine, format.name, format.preamble, format.files).ok) return false;
    const job = `bridge-${template}`;
    session.forget(job);
    const body = generateBody(pkg, Resume.parse(document.resume), values);
    return session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 }).ok;
  }

  it("refuses the invented resume that needs a package, and makes no PDF of it", async () => {
    const files = invented("invented-refused.tex");
    const outcome = await importResume(files, deps);
    expect(isRefusal(outcome) && outcome.reason).toBe("package");
    // The offer cannot be the reference page: there is none, so it is the person's own PDF.
    const made = await referencePdf(files, deps);
    expect(made.ok).toBe(false);
  }, 60_000);

  it("moves an invented resume's page onto each built-in template, nothing sent on a no", async () => {
    const made = await referencePdf(invented("invented-move.tex"), deps);
    if (!made.ok) throw new Error(`no PDF: ${made.why}`);
    expect(pageFile(made.pdf, "cv.tex").name).toBe("cv.pdf");
    for (const answer of ["no", undefined] as const) {
      const { reading, calls } = await moved(made.pdf, answer);
      expect(calls, `nothing is sent with the answer ${answer}`).toEqual([]);
      expect(reading.labels.by).toBe("rules");
      const { resume } = reading.filed;
      expect(`${resume.header.name.first} ${resume.header.name.last}`).toBe("Tamsin Holloway");
      expect(resume.sections.length).toBeGreaterThanOrEqual(2);
      for (const template of CURATED.keys()) expect(sets(template, resume), template).toBe(true);
    }
  }, 120_000);

  describe.skipIf(!fetched)("on the upstream samples under the bar", () => {
    const oracle = () => Oracle.parse(JSON.parse(readFileSync(ORACLE_FILE, "utf8")));
    const sample = (id: string): Upload[] => {
      const doc = oracle().documents.find((each) => each.id === id);
      if (doc === undefined) throw new Error(`${id} is no oracle sample`);
      const zip = zipOf(
        oracleDocument(doc),
        (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
        () => undefined,
      );
      return [{ name: `${id}.zip`, bytes: zip }];
    };

    // jake-0000 imports over the bar since its skills block is a field a line (decision 00XX), so
    // the move is offered to AltaCV's sample alone.
    for (const id of ["altacv-0000"])
      it(`offers ${id} the move, which comes to a document of a built-in template`, async () => {
        const files = sample(id);
        const outcome = await importResume(files, deps);
        if (isRefusal(outcome)) throw new Error(`${id} refused: ${outcome.reason}`);
        const rate = reportOfImport(outcome).rate;
        expect(rate, id).toBeLessThan(SUCCESS_RATE);
        const made = await referencePdf(files, deps);
        if (!made.ok) throw new Error(`${id}: no PDF of the page`);
        const { reading, calls } = await moved(made.pdf, "no");
        expect(calls).toEqual([]);
        const sections = reading.filed.resume.sections.length;
        console.log(
          `${id}: ${Math.round(100 * rate)}% editable, page PDF ${made.pdf.length} bytes, ${sections} sections read`,
        );
        expect(sections, id).toBeGreaterThan(0);
        for (const template of CURATED.keys()) {
          const set = sets(template, reading.filed.resume);
          expect(set, `${id} on ${template}`).toBe(true);
        }
      }, 240_000);
  });
});
