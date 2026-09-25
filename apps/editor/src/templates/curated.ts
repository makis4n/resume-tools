/**
 * The curated template packages, the ones the editor ships, each with an invented sample resume.
 *
 * A curated package is written as a folder named after its id: `template.json`, the package
 * without its preamble and its files; `preamble.tex`; any class or style files; and `sample.json`,
 * a resume in the model that shows the template off (decision 0006). This module assembles each
 * folder into the one value the rest of the editor holds, and checks the package and the sample as
 * it loads, so a curated package that does not validate fails every test and the app at start,
 * rather than a compile.
 *
 * The folders are imported statically rather than read, because the app is a Vite bundle with no
 * file system, and the same code runs in Node for the tests and the validation harness: JSON as
 * JSON, and TeX as text through Vite's `?raw`, which Vitest serves the same way.
 */

import { Resume } from "@resume-tools/resume-model";
import altacvPreamble from "./altacv/preamble.tex?raw";
import altacvClass from "./altacv/rt-altacv.cls?raw";
import altacvSample from "./altacv/sample.json";
import altacvTemplate from "./altacv/template.json";
import jakePreamble from "./jake/preamble.tex?raw";
import jakeSample from "./jake/sample.json";
import jakeTemplate from "./jake/template.json";
import { parsePackage, type TemplatePackage } from "./package";

/** A curated package and its invented sample resume. */
export interface Curated {
  package: TemplatePackage;
  sample: Resume;
}

/** A curated package's folder, as this module imports it. */
interface Folder {
  folder: string;
  /** `template.json`: the package without its preamble and its files. */
  template: object;
  preamble: string;
  /** The class and style files, by the name the preamble loads each under. */
  files: Record<string, string>;
  sample: unknown;
}

/** Each curated package's folder, in the order the templates were ported. */
const FOLDERS: Folder[] = [
  { folder: "jake", template: jakeTemplate, preamble: jakePreamble, files: {}, sample: jakeSample },
  {
    folder: "altacv",
    template: altacvTemplate,
    preamble: altacvPreamble,
    files: { "rt-altacv.cls": altacvClass },
    sample: altacvSample,
  },
];

/** A folder's files as one package and its sample, or an error that names the folder. */
function assemble({ folder, template, preamble, files, sample }: Folder): Curated {
  let curated: Curated;
  try {
    const pkg = parsePackage({ ...template, preamble, files });
    curated = { package: pkg, sample: Resume.parse(sample) };
  } catch (error) {
    throw new Error(`the curated package in ${folder}/ does not validate`, { cause: error });
  }
  // The id names the package's formats and its folder (decision 0006).
  if (curated.package.id !== folder)
    throw new Error(`the curated package in ${folder}/ has the id ${curated.package.id}`);
  return curated;
}

/** The curated packages and their samples by package id, in the order they were ported. */
export const CURATED: ReadonlyMap<string, Curated> = new Map(
  FOLDERS.map((folder) => {
    const each = assemble(folder);
    return [each.package.id, each];
  }),
);

/** A curated package and its sample, by the package's id. Throws for an id none of them has. */
export function curated(id: string): Curated {
  const found = CURATED.get(id);
  if (found === undefined) throw new Error(`no curated template has the id ${id}`);
  return found;
}
