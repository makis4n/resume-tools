/**
 * The upstream samples as the second pass's oracle tests open them (items 7 and 8): imported as the
 * browser imports a resume, each on a session of its own, and compiled through the compiler over a
 * Node session, as the app's worker compiles.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Engine } from "../src/editor/compiler";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { readTree } from "../src/import/fonts";
import { treeImages } from "../src/import/intake";
import { isRefusal } from "../src/import/refusal";
import { type Imported, importResume } from "../src/import/run";
import type { FontLibrary } from "../src/page/fonts";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle";
import { uploadOf } from "./corpus-reference";

export const engineManifest = () =>
  JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest;

/** Whether this machine has fetched the oracle's samples, which `corpus oracle` fetches. */
export const fetched = existsSync(join(ORACLE_DIR, "jake-0000", "resume.tex"));

/** An upstream sample imported as the browser imports a resume, on a session of its own. */
export async function importedSample(id: string, fonts: FontLibrary): Promise<Imported> {
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
export const engineOf = (on: EngineSession) => (): Engine => ({
  start: async () => {},
  dump: async (kind, name, preamble, files) => on.dump(kind, name, preamble, files),
  putFormat: async (kind, name, format) => on.putFormat(kind, name, format),
  forget: async (job) => on.forget(job),
  compile: async (kind, format, body, options) => on.compile(kind, format, body, options),
  pdf: async (job, options) => on.pdf(job, options),
  dropFormat: async (kind, name) => on.dropFormat(kind, name),
  terminate: () => {},
});
