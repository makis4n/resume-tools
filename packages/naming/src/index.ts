/**
 * The naming step's contract (milestone 3 item 6, decision 0024): the request the editor builds
 * for an imported template and the answer it assembles a package from, as Zod schemas, with the
 * cache key both sides compute and the masking rules the request is built by. The editor, the
 * naming service (item 10) and the corpus runner (item 17) all read it; it holds no LaTeX of its
 * own and reaches for nothing but the platform's `crypto.subtle`, so it runs in the browser, in
 * Node and in a Worker alike.
 *
 * The naming step on a model (item 9, decision 0026) has paths of its own, since it brings the AI
 * SDK, which the page never needs: `@resume-tools/naming/model`, which asks a model for a request's
 * answer (`name`), and `@resume-tools/naming/providers`, which makes Gemini's. The naming service
 * and the corpus runner import them; the page imports this path alone.
 */

export * from "./answer.ts";
export * from "./cache.ts";
export * from "./key.ts";
export * from "./mask.ts";
export * from "./request.ts";
