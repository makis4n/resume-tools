/**
 * Write a PDF of each built-in template, Jake's Resume, AltaCV and Awesome-CV, each typesetting its
 * own invented sample resume, into the folder given, as the editor's engine makes them (milestone
 * 3 second pass, item 14): the PDFs a person can import to try the review, one of each template.
 * Each is written as `<template>--<template>.pdf`, beside the resume it was made from
 * (`.truth.json`). Needs the engine (`fetch-engine`).
 *
 *   pnpm --filter @resume-tools/editor builtin-pdfs <folder>
 */

import { resolve } from "node:path";
import { makeBuiltinPdfs } from "./spike-pdf/builtin.ts";

const [folder] = process.argv.slice(2);
if (folder === undefined || folder.startsWith("-")) {
  console.error("Usage: pnpm --filter @resume-tools/editor builtin-pdfs <folder>");
  process.exit(2);
}
// pnpm runs a package's script in the package's folder: a relative folder is the caller's.
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), folder);
const made = await makeBuiltinPdfs((line) => console.log(line), { dir, ownOnly: true });
for (const pdf of made) console.log(pdf.pdf);
