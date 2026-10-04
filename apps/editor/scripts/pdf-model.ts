/**
 * How well the hosted model reads a PDF's lines (milestone 3 second pass, item 13), measured by
 * hand, with the key, on the invented sets alone, through the code the editor ships: the page's
 * labeller (`src/pdf/model-labeller.ts`), with a yes on record and its 15 s budget, posting to the
 * reading service's handler (`src/service/label.ts`) in this process, which asks SoCLaaS's model
 * through the first pass's provider code, then the rules' filing step and the score against each
 * PDF's truth (decision 0051's definition of a field right).
 *
 *   SOCLAAS_API_KEY="$(security find-generic-password -s soclaas -w)" \
 *     pnpm --filter @resume-tools/editor pdf-model other|builtin|both [--passes <n>] [--record]
 *
 *   other     the eight invented resumes printed by other tools (`spike-pdf/fixtures/other/`)
 *   builtin   the nine PDFs the engine makes from the built-in templates and the curated samples
 *   --passes  how many passes over the set, a call a PDF each (3 by default)
 *   --record  write the model's reply for `chrome-table`, its raw content, to the suite's recorded
 *             reply (`src/pdf/fixtures/model-reply.chrome-table.json`); no other text is written
 *
 * It reads only a PDF of the invented sets' own folders with its truth beside it: each path goes
 * through the spike's guard (`assertInvented`) before the file is read, so no corpus resume, and
 * nothing made from one, is ever sent. It prints, a PDF a pass, the fields right, the call's time
 * and who read the PDF, and never a line's text; the key reaches it only through its environment
 * and is never printed. It is never run in CI.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, soclaasModel } from "@resume-tools/naming/providers";
import { Resume } from "@resume-tools/resume-model";
import { fileLines } from "../src/pdf/file.ts";
import { labelLines } from "../src/pdf/label.ts";
import { layOut } from "../src/pdf/layout.ts";
import { MODEL_BUDGET_MS, modelLabeller } from "../src/pdf/model-labeller.ts";
import { scoreResume } from "../src/pdf/score.ts";
import { LABEL_MODEL_VARIABLE } from "../src/service/config.ts";
import { handleLabel, LABEL_LIMITS } from "../src/service/label.ts";
import { MemoryRateStore } from "../src/service/rate.ts";
import { makeBuiltinPdfs } from "./spike-pdf/builtin.ts";
import { assertInvented, truthPathOf } from "./spike-pdf/model.ts";
import { OTHER_DIR } from "./spike-pdf/print.ts";
import { readPdf } from "./spike-pdf/read.ts";

/** The suite's recorded reply: the model's raw content for one invented PDF. */
export const RECORDED_REPLY = fileURLToPath(
  new URL("../src/pdf/fixtures/model-reply.chrome-table.json", import.meta.url),
);

/** The PDF whose reply `--record` keeps. */
const RECORDED_ID = "chrome-table";

interface Doc {
  id: string;
  set: "other" | "builtin";
  pdf: string;
}

function otherDocs(): Doc[] {
  return readdirSync(OTHER_DIR)
    .filter((name) => existsSync(join(OTHER_DIR, name, "resume.pdf")))
    .sort()
    .map((name) => ({ id: name, set: "other", pdf: join(OTHER_DIR, name, "resume.pdf") }));
}

async function builtinDocs(): Promise<Doc[]> {
  const made = await makeBuiltinPdfs();
  return made.map((pdf) => ({ id: pdf.id, set: "builtin", pdf: pdf.pdf }));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { passes: { type: "string" }, record: { type: "boolean" } },
  });
  const which = positionals[0] ?? "other";
  if (!["other", "builtin", "both"].includes(which))
    throw new Error("pdf-model takes other, builtin or both");
  const passes = Number(values.passes ?? 3);
  const apiKey = process.env.SOCLAAS_API_KEY?.trim() ?? "";
  if (apiKey === "") throw new Error("pdf-model needs SOCLAAS_API_KEY in its environment.");
  const id = process.env[LABEL_MODEL_VARIABLE]?.trim() || DEFAULT_MODEL;
  // The model as the service makes it (`labelModel`), with a fetch that keeps the last reply's
  // raw content for `--record`, in memory alone.
  let lastContent: string | undefined;
  const model = soclaasModel(apiKey, id, {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (values.record) {
        const body = (await response
          .clone()
          .json()
          .catch(() => undefined)) as { choices?: { message?: { content?: string } }[] };
        lastContent = body?.choices?.[0]?.message?.content;
      }
      return response;
    },
  });
  const deps = {
    model,
    address: "127.0.0.1",
    rates: new MemoryRateStore(),
    limits: { ...LABEL_LIMITS, perMinute: 1_000, perDay: 10_000, charsPerDay: 1e9 },
    now: Date.now,
    log: (line: string) => console.log(`  service: ${line}`),
  };
  const labeller = modelLabeller({
    consent: { get: () => "yes" },
    fetch: (url, init) => handleLabel(new Request(new URL(url, "http://localhost"), init), deps),
  });
  const docs = [
    ...(which === "builtin" ? [] : otherDocs()),
    ...(which === "other" ? [] : await builtinDocs()),
  ];
  console.log(
    `Asking ${id} on SoCLaaS, ${passes} passes over ${docs.length} PDFs, ${MODEL_BUDGET_MS / 1000} s budget each:`,
  );
  const totals = new Map<
    string,
    { right: number; total: number; ms: number[]; fallbacks: string[] }
  >();
  for (let pass = 1; pass <= passes; pass++) {
    for (const doc of docs) {
      const real = assertInvented(doc.pdf);
      const read = await readPdf(new Uint8Array(readFileSync(real)));
      if ("refused" in read) throw new Error(`the invented PDF ${doc.id} was refused`);
      const truth = Resume.parse(JSON.parse(readFileSync(truthPathOf(real), "utf8")));
      const layout = layOut(read);
      lastContent = undefined;
      const started = performance.now();
      const labels = await labelLines(layout, labeller);
      const ms = performance.now() - started;
      const score = scoreResume(truth, fileLines(layout, labels.roles).resume);
      const key = `${doc.set} pass ${pass}`;
      const total = totals.get(key) ?? { right: 0, total: 0, ms: [], fallbacks: [] };
      total.right += score.all.right;
      total.total += score.all.total;
      total.ms.push(ms);
      if (labels.fallback !== undefined) total.fallbacks.push(`${doc.id}: ${labels.fallback}`);
      totals.set(key, total);
      console.log(
        `  pass ${pass} ${doc.id}: ${layout.lines.length} lines, ${(ms / 1000).toFixed(1)} s, ${labels.by}${labels.fallback === undefined ? "" : ` (${labels.fallback})`}, fields right ${score.all.right}/${score.all.total}`,
      );
      if (values.record && doc.id === RECORDED_ID && labels.by === "model" && lastContent) {
        writeFileSync(
          RECORDED_REPLY,
          `${JSON.stringify({ model: id, at: new Date().toISOString(), content: lastContent }, null, 2)}\n`,
        );
        console.log(`  recorded ${doc.id}'s reply`);
      }
    }
  }
  console.log("\nFields right, a pass:");
  for (const [key, total] of totals) {
    const sorted = [...total.ms].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const max = sorted.at(-1) ?? 0;
    console.log(
      `  ${key}: ${total.right}/${total.total} (${((100 * total.right) / Math.max(1, total.total)).toFixed(1)}%), call median ${(median / 1000).toFixed(1)} s, max ${(max / 1000).toFixed(1)} s, fallbacks ${total.fallbacks.length === 0 ? "none" : total.fallbacks.join(", ")}`,
    );
  }
}

await main();
