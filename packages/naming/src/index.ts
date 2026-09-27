/**
 * The naming step's contract (milestone 3 item 6, decision 0024): the request the editor builds
 * for an imported template and the answer it assembles a package from, as Zod schemas, with the
 * cache key both sides compute and the masking rules the request is built by. The editor, the
 * naming service (item 10) and the corpus runner (item 17) all read it; it holds no LaTeX of its
 * own and reaches for nothing but the platform's `crypto.subtle`, so it runs in the browser, in
 * Node and in a Worker alike.
 */

export * from "./answer.ts";
export * from "./cache.ts";
export * from "./key.ts";
export * from "./mask.ts";
export * from "./request.ts";
