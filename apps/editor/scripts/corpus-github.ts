/**
 * GitHub, as collecting and fetching the corpus use it (decision 0017): code search, a
 * repository's forks, details, branch head, tree and history, and a file's bytes at a commit.
 * Every request goes through one fetch function, which the tests replace, with the token
 * `gh auth token` gives when there is one; nothing here prints a file's content or the token.
 *
 * GitHub allows code search 10 requests a minute and the rest of the API 5,000 an hour. So code
 * searches are spaced 6 s apart; a request waits for its limit to reset when the last response
 * said none was left; and a request refused for its rate, failed on the server or lost on the way
 * is tried three more times, after the time GitHub asks for in `Retry-After`, or when its limit
 * resets, or after 1, 2 and 4 s. Files come from raw.githubusercontent.com, eight at a time; if
 * that host cannot be reached, the contents API serves them instead.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";
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

/** What was asked for is not there: never was, is gone, is empty, or is blocked. */
const GONE = new Set([404, 409, 410, 451]);

/** A request that failed on the way every time it was tried. */
export class Unreachable extends Error {}

/** One file a code search found. */
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
    this.log = options.log ?? (() => {});
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.downloads = new Limiter(options.downloads ?? 8);
  }

  /** One page of a code search's results, which stop at the tenth page of 100. */
  async searchCode(query: string, page: number): Promise<{ total: number; hits: SearchHit[] }> {
    const params = new URLSearchParams({
      q: query,
      per_page: String(PER_PAGE),
      page: String(page),
    });
    const body = await this.json<{
      total_count: number;
      items: { path: string; repository: { full_name: string } }[];
    }>(`/search/code?${params}`, "code_search");
    if (!body) throw new Error(`code search found nothing to answer for ${query}`);
    const hits = body.items.map((item) => ({ repo: item.repository.full_name, path: item.path }));
    return { total: body.total_count, hits };
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

  /** A repository's details, or undefined when it is gone, private or blocked. */
  async repository(repo: string): Promise<Repository | undefined> {
    const body = await this.json<{
      full_name: string;
      default_branch: string;
      license: { spdx_id: string | null } | null;
      source?: { full_name: string };
    }>(`/repos/${repo}`, "core");
    if (!body) return undefined;
    const spdx = body.license?.spdx_id;
    return {
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
   * A file's bytes at a commit, or at another ref such as HEAD, or undefined when the file or its
   * repository is gone.
   */
  async file(repo: string, ref: string, path: string): Promise<Uint8Array | undefined> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return this.downloads.run(async () => {
      if (!this.rawUnreachable) {
        try {
          return await this.bytes(`${RAW}/${repo}/${ref}/${encoded}`, "raw", "*/*");
        } catch (error) {
          if (!(error instanceof Unreachable)) throw error;
          if (!this.rawUnreachable)
            this.log(
              `raw.githubusercontent.com cannot be reached (${error.message}); reading files through the contents API`,
            );
          this.rawUnreachable = true;
        }
      }
      return this.bytes(
        `${API}/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
        "core",
        "application/vnd.github.raw+json",
      );
    });
  }

  private async bytes(url: string, resource: Resource, accept: string) {
    const response = await this.request(url, resource, accept);
    if (GONE.has(response.status)) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub answered HTTP ${response.status} for ${shown(url)}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async json<T>(path: string, resource: Resource): Promise<T | undefined> {
    const response = await this.request(`${API}${path}`, resource, "application/vnd.github+json");
    // A 403 that is not about the rate is a repository GitHub will not show.
    if (GONE.has(response.status) || (response.status === 403 && !(await rateLimited(response)))) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub answered HTTP ${response.status} for ${shown(path)}`);
    }
    return (await response.json()) as T;
  }

  /** Send a request, within GitHub's limits, and try it again as the module's comment says. */
  private async request(url: string, resource: Resource, accept: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept, "User-Agent": "resume-tools-corpus" };
    if (resource !== "raw") headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    for (let attempt = 0; ; attempt++) {
      await this.withinLimits(resource);
      let response: Response;
      try {
        response = await this.send(url, { headers });
      } catch (error) {
        if (attempt >= RETRIES) throw new Unreachable(`${shown(url)}: ${reason(error)}`);
        await this.sleep(BACKOFF_MS * 2 ** attempt);
        continue;
      }
      this.noteLimits(resource, response);
      const wait = await this.retryWait(response, attempt);
      if (wait === undefined || attempt >= RETRIES) return response;
      await response.body?.cancel();
      this.log(
        `  HTTP ${response.status} for ${shown(url)}; trying again in ${Math.ceil(wait / 1000)} s`,
      );
      await this.sleep(wait);
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
  private async retryWait(response: Response, attempt: number): Promise<number | undefined> {
    const { status } = response;
    if (status < 500 && status !== 429 && !(status === 403 && (await rateLimited(response))))
      return undefined;
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
