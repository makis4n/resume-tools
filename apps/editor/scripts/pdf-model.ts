/**
 * How well the hosted model reads a PDF's lines (milestone 3 second pass, item 13), measured by
 * hand, with the key, on the invented sets alone, through the code the editor ships: the page's
 * labeller (`src/pdf/model-labeller.ts`), with a yes on record and its 15 s budget, posting to the
 * reading service's handler (`src/service/label.ts`) in this process, which asks the model through
 * the first pass's provider code, then the rules' filing step and the score against each PDF's
 * truth (decision 0051's definition of a field right). The model is `--model`'s: a Claude model
 * for an id that starts `claude-`, with `ANTHROPIC_API_KEY` (decision 0109), and otherwise
 * SoCLaaS's, with `SOCLAAS_API_KEY`, `qwen3.8:27b` when no id is given. It never reads the
 * route's `PDF_LABEL_MODEL`, which names SoCLaaS's model alone.
 *
 *   SOCLAAS_API_KEY="$(security find-generic-password -s soclaas -w)" \
 *     pnpm --filter @resume-tools/editor pdf-model other|builtin|both [--passes <n>] [--record]
 *   ANTHROPIC_API_KEY="$(security find-generic-password -s anthropic -w)" \
 *     pnpm --filter @resume-tools/editor pdf-model both --model claude-haiku-5-5 [--thinking]
 *
 *   other     the eight invented resumes printed by other tools (`spike-pdf/fixtures/other/`)
 *   builtin   the nine PDFs the engine makes from the built-in templates and the curated samples
 *   --passes  how many passes over the set, a call a PDF each (3 by default)
 *   --model   the model's id, a SoCLaaS id or a Claude id (`claude-...`); `qwen3.8:27b` by default
 *   --thinking  let a Claude model think before it answers, which the service never asks
 *   --record  write the model's replies on the other tools' PDFs, their raw content, the roles by
 *             line id and no text, to the suite's recorded replies
 *             (`src/pdf/fixtures/model-replies.json`), from the last pass
 *
 * It reads only a PDF of the invented sets' own folders with its truth beside it: each path goes
 * through the spike's guard (`assertInvented`) before the file is read, so no corpus resume, and
 * nothing made from one, is ever sent. It prints, a PDF a pass, the fields right, the call's time
 * and who read the PDF, and never a line's text; then, a pass, the fields right and the call's
 * median and slowest time, and the owner's targets for the model (docs/milestone-3-overhaul.md,
 * "For a PDF import"), each met or not. The key reaches it only through its environment and is
 * never printed. It is never run in CI.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { claudeModel, DEFAULT_MODEL, soclaasModel } from "@resume-tools/naming/providers";
import { Resume } from "@resume-tools/resume-model";
import { fileLines } from "../src/pdf/file.ts";
import { labelLines } from "../src/pdf/label.ts";
import { layOut } from "../src/pdf/layout.ts";
import { MODEL_BUDGET_MS, modelLabeller } from "../src/pdf/model-labeller.ts";
import { readPdf } from "../src/pdf/node.ts";
import { isPdfRefusal } from "../src/pdf/refusals.ts";
import { scoreResume } from "../src/pdf/score.ts";
import { CLAUDE_KEY_VARIABLE, isClaude, KEY_VARIABLE } from "../src/service/config.ts";
import { handleLabel, LABEL_LIMITS } from "../src/service/label.ts";
import { MemoryRateStore } from "../src/service/rate.ts";
import { makeBuiltinPdfs } from "./spike-pdf/builtin.ts";
import { assertInvented, truthPathOf } from "./spike-pdf/model.ts";
import { OTHER_DIR } from "./spike-pdf/print.ts";

/** The suite's recorded replies: the model's raw content for each invented PDF of other tools. */
const RECORDED_REPLIES = fileURLToPath(
  new URL("../src/pdf/fixtures/model-replies.json", import.meta.url),
);

/** The share of fields the model must get right on the other tools' PDFs. */
const MODEL_TARGET = 0.9;

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
    options: {
      passes: { type: "string" },
      model: { type: "string" },
      record: { type: "boolean" },
      thinking: { type: "boolean" },
    },
  });
  const which = positionals[0] ?? "other";
  if (!["other", "builtin", "both"].includes(which))
    throw new Error("pdf-model takes other, builtin or both");
  const passes = Number(values.passes ?? 3);
  const id = values.model?.trim() || DEFAULT_MODEL;
  const claude = isClaude(id);
  const keyVariable = claude ? CLAUDE_KEY_VARIABLE : KEY_VARIABLE;
  const apiKey = process.env[keyVariable]?.trim() ?? "";
  if (apiKey === "")
    throw new Error(`pdf-model needs ${keyVariable} in its environment for ${id}.`);
  if (values.thinking && !claude) throw new Error("--thinking is for a Claude model");
  // The model as the service makes it (`labelModels`), with a fetch that keeps the last reply's
  // raw content for `--record`, in memory alone: a chat completion's message on SoCLaaS, the
  // Messages API's text block on Claude.
  let lastContent: string | undefined;
  const fetchKeeping: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (values.record) {
      const body = (await response
        .clone()
        .json()
        .catch(() => undefined)) as {
        choices?: { message?: { content?: string } }[];
        content?: { type?: string; text?: string }[];
      };
      lastContent = claude
        ? body?.content?.find((block) => block.type === "text")?.text
        : body?.choices?.[0]?.message?.content;
    }
    return response;
  };
  const model = claude
    ? claudeModel(apiKey, id, { thinking: values.thinking === true, fetch: fetchKeeping })
    : soclaasModel(apiKey, id, { fetch: fetchKeeping });
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
    `Asking ${id} on ${claude ? `Claude${values.thinking ? ", thinking" : ""}` : "SoCLaaS"}, ${passes} passes over ${docs.length} PDFs, ${MODEL_BUDGET_MS / 1000} s budget each:`,
  );
  const totals = new Map<
    string,
    { right: number; total: number; ms: number[]; fallbacks: string[] }
  >();
  /** The last pass's raw replies on the other tools' PDFs, kept in memory for `--record`. */
  const replies = new Map<string, string>();
  for (let pass = 1; pass <= passes; pass++) {
    for (const doc of docs) {
      const real = assertInvented(doc.pdf);
      const read = await readPdf(new Uint8Array(readFileSync(real)));
      if (isPdfRefusal(read)) throw new Error(`the invented PDF ${doc.id} was refused`);
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
      if (doc.set === "other" && labels.by === "model" && lastContent !== undefined)
        replies.set(doc.id, lastContent);
    }
  }
  if (values.record && replies.size === 0)
    console.log("  nothing to record: no PDF of other tools was read by the model");
  else if (values.record) {
    const recorded = Object.fromEntries([...replies].sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(
      RECORDED_REPLIES,
      `${JSON.stringify({ model: id, at: new Date().toISOString(), replies: recorded }, null, 2)}\n`,
    );
    console.log(`  recorded the replies for ${replies.size} PDFs of other tools`);
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
  const met = (yes: boolean) => (yes ? "met" : "NOT met");
  const all = [...totals.values()];
  const slowest = Math.max(0, ...all.flatMap((total) => total.ms));
  const fallbacks = all.flatMap((total) => total.fallbacks);
  console.log('\nTargets, the model (docs/milestone-3-overhaul.md, "For a PDF import"):');
  for (const [key, total] of totals)
    if (key.startsWith("other"))
      console.log(
        `  At least ${100 * MODEL_TARGET}% of fields right on the other tools' PDFs, ${key}: ${((100 * total.right) / Math.max(1, total.total)).toFixed(1)}%: ${met(total.right >= MODEL_TARGET * total.total)}`,
      );
  console.log(
    `  Every call inside the ${MODEL_BUDGET_MS / 1000} s budget, none falling back: slowest ${(slowest / 1000).toFixed(1)} s, ${fallbacks.length} fallbacks: ${met(slowest < MODEL_BUDGET_MS && fallbacks.length === 0)}`,
  );
}

await main();
