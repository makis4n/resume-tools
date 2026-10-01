/**
 * The launch templates' upstream samples, as the import's measurement takes them (milestone 3 item
 * 19, decision 0045). `sampleUpload` gives a sample's files as one zip, as `corpus oracle` gives
 * them to the pipeline, for an id `corpus/oracle.json` names, once `corpus oracle` has fetched them
 * into `.corpus/oracle/`: `scripts/measure.ts --import` imports it in Node. The dev server answers
 * `GET /measure/samples/<id>.zip` with the same zip (`serveSamples`), for the app's `?measure=import`
 * page, which imports it in the browser.
 *
 * The samples are public: each is the example its template's repository ships, at the commit the
 * oracle pins, and none is a corpus document. Even so they are never committed (decision 0017), and
 * nothing else under `.corpus/` is read or served: a file is taken only where the oracle names it,
 * at its path in its sample's folder, and only when its size and SHA-256 are the oracle's, so that
 * what is measured, in Node and in the browser, is the sample the oracle names, byte for byte.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import type { Plugin } from "vite";
// Node runs the scripts by stripping their types, so the type imports need their real extensions.
import type { Upload } from "../src/import/intake.ts";
import { parseJson } from "./corpus-manifest.ts";
import { ORACLE_DIR, ORACLE_FILE, Oracle } from "./corpus-oracle.ts";

/** Where the dev server serves the samples, each at `<id>.zip`. */
export const SAMPLES_ROUTE = "/measure/samples/";

/** A sample that cannot be taken, and why, in a sentence for a developer. */
export class SampleMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleMissing";
  }
}

/** Where the samples are read from: the oracle's file and the folder it was fetched into. */
export interface SampleOptions {
  oracleFile?: string;
  dir?: string;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * The upstream sample `id` as one upload: its files at their paths in its repository, zipped, as
 * `corpus oracle` gives them to the pipeline (`uploadOf`, with no fonts beside them, since the
 * oracle names none). Throws `SampleMissing` for an id the oracle does not name, and for a sample
 * not fetched as the oracle names it: a file missing, or of another size or hash.
 */
export function sampleUpload(id: string, options: SampleOptions = {}): Upload {
  const file = options.oracleFile ?? ORACLE_FILE;
  const dir = options.dir ?? ORACLE_DIR;
  const oracle = parseJson(Oracle, readFileSync(file, "utf8"), file);
  const doc = oracle.documents.find((each) => each.id === id);
  if (doc === undefined) throw new SampleMissing(`The oracle names no sample ${id}.`);
  const files: Record<string, Uint8Array> = {};
  for (const { path, sha256: hash, bytes } of doc.files) {
    let data: Uint8Array;
    try {
      // The oracle's schema takes only relative paths with no `..`, so this stays in the folder.
      data = new Uint8Array(readFileSync(join(dir, doc.id, ...path.split("/"))));
    } catch {
      throw new SampleMissing(
        `The upstream sample ${id} has not been fetched: run pnpm --filter @resume-tools/editor corpus oracle first.`,
      );
    }
    if (data.length !== bytes || sha256(data) !== hash)
      throw new SampleMissing(
        `${id}'s ${path} is not the file the oracle names: run pnpm --filter @resume-tools/editor corpus oracle again.`,
      );
    files[path] = data;
  }
  return { name: `${doc.id}.zip`, bytes: zipSync(files) };
}

/**
 * The dev server's route for the samples: `GET /measure/samples/<id>.zip` answers with
 * `sampleUpload(id)`, never cached, and a sample that cannot be taken with a 404 that says why in
 * plain text. Anything else under the route is a 404 too, never the app's index page.
 */
export function serveSamples(options: SampleOptions = {}): Plugin {
  return {
    name: "resume-tools-samples",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(SAMPLES_ROUTE, (req, res, next) => {
        // Connect also hands the route paths that only start with it, such as "/measure/samplesx".
        if (!req.originalUrl?.startsWith(SAMPLES_ROUTE)) return next();
        const answer = (status: number, text: string) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(text);
        };
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.setHeader("Allow", "GET, HEAD");
          return answer(405, "The samples are only read.");
        }
        const asked = /^\/([a-z]+(?:-[a-z]+)*-\d{4})\.zip$/.exec(
          new URL(req.url ?? "/", "http://localhost").pathname,
        );
        if (asked?.[1] === undefined) return answer(404, "No such sample.");
        let upload: Upload;
        try {
          upload = sampleUpload(asked[1], options);
        } catch (error) {
          if (error instanceof SampleMissing) return answer(404, error.message);
          // The oracle's file itself could not be read: the dev server's console says why.
          server.config.logger.error(`The sample ${asked[1]} could not be read: ${error}`);
          return answer(500, "The sample could not be read; the dev server's console says why.");
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Length", upload.bytes.length);
        res.setHeader("Cache-Control", "no-store");
        res.end(req.method === "HEAD" ? undefined : upload.bytes);
      });
    },
  };
}
