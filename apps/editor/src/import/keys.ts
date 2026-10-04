/**
 * The naming step's keys of a document's definitions (milestone 3 item 6, decision 0024): each
 * template macro's and environment's cache key, from its definition's hash and its closure's, as
 * the naming contract computes one (`@resume-tools/naming`).
 * They were the signatures' until the second pass's item 5 took the naming step out of a `.tex`
 * import (decision 0049), which reads the signatures and nothing of this; item 17 deletes them
 * with the rest of the naming step.
 */

import { type Dependency, environmentKeyOf, keyOf, NAMING_VERSION } from "@resume-tools/naming";
import type { EngineSignatures } from "./signatures";

/**
 * What a template macro's key is computed from (`keyOf`): its own definition's hash, and its
 * dependencies that are definitions, each its name and hash, in its closure's order, those that
 * hold data left out, neither their text nor whether a preamble set them taking part. An
 * environment's is its `\begin` code's hash, and the closure of its `\begin` and `\end` codes as
 * the request builder reads it (`buildRequest` in `naming.ts`): the `\end` code first, then the
 * names of the `\begin` code's closure and of the `\end` code's, each once, but the environment's
 * own, and those that are data left out, the `\end` code among them when it is. Undefined for a
 * macro that holds data, or that the compile did not print.
 */
export function keyInputs(
  signatures: Pick<EngineSignatures, "macros">,
  of: "command" | "environment",
  name: string,
): { hash: string; dependencies: Dependency[] } | undefined {
  const macroOf = (each: string) =>
    Object.hasOwn(signatures.macros, each) ? signatures.macros[each] : undefined;
  const own = macroOf(name);
  if (own === undefined || own.kind === "data") return undefined;
  if (of === "command")
    return {
      hash: own.hash,
      dependencies: own.dependencies.flatMap((dependency): Dependency[] => {
        const found = macroOf(dependency);
        return found?.kind === "data" ? [] : [[dependency, found?.hash ?? null]];
      }),
    };
  const endName = `end${name}`;
  const end = macroOf(endName);
  const closure = [
    ...(end === undefined ? [] : [endName]),
    ...own.dependencies,
    ...(end === undefined || end.kind === "data" ? [] : end.dependencies),
  ];
  return {
    hash: own.hash,
    dependencies: [...new Set(closure)].flatMap((dependency): Dependency[] => {
      const found = dependency === name ? undefined : macroOf(dependency);
      return found === undefined || found.kind === "data" ? [] : [[dependency, found.hash]];
    }),
  };
}

/**
 * Each definition's key, item 6's cache key (`keyOf`): the SHA-256 of the naming version, its hash
 * and its dependencies' that are definitions, in order, by name (`keyInputs`). A macro that holds
 * data takes no part, neither its text nor whether a preamble set it. And each template
 * environment the body opens (`environments`), by its name, its key as an environment
 * (`environmentKeysOf`), in place of its `\begin` code's alone, since that is the key its request
 * gives it and an answer is filed under. It is what the corpus runner compares between documents:
 * two whose class or style is the same file give each macro and environment the file defines, and
 * the preamble leaves alone, the same key, whatever the person's name and settings.
 */
export async function keysOf(
  signatures: Pick<EngineSignatures, "macros"> & Partial<Pick<EngineSignatures, "environments">>,
  version: number = NAMING_VERSION,
): Promise<Record<string, string>> {
  const keys = record<string>();
  for (const name of Object.keys(signatures.macros)) {
    const inputs = keyInputs(signatures, "command", name);
    if (inputs !== undefined) keys[name] = await keyOf(version, inputs.hash, inputs.dependencies);
  }
  return Object.assign(keys, await environmentKeysOf(signatures, version));
}

/**
 * Each template environment's key, by its name, as its request gives it (`environmentKeyOf`): its
 * `\begin` code's hash, with its `\end` code as its first dependency, and both closures after it
 * (`keyInputs`); an `\end` code that holds data, as an empty one does, is left out, as every
 * dependency that holds data is.
 */
export async function environmentKeysOf(
  signatures: Pick<EngineSignatures, "macros"> & Partial<Pick<EngineSignatures, "environments">>,
  version: number = NAMING_VERSION,
): Promise<Record<string, string>> {
  const keys = record<string>();
  for (const [name, signature] of Object.entries(signatures.environments ?? {})) {
    const inputs =
      signature.kind === "template" ? keyInputs(signatures, "environment", name) : undefined;
    if (inputs === undefined) continue;
    const [end, ...rest] = inputs.dependencies;
    keys[name] =
      end !== undefined && end[0] === `end${name}`
        ? await environmentKeyOf(version, inputs.hash, end[0], end[1], rest)
        : await keyOf(version, inputs.hash, inputs.dependencies);
  }
  return keys;
}

/** A record for an object keyed by names a document gives, with no prototype to collide with. */
const record = <T>() => Object.create(null) as Record<string, T>;
