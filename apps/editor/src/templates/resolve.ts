/**
 * A document's template by its id (milestone 3 item 12, decision 0038): a curated package from the
 * map the editor ships (`curated.ts`), or an imported one from the browser's store, with what the
 * document's own import keeps for its compiles, the upload's files and the stand-ins its PDF may
 * show (`ImportJob`). The editor cannot tell the two apart past this point, as plan section 5.1
 * has it: a document opens, compiles, edits and makes its PDF through its package alike.
 */

import type { ImportJob } from "../import/run";
import type { StoredTemplate } from "../storage/store";
import { CURATED } from "./curated";
import { IMPORTED_PREFIX, type TemplatePackage } from "./package";

/** A template as a document opens with it. */
export interface Template {
  package: TemplatePackage;
  /** An imported document's: what its compiles need beside the package, and what its PDF shows. */
  job?: ImportJob;
}

/** Where imported templates are kept: the store's side of it. */
export interface TemplateStore {
  templateOf(id: string, document?: string): Promise<StoredTemplate | undefined>;
}

/**
 * The template with the id `id` for the document `document`: the curated package of that id, or the
 * imported one the store keeps, with the document's own import's job; undefined when neither has
 * it, as for a document a newer editor wrote. The store's refusals are thrown (`PackageRefused`).
 */
export async function resolveTemplate(
  id: string,
  document?: string,
  store?: TemplateStore,
): Promise<Template | undefined> {
  const curated = CURATED.get(id);
  if (curated !== undefined) return { package: curated.package };
  // Only an id under the imported prefix can be the store's (decision 0026).
  if (!id.startsWith(IMPORTED_PREFIX)) return undefined;
  const stored = await store?.templateOf(id, document);
  if (stored === undefined) return undefined;
  const job = stored.import?.job;
  return { package: stored.package, ...(job === undefined ? {} : { job }) };
}
