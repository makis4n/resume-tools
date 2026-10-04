/**
 * What crosses between the page and the reading service's route that labels a PDF's lines
 * (milestone 3 second pass, item 13): `POST /v1/label`, on the editor's own origin. The page sends
 * the lines' text and features, `featuresOf` the layout (`src/pdf/label.ts`), and nothing else: no
 * file, no name of the person's, no document. The service answers one role a line, from the closed
 * list, in the lines' order. Both sides check what they receive against these schemas, so that a
 * reply of another form is never taken for one.
 *
 * Pure: no Node, no DOM, no Workers runtime, so the page, the dev server and the Pages Function all
 * take it.
 */

import { z } from "zod";
import { LABEL_TEXT_CHARS, ROLES } from "../pdf/roles.ts";

/** The route, relative to the page. */
export const LABEL_ROUTE = "/v1/label";

/** The most lines one request may hold: ten pages of a dense resume, with room. */
export const MAX_LINES = 2_000;

/** The most characters one line's text may hold. */
export const MAX_LINE_TEXT = LABEL_TEXT_CHARS;

/** A count or a place on the page, as `featuresOf` rounds them. */
const count = z.number().int().min(0).max(100_000);
const measure = z.number().finite().min(-100_000).max(100_000);

/** One line as the page sends it: `Features`, field for field, and nothing else. */
export const LabelLine = z
  .object({
    id: count,
    text: z.string().max(MAX_LINE_TEXT),
    page: count,
    column: count,
    columns: count,
    indent: measure,
    width: measure,
    size: measure,
    bold: z.boolean(),
    italic: z.boolean(),
    caps: z.boolean(),
    bullet: z.boolean(),
    rowIndex: count,
    rowSize: count,
    rule: z.boolean(),
    gapAbove: measure.optional(),
    links: count,
    rows: count,
  })
  .strict();
export type LabelLine = z.infer<typeof LabelLine>;

/** A request: the lines, in reading order, each id once. */
export const LabelRequest = z
  .object({ lines: z.array(LabelLine).min(1).max(MAX_LINES) })
  .strict()
  .refine(
    (request) => new Set(request.lines.map((line) => line.id)).size === request.lines.length,
    {
      message: "each line's id is given once",
      path: ["lines"],
    },
  );
export type LabelRequest = z.infer<typeof LabelRequest>;

/** A reply: one role a line, `roles[i]` the role of the request's `lines[i]`. */
export const LabelReply = z.object({ roles: z.array(z.enum(ROLES)) }).strict();
export type LabelReply = z.infer<typeof LabelReply>;

/** A refusal: a fixed sentence, and, for a request of the wrong form, where it is wrong. */
export interface LabelRefusal {
  error: string;
  problems?: string[];
}
