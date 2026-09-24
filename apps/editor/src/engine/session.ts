/**
 * One running TeX engine: the BusyTeX WebAssembly build of TeX Live 2023, which holds pdfTeX,
 * XeTeX and xdvipdfmx in one binary, reading a TeX Live tree one file at a time.
 *
 * The same session runs in the browser's compile worker and in Node for tests and the validation
 * harness; only where the engine and its files come from differs. Every file in the manifest
 * becomes an empty file that knows its size, and its contents are read the first time TeX opens
 * it, because kpathsea stats many candidates for each file it looks up and opens only one.
 *
 * The engine's `main` can run only once per heap, so the session keeps a copy of the start of the
 * heap from just after start-up and puts it back after every run, as BusyTeX itself does. The
 * project's files live in the engine's file system, outside the heap, and survive.
 */

import { summariseLog } from "./log";
import { filenameDatabase } from "./lsr";
import type { EngineManifest } from "./manifest";

export type Engine = "pdftex" | "xetex";

interface EngineSpec {
  /** The program name BusyTeX runs the engine under. */
  program: string;
  /** The extension of what the engine writes: DVI for pdfTeX, XDV for XeTeX. */
  output: string;
  stockFormat: string;
  args: string[];
}

const COMMON = ["--no-shell-escape", "--interaction=nonstopmode", "--halt-on-error"];

const ENGINES: Record<Engine, EngineSpec> = {
  pdftex: {
    program: "pdflatex",
    output: "dvi",
    stockFormat: "/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt",
    args: [...COMMON, "--output-format=dvi"],
  },
  xetex: {
    program: "xelatex",
    output: "xdv",
    stockFormat: "/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt",
    args: [...COMMON, "--no-pdf"],
  },
};

/** The folder TeX runs in: documents, their auxiliary files, and files such as class files. */
export const PROJECT = "/home/web_user/project_dir";

/** Formats live apart from the project, so no job's files can collide with them. */
export const FORMATS = "/home/web_user/formats";

/** What TeX and LaTeX write next to a job, which `forget` removes; nothing a template supplies. */
const GENERATED = ["aux", "out", "toc", "lof", "lot", "log", "dvi", "xdv", "pdf", "fls", "tex"];

/**
 * The TeX Live trees kpathsea searches, in order: TeX Live's own configuration, generated files
 * and distribution, then the Ubuntu bundles' packages (see `scripts/fetch-engine.ts`). kpathsea
 * finds files in each through a filename database the session builds from the manifest, and never
 * by listing folders, which cost about 200 ms per compile of Jake's Resume.
 */
export const TREES = [
  "/texlive/texmf-dist/texmf-config",
  "/texlive/texmf-dist/texmf-var",
  "/texlive/texmf-dist",
  "/texmf/texmf-dist",
];
const DATABASES = `{${TREES.map((tree) => `!!${tree}`).join(",")}}`;

/** kpathsea reads these from the environment before texmf.cnf. */
const ENV: Record<string, string> = {
  TEXMF: DATABASES,
  TEXMFDBS: DATABASES,
  TEXMFDIST: "/texlive/texmf-dist:/texmf/texmf-dist",
  TEXMFVAR: "/texlive/texmf-dist/texmf-var",
  TEXMFCNF: "/texlive/texmf-dist/web2c",
  FONTCONFIG_PATH: "/texlive",
  // Wide enough that TeX never wraps a line of its log, so the log can be read line by line.
  max_print_line: "10000",
  error_line: "254",
  half_error_line: "238",
};

/** The start of the heap restored after every run; all of the engine's state fits in it. */
const HEADER_BYTES = 2 ** 26;

/** A file in Emscripten's in-memory file system. */
interface MemfsNode {
  usedBytes: number;
  contents: Uint8Array | null;
}

/** The part of Emscripten's file system API the session uses. */
export interface EmscriptenFs {
  mkdirTree(path: string): void;
  create(path: string, mode: number): MemfsNode;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
  readFile(path: string, options: { encoding: "utf8" }): string;
  unlink(path: string): void;
  readdir(path: string): string[];
  analyzePath(path: string): { exists: boolean };
  chdir(path: string): void;
}

/** The engine module Emscripten's factory resolves to. */
export interface EngineModule {
  FS: EmscriptenFs;
  HEAPU8: Uint8Array;
  callMain(args: string[]): number;
  _flush_streams(): void;
}

/** What Emscripten's factory takes. It adds `FS` and `ENV` to the same object before `preRun`. */
export interface EngineModuleOptions {
  thisProgram: string;
  noInitialRun: boolean;
  locateFile?: (name: string) => string;
  preRun: (() => void)[];
  print: (text: string) => void;
  printErr: (text: string) => void;
  FS?: EmscriptenFs;
  ENV?: Record<string, string>;
}

/** The engine's loader: `busytex.js` in Node, `busytex.mjs` in the worker. */
export type LoadEngine = (options: EngineModuleOptions) => Promise<EngineModule>;

export interface SessionOptions {
  load: LoadEngine;
  manifest: EngineManifest;
  /** Reads a TeX Live file by its path in the engine's file system. Must be synchronous. */
  read: (path: string) => Uint8Array;
  locateFile?: (name: string) => string;
  /** Called after every run. Node uses it to clear the exit code TeX's exit() leaves behind. */
  afterRun?: () => void;
  /**
   * Check after start-up that nothing past the restored prefix of the heap holds state, which a
   * different engine build could break. It costs about 100 ms, so Node, which runs the tests on
   * the same pinned engine as the browser, checks and the worker does not.
   */
  verifyHeap?: boolean;
}

/** TeX Live files read since the last result: how many, how many bytes, and which. */
export interface Fetched {
  files: number;
  bytes: number;
  paths: string[];
}

export interface StartResult {
  ms: number;
  /** Files in the manifest, all mounted. */
  files: number;
  heapMb: number;
  fetched: Fetched;
}

export interface RunResult {
  code: number;
  ms: number;
  /** What the program printed to the terminal. */
  output: string;
}

export interface DumpResult {
  ok: boolean;
  /** The format, when the dump succeeded. The session keeps its own copy for compiles. */
  format?: Uint8Array;
  ms: number;
  log: string;
  error?: string;
  fetched: Fetched;
}

export interface CompileResult {
  ok: boolean;
  /** The DVI, or XDV from XeTeX, when TeX shipped out at least one page. */
  output?: Uint8Array;
  pages: number;
  /** How long each pass took, in milliseconds. */
  passes: number[];
  log: string;
  error?: string;
  errorLine?: number;
  fetched: Fetched;
}

export interface CompileOptions {
  /** The document's name in the project folder; one per open document. Defaults to "doc". */
  job?: string;
  /** Passes at most; a pass is repeated when the document is new or the log asks for one. */
  maxPasses?: number;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const checkName = (kind: string, name: string) => {
  if (!NAME.test(name)) throw new Error(`${kind} name must be letters, digits, - and _: ${name}`);
};

class Tally {
  private fetched: Fetched = { files: 0, bytes: 0, paths: [] };
  add(path: string, bytes: number) {
    this.fetched.files++;
    this.fetched.bytes += bytes;
    this.fetched.paths.push(path);
  }
  take(): Fetched {
    const fetched = this.fetched;
    this.fetched = { files: 0, bytes: 0, paths: [] };
    return fetched;
  }
}

/**
 * Make every manifest file an empty node whose contents are read on first use, and give each
 * tree a filename database built from the manifest in place of any the tree ships with.
 */
function mountOnDemand(fs: EmscriptenFs, options: SessionOptions, tally: Tally) {
  const paths = Object.keys(options.manifest.files);
  const databases = new Set(TREES.map((tree) => `${tree}/ls-R`));
  for (const tree of TREES) {
    fs.mkdirTree(tree);
    fs.writeFile(`${tree}/ls-R`, filenameDatabase(paths, tree));
  }
  for (const [path, size] of Object.entries(options.manifest.files)) {
    if (databases.has(path)) continue;
    fs.mkdirTree(path.slice(0, path.lastIndexOf("/")) || "/");
    const node = fs.create(path, 0o444);
    node.usedBytes = size;
    const settle = (value: Uint8Array | null) =>
      Object.defineProperty(node, "contents", { value, writable: true, configurable: true });
    Object.defineProperty(node, "contents", {
      configurable: true,
      get() {
        const data = options.read(path);
        // A size that disagrees means the tree and its manifest are out of step.
        if (data.length !== size)
          throw new Error(`${path}: the manifest says ${size} bytes, got ${data.length}`);
        tally.add(path, data.length);
        settle(data);
        return data;
      },
      set: settle,
    });
  }
}

export class EngineSession {
  /** The format each job was last compiled with, so a change of format drops stale aux files. */
  private readonly formatOf = new Map<string, string>();

  private constructor(
    private readonly engine: EngineModule,
    private readonly header: Uint8Array,
    private readonly printed: string[],
    private readonly tally: Tally,
    private readonly afterRun: (() => void) | undefined,
  ) {}

  static async start(
    options: SessionOptions,
  ): Promise<{ session: EngineSession; result: StartResult }> {
    const started = performance.now();
    const printed: string[] = [];
    const tally = new Tally();
    const moduleOptions: EngineModuleOptions = {
      thisProgram: "/bin/busytex",
      noInitialRun: true,
      locateFile: options.locateFile,
      preRun: [
        () => {
          const { FS, ENV: env } = moduleOptions;
          if (!FS || !env) throw new Error("the engine did not provide FS and ENV before preRun");
          Object.assign(env, ENV);
          FS.mkdirTree(PROJECT);
          FS.mkdirTree(FORMATS);
          mountOnDemand(FS, options, tally);
        },
      ],
      print: (text) => printed.push(text),
      printErr: (text) => printed.push(text),
    };
    const engine = await options.load(moduleOptions);
    engine.FS.chdir(PROJECT);
    if (options.verifyHeap) {
      const past = new Int32Array(engine.HEAPU8.buffer, HEADER_BYTES);
      for (let i = 0; i < past.length; i++)
        if (past[i] !== 0) throw new Error("the engine's heap holds state past its first 64 MB");
    }
    const session = new EngineSession(
      engine,
      engine.HEAPU8.slice(0, HEADER_BYTES),
      printed,
      tally,
      options.afterRun,
    );
    const result: StartResult = {
      ms: performance.now() - started,
      files: Object.keys(options.manifest.files).length,
      heapMb: engine.HEAPU8.length / 2 ** 20,
      fetched: tally.take(),
    };
    return { session, result };
  }

  /** Run one program of the binary, such as `pdflatex` or `xdvipdfmx`, in the project folder. */
  run(args: string[]): RunResult {
    this.printed.length = 0;
    const started = performance.now();
    let code: number;
    try {
      code = this.engine.callMain([...args]); // callMain changes the array it is given
      this.engine._flush_streams();
    } finally {
      // Put the heap back even when the run threw, so the next run starts clean.
      const heap = this.engine.HEAPU8;
      heap.fill(0);
      heap.set(this.header);
      this.afterRun?.();
    }
    return { code, ms: performance.now() - started, output: this.printed.join("\n") };
  }

  /**
   * Dump a preamble into a format named `name`, which later compiles can load. It runs in the
   * project folder, so it finds files written there, and leaves only the format behind.
   */
  dump(engine: Engine, name: string, preamble: string): DumpResult {
    checkName("format", name);
    const spec = ENGINES[engine];
    const at = (extension: string) => `${FORMATS}/${name}.${extension}`;
    this.tally.take();
    for (const extension of ["fmt", "tex", "log"]) this.removePath(at(extension));
    this.engine.FS.writeFile(at("tex"), `${preamble}\n\\dump\n`);
    const run = this.run([
      spec.program,
      "-ini",
      `-jobname=${name}`,
      `-output-directory=${FORMATS}`,
      ...spec.args,
      `&${spec.program}`,
      at("tex"),
    ]);
    const log = this.readPath(at("log"), "utf8") ?? "";
    const format = this.readPath(at("fmt"));
    for (const extension of ["tex", "log"]) this.removePath(at(extension));
    const ok = run.code === 0 && format !== undefined;
    return {
      ok,
      format: ok ? format : undefined,
      ms: run.ms,
      log,
      error: ok
        ? undefined
        : (summariseLog(log).error ?? `${spec.program} exited with ${run.code}`),
      fetched: this.tally.take(),
    };
  }

  /** Put a format made earlier, by this session or another, where compiles can load it. */
  putFormat(name: string, format: Uint8Array) {
    checkName("format", name);
    this.engine.FS.writeFile(`${FORMATS}/${name}.fmt`, format);
  }

  /**
   * Compile a body from a format: `stock` for the engine's own, or a name given to `dump` or
   * `putFormat`. The body is everything the format does not hold, usually from
   * `\begin{document}` on. A new document gets a second pass, since the first writes the
   * auxiliary files the second reads, and any pass is repeated when the log asks for it.
   */
  compile(
    engine: Engine,
    format: string,
    body: string,
    options: CompileOptions = {},
  ): CompileResult {
    const job = options.job ?? "doc";
    checkName("job", job);
    if (format !== "stock") checkName("format", format);
    const spec = ENGINES[engine];
    const formatPath = format === "stock" ? spec.stockFormat : `${FORMATS}/${format}.fmt`;
    if (!this.engine.FS.analyzePath(formatPath).exists)
      throw new Error(`no format named ${format}`);
    const formatKey = `${engine}:${format}`;
    if (this.formatOf.get(job) !== formatKey) this.forget(job);
    this.formatOf.set(job, formatKey);

    this.tally.take();
    this.write(`${job}.tex`, body);
    const fresh = !this.exists(`${job}.aux`);
    const passes: number[] = [];
    const maxPasses = options.maxPasses ?? 3;
    let run: RunResult;
    let log: string;
    for (;;) {
      this.remove(`${job}.${spec.output}`);
      run = this.run([spec.program, ...spec.args, "--fmt", formatPath, `${job}.tex`]);
      passes.push(run.ms);
      log = this.readText(`${job}.log`);
      const again = run.code === 0 && ((fresh && passes.length === 1) || summariseLog(log).rerun);
      if (!again || passes.length >= maxPasses) break;
    }
    const summary = summariseLog(log);
    const output = this.readBytes(`${job}.${spec.output}`);
    const ok = run.code === 0 && output !== undefined;
    return {
      ok,
      output: ok ? output : undefined,
      pages: summary.pages,
      passes,
      log,
      error: ok ? undefined : (summary.error ?? `${spec.program} exited with ${run.code}`),
      errorLine: ok ? undefined : summary.errorLine,
      fetched: this.tally.take(),
    };
  }

  /** Remove the files TeX wrote for a job, so its next compile starts as a new document. */
  forget(job: string) {
    checkName("job", job);
    for (const extension of GENERATED) this.remove(`${job}.${extension}`);
    this.formatOf.delete(job);
  }

  /** Write a file into the project folder, such as a template's class file. */
  write(name: string, data: string | Uint8Array) {
    if (name.includes("/") || name.startsWith("."))
      throw new Error(`not a plain file name: ${name}`);
    this.engine.FS.writeFile(`${PROJECT}/${name}`, data);
  }

  private exists(name: string): boolean {
    return this.engine.FS.analyzePath(`${PROJECT}/${name}`).exists;
  }

  private remove(name: string) {
    this.removePath(`${PROJECT}/${name}`);
  }

  private readText(name: string): string {
    return this.readPath(`${PROJECT}/${name}`, "utf8") ?? "";
  }

  private readBytes(name: string): Uint8Array | undefined {
    return this.readPath(`${PROJECT}/${name}`);
  }

  private removePath(path: string) {
    if (this.engine.FS.analyzePath(path).exists) this.engine.FS.unlink(path);
  }

  private readPath(path: string): Uint8Array | undefined;
  private readPath(path: string, encoding: "utf8"): string | undefined;
  private readPath(path: string, encoding?: "utf8"): Uint8Array | string | undefined {
    if (!this.engine.FS.analyzePath(path).exists) return undefined;
    return encoding ? this.engine.FS.readFile(path, { encoding }) : this.engine.FS.readFile(path);
  }
}
