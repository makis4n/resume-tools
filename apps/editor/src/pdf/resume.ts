/**
 * From a read PDF to the resume (milestone 3 second pass, items 11 and 12): the layout by rules,
 * always; then the two steps with a seam between them, what each line is (`label.ts`), by the
 * rules or by a labeller that stands in for them, and the labelled lines filed into the shared
 * resume model (`file.ts`), with the flags the review shows first and the count of every word read
 * against the resume built. Pure, as its steps are: it runs in the page, a worker or Node alike.
 */

import { type Filed, fileLines } from "./file.ts";
import { type Labeller, type Labels, labelLines } from "./label.ts";
import { type Layout, layOut } from "./layout.ts";
import type { ReadPdf } from "./read.ts";

export interface PdfResume {
  layout: Layout;
  labels: Labels;
  filed: Filed;
}

/** Lay a read PDF out, label its lines, the rules by default, and file them into the resume. */
export async function resumeOfPdf(
  read: ReadPdf,
  options: { labeller?: Labeller; signal?: AbortSignal } = {},
): Promise<PdfResume> {
  const layout = layOut(read);
  const labels = await labelLines(
    layout,
    options.labeller,
    options.signal === undefined ? {} : { signal: options.signal },
  );
  return { layout, labels, filed: fileLines(layout, labels.roles) };
}
