/**
 * GitHub, as collecting and fetching the corpus use it (decision 0017): code search, a
 * repository's forks, details, branch head, tree and history, and a file's bytes at a commit.
 * Every request goes through one fetch function, which the tests replace; nothing here prints a
 * file's content or the token, and every line it prints goes through `printable`.
 *
 * The corpus holds public repositories only. Code search also finds files in the private
 * repositories the token may read, so a hit is kept only when GitHub marks its repository public,
 * and a repository's details count only when GitHub says it is public; a private one is as good as
 * gone. The token goes to api.github.com alone: raw.githubusercontent.com is asked without one, so
 * that no file of a private repository can be read there at all.
 *
 * GitHub allows code search 10 requests a minute and the rest of the API 5,000 an hour. So code
 * searches are spaced 6 s apart; a request waits for its limit to reset when the last response
 * said none was left; and a request refused for its rate, failed on the server, lost on the way or
 * cut off while its body was read is tried three more times, after the time GitHub asks for in
 * `Retry-After`, or when its limit resets, or after 1, 2 and 4 s. A body is read as it arrives and
 * no further than a cap, so a file too large for the corpus is refused, never held whole. Files
 * come from raw.githubusercontent.com, eight at a time; if that host cannot be reached, the
 * contents API serves them instead.
 */

import { printable } from "./corpus-manifest.ts";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const API_HOST = "api.github.com";
const API = `https://${API_HOST}`;
const RAW = "https://raw.githubusercontent.com";

/** Code search allows 10 requests a minute: one every 6 s, and a little more. */
export const SEARCH_INTERVAL_MS = 6_100;
/** How many times a failed request is tried again. */
export const RETRIES = 3;
/** The first retry's wait when GitHub names none; each later one waits twice as long. */
export const BACKOFF_MS = 1_000;
/** GitHub's secondary rate limit asks for at least a minute when it names no wait. */
const SECONDARY_WAIT_MS = 60_000;
/** The most items a page of any list or search holds. */
export const PER_PAGE = 100;
/** The most bytes an answer of the API is read to; a recursive tree, the largest, stops at 7 MB. */
const MAX_JSON_BYTES = 32_000_000;

/** What was asked for is not there: never was, is gone, is empty, or is blocked. */
const GONE = new Set([404, 409, 410, 451]);

/** A request that failed on the way every time it was tried. */
export class Unreachable extends Error {}

/** A request GitHub refused every time it was tried. */
class Refused extends Error {}

/** A file's bytes, or why there are none: it is `gone`, or `too-large` for the cap it was read to. */
export type FileRead = Uint8Array | "gone" | "too-large";

/** One file a code search found in a public repository. */
export interface SearchHit {
  repo: string;
  path: string;
}

export interface Fork {
  repo: string;
  createdAt: string;
  pushedAt: string | null;
}

export interface Repository {
  /** GitHub's number for the repository, which stays when it is renamed. */
  id: number;
  /** The repository's name as GitHub has it now, which a rename changes. */
  repo: string;
  defaultBranch: string;
  /** The SPDX id GitHub reports, or null for none or NOASSERTION. */
  license: string | null;
  /** For a fork, the repository at the root of its fork network. */
  source?: string;
}

/** A regular file in a tree: not a folder, a symbolic link or a submodule. */
export interface TreeFile {
  path: string;
  size: number;
}

/** Runs at most `limit` tasks at once, and the others in the order they came. */
export class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active++;
    // A task that ends hands its place to the next one waiting, so the count never overshoots.
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export interface GitHubOptions {
  fetch?: Fetch;
  token?: string;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How many files download at once, 8 unless said. */
  downloads?: number;
}

type Resource = "core" | "code_search" | "raw";

/** A URL as a message may show it: it never holds the token, which goes in a header. */
const shown = (url: string) =>
  url.replace(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)/, "");

const reason = (error: unknown) =>
  error instanceof Error
    ? error.cause instanceof Error
      ? error.cause.message
      : error.message
    : String(error);

/** Let a response's body go unread; one already broken off has nothing left to let go. */
const discard = (response: Response) => response.body?.cancel().catch(() => {});

export class GitHub {
  /** The fetch function every request goes through. */
  private readonly send: Fetch;
  private readonly token: string | undefined;
  private readonly log: (line: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly downloads: Limiter;
  private lastSearch = Number.NEGATIVE_INFINITY;
  /** Each limit's requests left and when it resets, in ms, as the last response gave them. */
  private readonly limits = new Map<string, { remaining: number; reset: number }>();
  private rawUnreachable = false;

  constructor(options: GitHubOptions = {}) {
    this.send = options.fetch ?? ((url, init) => fetch(url, init));
    this.token = options.token;
    const log = options.log ?? (() => {});
    this.log = (line) => log(printable(line));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.downloads = new Limiter(options.downloads ?? 8);
  }

  /**
   * One page of a code search's results, which stop at the tenth page of 100: the files it found
   * in repositories GitHub marks public, and how many it found in others, which are left out.
   */
  async searchCode(
    query: string,
    page: number,
  ): Promise<{ total: number; hits: SearchHit[]; hidden: number }> {
    const params = new URLSearchParams({
      q: query,
      per_page: String(PER_PAGE),
      page: String(page),
    });
    const body = await this.json<{
      total_count: number;
      items: { path: string; repository: { full_name: string; private?: boolean } }[];
    }>(`/search/code?${params}`, "code_search");
    if (!body) throw new Error(`code search found nothing to answer for ${query}`);
    const hits = body.items
      .filter((item) => item.repository.private === false)
      .map((item) => ({ repo: item.repository.full_name, path: item.path }));
    return { total: body.total_count, hits, hidden: body.items.length - hits.length };
  }

  /** One page of a repository's forks, the most starred first. */
  async forks(repo: string, page: number): Promise<Fork[]> {
    const body = await this.json<
      { full_name: string; created_at: string; pushed_at: string | null }[]
    >(`/repos/${repo}/forks?sort=stargazers&per_page=${PER_PAGE}&page=${page}`, "core");
    return (body ?? []).map((fork) => ({
      repo: fork.full_name,
      createdAt: fork.created_at,
      pushedAt: fork.pushed_at,
    }));
  }

  /**
   * A public repository's details, or undefined when it is gone, blocked, or not public: the
   * corpus holds public repositories only, so a private one is as good as gone.
   */
  async repository(repo: string): Promise<Repository | undefined> {
    const body = await this.json<{
      id: number;
      full_name: string;
      private?: boolean;
      visibility?: string;
      default_branch: string;
      license: { spdx_id: string | null } | null;
      source?: { full_name: string };
    }>(`/repos/${repo}`, "core");
    if (!body || body.private !== false || body.visibility !== "public") return undefined;
    const spdx = body.license?.spdx_id;
    return {
      id: body.id,
      repo: body.full_name,
      defaultBranch: body.default_branch,
      license: spdx && spdx !== "NOASSERTION" ? spdx : null,
      ...(body.source ? { source: body.source.full_name } : {}),
    };
  }

  /** The commit a branch is at, and that commit's tree; undefined for an empty repository. */
  async head(repo: string, branch: string): Promise<{ commit: string; tree: string } | undefined> {
    const body = await this.json<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(
      `/repos/${repo}/branches/${encodeURIComponent(branch)}`,
      "core",
    );
    return body && { commit: body.commit.sha, tree: body.commit.commit.tree.sha };
  }

  /**
   * Every regular file of a tree, with its size, and whether GitHub cut the listing short. A
   * symbolic link is left out, since its content is the path it points to, and so is a submodule,
   * which is another repository.
   */
  async tree(
    repo: string,
    sha: string,
  ): Promise<{ files: TreeFile[]; truncated: boolean } | undefined> {
    const body = await this.json<{
      truncated: boolean;
      tree: { path: string; mode: string; type: string; size?: number }[];
    }>(`/repos/${repo}/git/trees/${sha}?recursive=1`, "core");
    if (!body) return undefined;
    const files = body.tree
      .filter(
        (entry) => entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755"),
      )
      .map((entry) => ({ path: entry.path, size: entry.size ?? 0 }));
    return { files, truncated: body.truncated };
  }

  /** The commits of a repository's default branch that changed a path, the latest 100. */
  async history(repo: string, path: string): Promise<string[]> {
    const params = new URLSearchParams({ path, per_page: String(PER_PAGE) });
    const body = await this.json<{ sha: string }[]>(`/repos/${repo}/commits?${params}`, "core");
    return (body ?? []).map((commit) => commit.sha);
  }

  /**
   * A file's bytes at a commit, or at another ref such as HEAD; `gone` when the file or its
   * repository is gone, private or blocked; `too-large` when it is longer than `limit` bytes, of
   * which no more than the limit is read.
   */
  async file(repo: string, ref: string, path: string, limit: number): Promise<FileRead> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return this.downloads.run(async () => {
      if (!this.rawUnreachable) {
        try {
          return await this.request(`${RAW}/${repo}/${ref}/${encoded}`, "raw", "*/*", limit);
        } catch (error) {
          if (!(error instanceof Unreachable)) throw error;
          if (!this.rawUnreachable)
            this.log(
              `raw.githubusercontent.com cannot be reached (${error.message}); reading files through the contents API`,
            );
          this.rawUnreachable = true;
        }
      }
      return this.request(
        `${API}/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
        "core",
        "application/vnd.github.raw+json",
        limit,
      );
    });
  }

  private async json<T>(path: string, resource: Resource): Promise<T | undefined> {
    const body = await this.request(
      `${API}${path}`,
      resource,
      "application/vnd.github+json",
      MAX_JSON_BYTES,
    );
    if (body === "gone") return undefined;
    if (body === "too-large")
      throw new Error(`GitHub's answer for ${shown(path)} is over ${MAX_JSON_BYTES} bytes`);
    return JSON.parse(new TextDecoder().decode(body)) as T;
  }

  /**
   * Send a request, within GitHub's limits, and read its body to at most `limit` bytes, trying it
   * again as the module's comment says: `gone` for what is not there, including a 403 that is not
   * about the rate, which is a repository GitHub will not show.
   */
  private async request(
    url: string,
    resource: Resource,
    accept: string,
    limit: number,
  ): Promise<FileRead> {
    const headers: Record<string, string> = { Accept: accept, "User-Agent": "resume-tools-corpus" };
    if (resource !== "raw") headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (this.token && new URL(url).host === API_HOST)
      headers.Authorization = `Bearer ${this.token}`;
    for (let attempt = 0; ; attempt++) {
      await this.withinLimits(resource);
      let failure: unknown;
      try {
        const response = await this.send(url, { headers });
        this.noteLimits(resource, response);
        const limited = await rateLimited(response);
        const wait = this.retryWait(response, attempt, limited);
        if (wait !== undefined && attempt < RETRIES) {
          await discard(response);
          this.log(
            `  HTTP ${response.status} for ${shown(url)}; trying again in ${Math.ceil(wait / 1000)} s`,
          );
          await this.sleep(wait);
          continue;
        }
        if (GONE.has(response.status) || (response.status === 403 && !limited)) {
          await discard(response);
          return "gone";
        }
        if (!response.ok) {
          await discard(response);
          throw new Refused(`GitHub answered HTTP ${response.status} for ${shown(url)}`);
        }
        // A body cut off on the way fails here, and is tried again like a request that failed.
        return (await readBody(response, limit)) ?? "too-large";
      } catch (error) {
        if (error instanceof Refused) throw error;
        failure = error;
      }
      if (attempt >= RETRIES) throw new Unreachable(`${shown(url)}: ${reason(failure)}`);
      await this.sleep(BACKOFF_MS * 2 ** attempt);
    }
  }

  /** Space code searches out, and wait for a limit the last response said was spent. */
  private async withinLimits(resource: Resource) {
    if (resource === "code_search") {
      const wait = this.lastSearch + SEARCH_INTERVAL_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastSearch = this.now();
    }
    const limit = this.limits.get(resource);
    if (limit && limit.remaining <= 0) {
      const wait = limit.reset - this.now() + 1_000;
      if (wait > 0) {
        this.log(
          `GitHub's ${resource} limit is spent; waiting ${Math.ceil(wait / 1000)} s for it to reset`,
        );
        await this.sleep(wait);
      }
      this.limits.delete(resource);
    }
  }

  private noteLimits(resource: Resource, response: Response) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining === null || reset === null) return;
    this.limits.set(resource, { remaining: Number(remaining), reset: Number(reset) * 1000 });
  }

  /** How long to wait before trying a response's request again, or undefined not to. */
  private retryWait(response: Response, attempt: number, limited: boolean): number | undefined {
    const { status } = response;
    if (status < 500 && !limited) return undefined;
    const after = Number(response.headers.get("retry-after") ?? Number.NaN);
    if (after > 0) return after * 1000;
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      if (reset > this.now()) return reset - this.now() + 1_000;
    }
    if (status === 403 || status === 429)
      return Math.max(SECONDARY_WAIT_MS, BACKOFF_MS * 2 ** attempt);
    return BACKOFF_MS * 2 ** attempt;
  }
}

/** Whether a 403 or 429 is GitHub limiting the rate, by its headers or, failing them, its message. */
async function rateLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0")
    return true;
  const message = await response
    .clone()
    .text()
    .catch(() => "");
  return /rate limit/i.test(message);
}

/**
 * A response's body, read as it arrives, or undefined once it passes `limit` bytes, when no more
 * of it is read. A `Content-Length` over the limit says so before a byte is read, unless the body
 * is compressed, when the header counts the compressed bytes and the count of those read decides.
 */
export async function readBody(response: Response, limit: number): Promise<Uint8Array | undefined> {
  const encoding = response.headers.get("content-encoding");
  const length = Number(response.headers.get("content-length") ?? Number.NaN);
  if ((encoding === null || encoding === "identity") && length > limit) {
    await discard(response);
    return undefined;
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
