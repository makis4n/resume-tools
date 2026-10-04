/**
 * The hosted model asked what each line of a PDF is (milestone 3 second pass, item 13, promoted
 * from the spike of item 3, decision 0051): given every line's text and features as a table, it
 * answers one role a line, through a JSON schema response format whose keys are the lines' ids and
 * whose values are an enum of the roles, so that a reply in the schema's form is valid by
 * construction. A reply is still checked (`rolesOf`): one of another form is never taken.
 *
 * The model is any AI SDK model; the service makes SoCLaaS's from its key (`config.ts`), through
 * the first pass's provider code (`@resume-tools/naming/providers`). One call, no retry, at
 * temperature 0, stopped by the signal its caller gives. Nothing here logs, keeps or caches what
 * it is given or what the model says.
 */

import {
  APICallError,
  generateText,
  jsonSchema,
  type LanguageModel,
  NoObjectGeneratedError,
  Output,
} from "ai";
import { type Features, ROLES, type Role } from "../pdf/roles.ts";

export const INSTRUCTIONS = `You read the lines of a resume, taken from a PDF, and say what each line is. Give every line exactly one role:
- name: the person's name.
- contact: an email address, a phone number, a web address or profile, or the person's town, where the resume gives the person's details.
- section heading: the title of a section, such as Experience, Education or Skills.
- entry head: a line that heads an entry of a section: a job's title, an employer, a school, a degree, a project's or an award's name.
- date: a date or a range of dates standing on its own.
- place: the town, region or country of a job or a school, standing on its own.
- bullet: an item of a list, usually after a bullet's sign.
- running text: anything else, such as a summary, a paragraph, a line of skills, or a headline under the name.
Each line comes with what the page shows of it: its page; its column, of how many stand side by side there; its indent from its column's left edge and its width, in points; its size against the body text's, where 1 is the body's; bold (B), italic (I) and all capitals (C); whether a bullet's sign stood before it (•); its place among the pieces of text on its row, of how many; whether a long rule runs by it (_); the gap above it, in body-text sizes; how many links lie over it; and how many rows of text it joins. Answer with an object whose keys are the lines' ids and whose values are their roles.`;

/** The lines as the model is told them: one row each, its id, its features, and its text. */
export function promptOf(features: readonly Features[]): string {
  const rows = features.map((line) => {
    const style = `${line.bold ? "B" : ""}${line.italic ? "I" : ""}${line.caps ? "C" : ""}` || "-";
    return [
      `L${line.id}`,
      line.page,
      `${line.column + 1}/${line.columns}`,
      line.indent,
      line.width,
      line.size,
      style,
      line.bullet ? "•" : "-",
      `${line.rowIndex + 1}/${line.rowSize}`,
      line.rule ? "_" : "-",
      line.gapAbove ?? "-",
      line.links,
      line.rows,
      line.text.replace(/\s+/g, " "),
    ].join(" | ");
  });
  return [
    "id | page | column | indent | width | size | style | bullet | row | rule | gap above | links | rows | text",
    ...rows,
  ].join("\n");
}

/** The reply's schema: every line's id a key, its value one of the roles, and nothing else. */
export function schemaOf(features: readonly Pick<Features, "id">[]) {
  const properties = Object.fromEntries(
    features.map((line) => [`L${line.id}`, { type: "string", enum: [...ROLES] }]),
  );
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  } as const;
}

/** The roles in a reply, in the lines' order, or undefined for a reply not of the schema's form. */
export function rolesOf(
  features: readonly Pick<Features, "id">[],
  reply: unknown,
): Role[] | undefined {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return undefined;
  const values = reply as Record<string, unknown>;
  const roles: Role[] = [];
  for (const line of features) {
    const role = values[`L${line.id}`];
    if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) return undefined;
    roles.push(role as Role);
  }
  return Object.keys(values).length === features.length ? roles : undefined;
}

/** Why a call gave no roles. */
export type AskFailure = "wrong form" | "no answer" | "provider" | "timeout";

/** What one call came to: the roles, or why none; and the tokens, where the provider said. */
export type Asked =
  | { roles: Role[]; tokens?: { input: number; output: number } }
  | { failure: AskFailure; status?: number };

/**
 * Ask the model what each line is, once, at temperature 0, stopped by `signal`. A stop that the
 * signal makes is a `timeout`; a reply not of the schema's form is `wrong form`; a provider that
 * failed or could not be reached is `provider`, with its status where it gave one.
 */
export async function askRoles(
  features: readonly Features[],
  model: Exclude<LanguageModel, string>,
  signal: AbortSignal,
): Promise<Asked> {
  try {
    const result = await generateText({
      model,
      instructions: INSTRUCTIONS,
      messages: [{ role: "user", content: promptOf(features) }],
      output: Output.object({ schema: jsonSchema(schemaOf(features)), name: "roles" }),
      temperature: 0,
      maxRetries: 0,
      abortSignal: signal,
    });
    let reply: unknown;
    try {
      reply = result.output;
    } catch {
      return { failure: "no answer" };
    }
    const roles = rolesOf(features, reply);
    if (roles === undefined) return { failure: "wrong form" };
    return {
      roles,
      tokens: { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 },
    };
  } catch (error) {
    if (signal.aborted) return { failure: "timeout" };
    if (NoObjectGeneratedError.isInstance(error)) return { failure: "wrong form" };
    const call = APICallError.isInstance(error)
      ? error
      : error instanceof Error && APICallError.isInstance(error.cause)
        ? error.cause
        : undefined;
    return call?.statusCode === undefined
      ? { failure: "provider" }
      : { failure: "provider", status: call.statusCode };
  }
}
