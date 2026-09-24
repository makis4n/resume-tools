/**
 * One running TeX engine: the BusyTeX WebAssembly build of TeX Live 2023, which holds pdfTeX,
 * XeTeX and xdvipdfmx in one binary, reading a TeX Live tree one file at a time.
 *
 * The same session runs in the browser's compile worker and in Node for tests and the validation
 * harness; only where the engine and its files come from differs. Every file in the manifest
 * becomes an empty file that knows its size, and its contents are read the first time TeX opens
 * it, because kpathsea stats many candidates for each file it looks up and opens only one.
 *
 * The engine's `main` can run only once per engine state, so after every run the session puts
 * back what start-up left: the start of the heap, as BusyTeX itself does, and the stack pointer,
 * which lives outside the heap. It also closes the files TeX left open, which the restored heap
 * no longer knows about. Files live in the engine's file system, outside the heap, and survive.
 *
 * Every job runs in a folder of its own and every format is built in one, and TeX may read and
 * write only inside the folder it runs in, so one document or template cannot plant files for
 * another, read another's text, or overwrite a format.
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

const HOME = "/home/web_user";
/** Each job's folder holds its body, the files the caller supplies, and what TeX writes. */
const JOBS = `${HOME}/jobs`;
/** Each dump runs in a folder of its own, removed once the format is out of it. */
const BUILDS = `${HOME}/builds`;
/** Finished formats, which only the session writes; TeX never runs in this folder. */
const FORMATS = `${HOME}/formats`;

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
  // TeX may open only files below the folder it runs in: no absolute paths, no "..", no dot
  // files. Files kpathsea finds in the trees are not affected.
  openin_any: "p",
  openout_any: "p",
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

/** An open file in Emscripten's file system. */
interface EmscriptenStream {
  fd: number;
}

/** The part of Emscripten's file system API the session uses. */
export interface EmscriptenFs {
  mkdirTree(path: string): void;
  create(path: string, mode: number): MemfsNode;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
  readFile(path: string, options: { encoding: "utf8" }): string;
  unlink(path: string): void;
  rmdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  analyzePath(path: string): { exists: boolean };
  chdir(path: string): void;
  /** Open files by descriptor; a closed descriptor's slot is empty. */
  streams: (EmscriptenStream | null | undefined)[];
  close(stream: EmscriptenStream): void;
}

/** The engine module Emscripten's factory resolves to. */
export interface EngineModule {
  FS: EmscriptenFs;
  HEAPU8: Uint8Array;
  /** The WebAssembly exports, among them the stack pointer's getter and setter. */
  asm: { stackSave(): number; stackRestore(pointer: number): void };
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

/** Files a template supplies, such as a class file, by plain file name. */
export type JobFiles = Record<string, string | Uint8Array>;

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
  /** How long each pass took, in milliseconds, including a retry as a new document. */
  passes: number[];
  log: string;
  error?: string;
  errorLine?: number;
  fetched: Fetched;
}

export interface CompileOptions {
  /** The document's name, and the name of its folder; one per open document. Defaults to "doc". */
  job?: string;
  /**
   * Passes at most, a whole number from 1, and 3 by default. A pass is repeated when the document
   * is new or the log asks for one, and the retry as a new document takes its passes from the same
   * budget.
   */
  maxPasses?: number;
  /**
   * Files to put in the job's folder, such as a template's own files. They stay with the job, so
   * they need passing only once, until it is forgotten or compiled with another format (another
   * engine or another name). A format name stands for one template: dumping or putting it again
   * keeps a job's files, so give another template another name, or forget the job before moving
   * it over.
   */
  files?: JobFiles;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const checkName = (kind: string, name: string) => {
  if (!NAME.test(name)) throw new Error(`${kind} name must be letters, digits, - and _: ${name}`);
};
const checkFileName = (name: string) => {
  if (!name || name.includes("/") || name.startsWith("."))
    throw new Error(`not a plain file name: ${name}`);
};
/** A name for a format `dump` or `putFormat` makes; `stock` means the engine's own format. */
const checkFormatName = (name: string) => {
  checkName("format", name);
  if (name === "stock") throw new Error("stock is the engine's own format and cannot be replaced");
};
/** The engine is part of a format's path, so it must be one of ours, whatever the caller sent. */
const checkEngine = (engine: Engine) => {
  if (!Object.hasOwn(ENGINES, engine)) throw new Error(`no engine named ${engine}`);
};
const checkPasses = (maxPasses: number) => {
  if (!Number.isInteger(maxPasses) || maxPasses < 1)
    throw new Error(`maxPasses must be a whole number from 1: ${maxPasses}`);
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
  /**
   * The format each job was last compiled with, by engine and name, and the dump that made it.
   * A job whose format changes starts again as a new document with nothing it was given before;
   * one whose format is made again starts again as a new document and keeps its files.
   */
  private readonly formatOf = new Map<string, { format: string; generation: number }>();
  /** How many times each format has been put in place, by engine and name. */
  private readonly generations = new Map<string, number>();
  /** The files each job was given, written back whenever the session clears its folder. */
  private readonly filesOf = new Map<string, JobFiles>();

  private constructor(
    private readonly engine: EngineModule,
    private readonly header: Uint8Array,
    private readonly stackTop: number,
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
          for (const folder of [JOBS, BUILDS, FORMATS]) FS.mkdirTree(folder);
          mountOnDemand(FS, options, tally);
        },
      ],
      print: (text) => printed.push(text),
      printErr: (text) => printed.push(text),
    };
    const engine = await options.load(moduleOptions);
    engine.FS.chdir(HOME);
    if (options.verifyHeap) {
      const past = new Int32Array(engine.HEAPU8.buffer, HEADER_BYTES);
      for (let i = 0; i < past.length; i++)
        if (past[i] !== 0) throw new Error("the engine's heap holds state past its first 64 MB");
    }
    const session = new EngineSession(
      engine,
      engine.HEAPU8.slice(0, HEADER_BYTES),
      engine.asm.stackSave(),
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

  /** Run one program of the binary, such as `pdflatex` or `xdvipdfmx`, in the folder `cwd`. */
  run(args: string[], cwd = HOME): RunResult {
    const fs = this.engine.FS;
    const open = new Set(fs.streams.flatMap((stream) => (stream ? [stream.fd] : [])));
    this.printed.length = 0;
    fs.chdir(cwd);
    const started = performance.now();
    let code: number;
    try {
      code = this.engine.callMain([...args]); // callMain changes the array it is given
      this.engine._flush_streams();
    } finally {
      // Put the engine back as start-up left it, even when the run threw.
      const heap = this.engine.HEAPU8;
      heap.fill(0);
      heap.set(this.header);
      this.engine.asm.stackRestore(this.stackTop);
      for (const stream of fs.streams) if (stream && !open.has(stream.fd)) fs.close(stream);
      fs.chdir(HOME);
      this.afterRun?.();
    }
    return { code, ms: performance.now() - started, output: this.printed.join("\n") };
  }

  /**
   * Dump a preamble into a format named `name`, which later compiles with the same engine can
   * load. It runs in a folder of its own, with `files` beside it, and leaves only the format. A
   * dump that fails leaves any earlier format of that name in place. One that succeeds replaces
   * it, and the jobs compiled with it start again as new documents, keeping their files; a name
   * stands for one template, so another template needs another name.
   */
  dump(engine: Engine, name: string, preamble: string, files: JobFiles = {}): DumpResult {
    checkEngine(engine);
    checkFormatName(name);
    const spec = ENGINES[engine];
    const folder = `${BUILDS}/${name}`;
    this.tally.take();
    this.removeTree(folder);
    this.engine.FS.mkdirTree(folder);
    let run: RunResult;
    let log: string;
    let format: Uint8Array | undefined;
    try {
      this.writeFiles(folder, files);
      this.engine.FS.writeFile(`${folder}/${name}.tex`, `${preamble}\n\\dump\n`);
      run = this.run(
        [spec.program, "-ini", `-jobname=${name}`, ...spec.args, `&${spec.program}`, `${name}.tex`],
        folder,
      );
      log = this.read(`${folder}/${name}.log`, "utf8") ?? "";
      format = run.code === 0 ? this.read(`${folder}/${name}.fmt`) : undefined;
    } finally {
      this.removeTree(folder);
    }
    if (format) this.install(engine, name, format);
    return {
      ok: format !== undefined,
      format,
      ms: run.ms,
      log,
      error: format
        ? undefined
        : (summariseLog(log).error ?? `${spec.program} exited with ${run.code}`),
      fetched: this.tally.take(),
    };
  }

  /**
   * Put a format made earlier, by this session or another, where compiles can load it. As with
   * `dump`, a name stands for one template, and putting it again keeps its jobs' files.
   */
  putFormat(engine: Engine, name: string, format: Uint8Array) {
    checkEngine(engine);
    checkFormatName(name);
    this.install(engine, name, format);
  }

  /**
   * Compile a body from a format: `stock` for the engine's own, or a name given to `dump` or
   * `putFormat`. The body is everything the format does not hold, usually from
   * `\begin{document}` on. A new document gets a second pass, since the first writes the
   * auxiliary files the second reads, and any pass is repeated when the log asks for it.
   *
   * TeX reads a document's old auxiliary files before it writes new ones, so a bad line in any of
   * them (the .aux, an included part's .aux, the .toc) stops every later compile. A log cannot
   * say reliably which file an error came from, so any failure of a document that compiled
   * before is retried as a new document, within its budget of passes. A failed edit therefore
   * costs one extra pass, or two when the document compiles as new but fails on its second
   * pass, and never more than `maxPasses` in all. After a failure before `\begin{document}`,
   * which leaves the old auxiliary files as they were, the next good compile runs as a new
   * document too, in two passes. Pass `maxPasses: 1` to do without the retry.
   */
  compile(
    engine: Engine,
    format: string,
    body: string,
    options: CompileOptions = {},
  ): CompileResult {
    const job = options.job ?? "doc";
    const maxPasses = options.maxPasses ?? 3;
    checkEngine(engine);
    checkName("job", job);
    checkPasses(maxPasses);
    for (const name of Object.keys(options.files ?? {})) checkFileName(name);
    const spec = ENGINES[engine];
    const key = `${engine}:${format}`;
    let formatPath = spec.stockFormat;
    let generation = 0;
    if (format !== "stock") {
      checkName("format", format);
      const made = this.generations.get(key);
      if (made === undefined) throw new Error(`no ${engine} format named ${format}`);
      formatPath = this.formatPath(engine, format);
      generation = made;
    }
    const last = this.formatOf.get(job);
    if (last?.format !== key) this.forget(job);
    else if (last.generation !== generation) this.clearFolder(job);
    this.formatOf.set(job, { format: key, generation });
    if (options.files) this.filesOf.set(job, { ...this.filesOf.get(job), ...options.files });

    this.tally.take();
    let attempt = this.passes(spec, formatPath, job, body, maxPasses);
    const left = maxPasses - attempt.passes.length;
    if (!attempt.ok && !attempt.fresh && left > 0) {
      this.clearFolder(job);
      const again = this.passes(spec, formatPath, job, body, left);
      attempt = { ...again, passes: [...attempt.passes, ...again.passes] };
    }
    const { fresh: _, ...result } = attempt;
    return { ...result, fetched: this.tally.take() };
  }

  /** Forget a job: its folder, its files and its format, so its next compile starts afresh. */
  forget(job: string) {
    checkName("job", job);
    this.clearFolder(job);
    this.formatOf.delete(job);
    this.filesOf.delete(job);
  }

  /** Remove a job's folder, so it compiles as a new document; its files are written back. */
  private clearFolder(job: string) {
    this.removeTree(`${JOBS}/${job}`);
  }

  /** Compile a job's body once, and again while it is new or its log asks. */
  private passes(
    spec: EngineSpec,
    formatPath: string,
    job: string,
    body: string,
    maxPasses: number,
  ): Omit<CompileResult, "fetched"> & { fresh: boolean } {
    const folder = `${JOBS}/${job}`;
    const at = (extension: string) => `${folder}/${job}.${extension}`;
    this.engine.FS.mkdirTree(folder);
    this.writeFiles(folder, this.filesOf.get(job) ?? {});
    this.engine.FS.writeFile(at("tex"), body);
    const fresh = !this.engine.FS.analyzePath(at("aux")).exists;
    const passes: number[] = [];
    let run: RunResult;
    let log: string;
    for (;;) {
      // What an earlier pass wrote must not pass for what this one did.
      this.removeTree(at(spec.output));
      this.removeTree(at("log"));
      run = this.run([spec.program, ...spec.args, "--fmt", formatPath, `${job}.tex`], folder);
      passes.push(run.ms);
      log = this.read(at("log"), "utf8") ?? "";
      // Only a pass that shipped pages is worth another: one that failed, or that TeX finished
      // with nothing to ship, would do the same again.
      const shipped = run.code === 0 && this.engine.FS.analyzePath(at(spec.output)).exists;
      const again = shipped && ((fresh && passes.length === 1) || summariseLog(log).rerun);
      if (!again || passes.length >= maxPasses) break;
    }
    const summary = summariseLog(log);
    const output = run.code === 0 ? this.read(at(spec.output)) : undefined;
    const ok = output !== undefined;
    const failure =
      run.code === 0
        ? "No pages of output."
        : (summary.error ?? `${spec.program} exited with ${run.code}`);
    return {
      ok,
      output,
      pages: summary.pages,
      passes,
      log,
      error: ok ? undefined : failure,
      errorLine: ok ? undefined : summary.errorLine,
      fresh,
    };
  }

  /** Put a format in place and note that every job compiled with an earlier one is stale. */
  private install(engine: Engine, name: string, format: Uint8Array) {
    this.engine.FS.writeFile(this.formatPath(engine, name), format);
    const key = `${engine}:${name}`;
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  private formatPath(engine: Engine, name: string): string {
    return `${FORMATS}/${engine}-${name}.fmt`;
  }

  private writeFiles(folder: string, files: JobFiles) {
    for (const [name, data] of Object.entries(files)) {
      checkFileName(name);
      this.engine.FS.writeFile(`${folder}/${name}`, data);
    }
  }

  private removeTree(path: string) {
    const fs = this.engine.FS;
    if (!fs.analyzePath(path).exists) return;
    if (!fs.isDir(fs.stat(path).mode)) {
      fs.unlink(path);
      return;
    }
    for (const name of fs.readdir(path))
      if (name !== "." && name !== "..") this.removeTree(`${path}/${name}`);
    fs.rmdir(path);
  }

  private read(path: string): Uint8Array | undefined;
  private read(path: string, encoding: "utf8"): string | undefined;
  private read(path: string, encoding?: "utf8"): Uint8Array | string | undefined {
    if (!this.engine.FS.analyzePath(path).exists) return undefined;
    return encoding ? this.engine.FS.readFile(path, { encoding }) : this.engine.FS.readFile(path);
  }
}
