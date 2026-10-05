/**
 * What the engine would say of an invented template's commands and environments, for the outline's
 * tests, without an engine. Every command here is invented; nothing is taken from a real resume.
 * The first pass's invented imports, with their naming answers, went with the naming step (decision
 * 0063).
 *
 * Only tests import this, and vitest collects only `*.test.ts` and `*.test.tsx` files, so it is
 * never run as one.
 */

import type { EngineSignatures, Signature } from "../import/signatures";

/** What the engine would say of the invented template's commands and environments. */
export function signaturesOf(
  commands: Readonly<Record<string, string>>,
  environments: Readonly<Record<string, string>> = {},
  meanings: Readonly<Record<string, string>> = {},
): EngineSignatures {
  const signature = (spec: string): Signature => ({ kind: "template", spec, how: "meaning" });
  return {
    engine: "pdftex",
    commands: Object.fromEntries(
      Object.entries(commands).map(([name, spec]) => [name, signature(spec)]),
    ),
    environments: Object.fromEntries(
      Object.entries(environments).map(([name, spec]) => [name, signature(spec)]),
    ),
    macros: Object.fromEntries(
      Object.entries(meanings).map(([name, meaning]) => [
        name,
        { meaning, hash: "0".repeat(64), dependencies: [], capped: false },
      ]),
    ),
    truncated: false,
    ms: 0,
  };
}
