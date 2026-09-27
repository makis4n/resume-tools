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

import { type DviDocument, parseDvi } from "../tex/dvi";
import { paperSizeOf } from "../tex/svg";
import { summariseLog } from "./log";
import { filenameDatabase } from "./lsr";
import type { EngineManifest } from "./manifest";
import { isFileName, NAME } from "./names";

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

/**
 * How many of xdvipdfmx's own messages, the last it printed, say why it made no PDF: its fatal
 * error, and the warnings before it that name the font or the special it stopped on.
 */
const LAST_MESSAGES = 4;

const HOME = "/home/web_user";
/** Each job's folder holds its body, the files the caller supplies, and what TeX writes. */
const JOBS = `${HOME}/jobs`;
/** Each dump runs in a folder of its own, removed once the format is out of it. */
const BUILDS = `${HOME}/builds`;
/** Finished formats, which only the session writes; TeX never runs in this folder. */
const FORMATS = `${HOME}/formats`;

/**
 * The name fontconfig reads its configuration under, from the folder a run is in first and then
 * from FONTCONFIG_HOME. A dot file, which TeX may neither write nor read (`openin_any` and
 * `openout_any` below) and no caller may supply (`isJobPath`), so that only the session writes one.
 */
const FONTCONFIG_FILE = ".fonts.conf";
/**
 * Where fontconfig finds its configuration when the run's folder has none: a link to the tree's
 * own, `/etc/fonts/fonts.conf`, which lists no font folder (decision 0011).
 */
const FONTCONFIG_HOME = `${HOME}/fontconfig`;
/** The tree's own fontconfig configuration. */
const TREE_FONTCONFIG = "/etc/fonts/fonts.conf";

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
  // The engine reads its environment once, when it starts, so a compile cannot change it. These
  // point fontconfig at a file a compile can: `.fonts.conf` in the folder the run is in, which the
  // session writes for a compile that asks for fonts by name (`CompileOptions.fontsByName`), and
  // otherwise the tree's own, through FONTCONFIG_HOME.
  FONTCONFIG_FILE,
  FONTCONFIG_PATH: `.:${FONTCONFIG_HOME}`,
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

/**
 * What a dump runs after the preamble: a line for `\everyjob`, which TeX runs as a job loads the
 * format and before it reads the body, then `\dump`.
 *
 * TeX dumps only an empty page with no dead cycles, and LaTeX's preamble leaves neither: the class's
 * `\onecolumn` clears a page as it loads, a dead cycle, and what a package writes onto the page as
 * the preamble runs stays there, as hyperref's PDF version and dvipdfmx's flags, and xcolor's
 * first colour and a page colour, which a whole compile ships with its first page. So `\dump`, as
 * `\end` does, first appends `\hbox to\hsize{}\vfill\penalty-'10000000000` and runs the output
 * routine, which LaTeX's `\@specialoutput` answers by putting the page into `\@holdpg`: what the
 * preamble wrote, the `\topskip` glue, the box and the `\vfill`. The format kept all that and the
 * output penalty that fired it, and a body compiled from it started with them: what the preamble
 * wrote never reached the page (decision 0014), and a page whose first output finds an empty page,
 * as paracol's does at the top of one, set its text below the box (decision 0023). So each job of
 * the format starts as the whole document does: what the preamble wrote back on the page, less
 * what `\dump` added, the glue only when no box stood on the page before it, `\@holdpg` void, and
 * the output penalty, the dead cycles and the main list's `\prevdepth` as the preamble left them,
 * which the line reads before `\dump`.
 */
const DUMP_END = String.raw`\begingroup\catcode64=11\relax
\edef\x{\endgroup\everyjob{\the\everyjob
  \begingroup
    \setbox0=\vbox{\unvbox\@holdpg
      \noexpand\ifnum\lastnodetype=11 \unskip\noexpand\fi
      \noexpand\ifnum\lastnodetype=1 \setbox0=\lastbox\noexpand\fi
      \ifdim\pagegoal=\maxdimen\noexpand\ifnum\lastnodetype=11 \unskip\noexpand\fi\fi}%
    \unvbox0
  \endgroup
  \global\setbox\@holdpg=\box\voidb@x
  \global\outputpenalty=\the\outputpenalty\relax
  \deadcycles=\the\deadcycles\relax
  \prevdepth=\the\prevdepth\relax}}\x
\dump
`;

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
  symlink(target: string, path: string): void;
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

/**
 * Files a template supplies, such as a class file, by plain file name; or, for a compile, the
 * files of an upload, by their paths in the job's folder (`isJobPath`).
 */
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

export interface PdfOptions {
  /** Deflate level 0 to 9; xdvipdfmx's default when left out. Tests read a level 0 PDF. */
  compress?: number;
  /**
   * The images the PDF may show: paths of files in the job's folder that the caller gave the job
   * as blank stand-ins for an upload's images (decision 0019). A `pdf:image`, `pdf:img` or
   * `pdf:epdf` special whose file, resolved inside the job's folder, is one of them, and still
   * holds the bytes the caller gave, is taken; every other is refused, as without the list. Only a
   * path of letters, digits, `.`, `_`, `-` and `/` can be listed, with no part that starts with a
   * dot (`isShowableImage`): any other in the list counts for nothing.
   */
  images?: readonly string[];
}

export interface PdfResult {
  ok: boolean;
  /** The PDF, when xdvipdfmx made one. */
  pdf?: Uint8Array;
  ms: number;
  /** What xdvipdfmx printed to the terminal, where its warnings go. */
  output: string;
  /** Why there is no PDF: for the console, never for a user. */
  error?: string;
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
   * Files to put in the job's folder, such as a template's own files, or an upload's by their
   * paths in it (`isJobPath`). They stay with the job, so they need passing only once, until it is
   * forgotten or compiled with another format (another engine or another name). A format name
   * stands for one template: dumping or putting it again keeps a job's files, so give another
   * template another name, or forget the job before moving it over.
   */
  files?: JobFiles;
  /**
   * Let XeTeX find fonts by name for this compile's passes, as fontspec asks fontconfig for them:
   * the session writes a fontconfig configuration into the job's folder that lists the tree's
   * `fonts/opentype` and `fonts/truetype` folders and the job's own, for fonts an upload ships, and
   * takes it out after, so that fontconfig scans no folder again (decision 0011). Only the import
   * pipeline's reference compile asks for it (decision 0019); the scan costs every XeTeX pass that
   * reads it, and pdfTeX never uses fontconfig.
   */
  fontsByName?: boolean;
}

const checkName = (kind: string, name: string) => {
  if (!NAME.test(name)) throw new Error(`${kind} name must be letters, digits, - and _: ${name}`);
};
const checkFileName = (name: string) => {
  if (!isFileName(name)) throw new Error(`not a plain file name: ${name}`);
};
/**
 * A file's path in a job's folder: plain file names joined by `/`, so no part is empty, `.`, `..`
 * or a dot file, and the path stays inside the folder.
 */
export const isJobPath = (path: string) => path !== "" && path.split("/").every(isFileName);
const checkJobPath = (path: string) => {
  if (!isJobPath(path)) throw new Error(`not a path inside the job's folder: ${path}`);
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

/**
 * Whether an output's first page names its own size, so xdvipdfmx need not be told one. geometry
 * and hyperref write it in a `papersize=` special for pdfTeX, and XeTeX and the xetex/dvipdfmx
 * driver in a `pdf:pagesize` one instead; `paperSizeOf` reads both, the same as the page and the
 * harness, so all three agree and a set A4 size is not forced to Letter (`-p letter`).
 */
function namesPaperSize(parsed: DviDocument): boolean {
  return paperSizeOf(parsed.pages[0]?.items ?? []) !== undefined;
}

/**
 * The dvipdfmx `\special` commands that read a file from the engine's file system and embed it in
 * the PDF, which xdvipdfmx runs whatever `openin_any` says (unlike TeX), by the keyword it
 * dispatches on: `pdf:image`/`pdf:img`/`pdf:epdf` include a graphic, `pdf:fstream` a file as a
 * stream, `pdf:mapfile`/`pdf:mapline` a font through a map. dvips's `\special{psfile=...}` names a
 * PostScript file the same way.
 */
const READS_A_FILE = new Set(["image", "img", "epdf", "fstream", "mapfile", "mapline"]);

/**
 * The `x:` specials, XeTeX's, which xdvipdfmx runs for pdfTeX's output too, that load a font map
 * from a file or a line as `pdf:mapfile` and `pdf:mapline` do: a map line can point a font at any
 * file of the engine's, which xdvipdfmx then embeds.
 */
const X_READS_A_FILE = new Set(["fontmapfile", "fontmapline"]);

/**
 * The `dvipdfmx:config` options that only tune the PDF and reach nothing outside it: `C`
 * compatibility flags, `V` the PDF version, `P` the permission flags. Every other option is a
 * command-line flag that reads a file or reconfigures the run: `f` loads a font map (the same class
 * as `pdf:mapfile`, and a map a job ships can point a font at a cross-job or absolute path), `D`
 * sets a command to run, and the page and offset options change the output. The option is matched
 * with regard to case, since `P` (permissions) and `p` (paper) differ only by it.
 */
const SAFE_CONFIG = new Set(["C", "V", "P"]);

/**
 * The command of a `\special` that would make xdvipdfmx read a file or reconfigure the run, or
 * undefined for one that would not. It is the one thing between an output and a PDF that can reach
 * outside the job's folder: resume text cannot emit a special (decision 0007 escapes every
 * backslash), but a template can, so `pdf` scans every special and refuses the PDF rather than
 * embed, say, another job's file or a TeX Live file (version one's PDFs carry no images at all;
 * decision 0008).
 *
 * dvipdfmx parses a `pdf:` or `x:` special as the prefix then optional spaces then the command
 * keyword, and a `dvipdfmx:config` special as the prefix then optional spaces then `config` then
 * the option, all matched without regard to case except the option letter; a dvips special is the
 * raw `psfile=`/`PSfile=`. Harmless specials (`pdf:pagesize`, `pdf:literal`, `pdf:link`, `x:gsave`,
 * `papersize=`, `color push`, the field markers, `dvipdfmx:config C`) name no such command and pass.
 */
export function refusedSpecial(text: string): string | undefined {
  const special = text.trimStart();
  if (/^psfile=/i.test(special)) return "psfile=";
  const command = /^pdf:\s*([a-z]+)/i.exec(special)?.[1]?.toLowerCase();
  if (command !== undefined) return READS_A_FILE.has(command) ? `pdf:${command}` : undefined;
  const xCommand = /^x:\s*([a-z]+)/i.exec(special)?.[1]?.toLowerCase();
  if (xCommand !== undefined) return X_READS_A_FILE.has(xCommand) ? `x:${xCommand}` : undefined;
  const option = /^dvipdfmx:\s*config\b\s*([a-z]+)?/i.exec(special)?.[1];
  if (option !== undefined && !SAFE_CONFIG.has(option)) return `dvipdfmx:config ${option}`;
  return undefined;
}

/** The folders of each tree that hold OpenType or TrueType fonts, as the manifest lists them. */
function fontFoldersOf(manifest: EngineManifest): string[] {
  const folders = TREES.flatMap((tree) => [`${tree}/fonts/opentype`, `${tree}/fonts/truetype`]);
  const paths = Object.keys(manifest.files);
  return folders.filter((folder) => paths.some((path) => path.startsWith(`${folder}/`)));
}

/** What an error thrown says, for a result's `error`. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A path an output names, as a path in the job's folder: a relative one, from the folder, as TeX
 * and XeTeX write a file they found there, with `./` or without; or an absolute one inside it, as
 * fontconfig gives a font it found there. Undefined for any other.
 */
export function insideJob(job: string, path: string): string | undefined {
  const folder = `${JOBS}/${job}/`;
  const relative = path.startsWith(folder)
    ? path.slice(folder.length)
    : path.startsWith("/")
      ? undefined
      : path;
  const name = relative?.replace(/^(?:\.\/)+/, "");
  return name !== undefined && isJobPath(name) ? name : undefined;
}

/** The specials that show an image, which may be a stand-in's (`PdfOptions.images`). */
const SHOWS_AN_IMAGE = new Set(["pdf:image", "pdf:img", "pdf:epdf"]);

/**
 * The file an image special names, as a path inside the folder xdvipdfmx runs in, or undefined
 * when it names none that can be told so: the first PDF string after the command, as
 * `(photo.png)`, with no parenthesis or escape in it, and nothing before it but the words, numbers
 * and `@name` the image specials take (`width 72pt`, `bbox 0 0 10 10`, `pagebox cropbox`), so that
 * no comment or other object can hide the file xdvipdfmx would read from this reading. A leading
 * `./`, which XeTeX writes, is dropped; a path that would leave the folder names none.
 */
export function imageFileOf(text: string): string | undefined {
  const match = /^\s*pdf:\s*(?:image|img|epdf)\b[\sA-Za-z0-9.+\-@_]*\(([^()\\]*)\)/i.exec(text);
  const name = match?.[1]?.replace(/^(?:\.\/)+/, "");
  return name !== undefined && isJobPath(name) ? name : undefined;
}

/**
 * Whether a path in a job's folder may be listed as an image the PDF shows (`PdfOptions.images`):
 * letters, digits, `.`, `_`, `-` and `/` only, and no part empty or starting with a dot, so none is
 * `..`. Nothing in such a name can mean anything to xdvipdfmx's reading of a special but the file.
 */
export const isShowableImage = (path: string) =>
  /^[A-Za-z0-9._\-/]+$/.test(path) && isJobPath(path);

/**
 * The first `\special` of any page that would make xdvipdfmx read a file or reconfigure the run,
 * but for one that shows an image whose file `allowed` takes. XeTeX writes a picture as such a
 * special too, and the XDV opcode that once placed one from a file, `pic_file`, is TeX--XeT's
 * end_reflect to this xdvipdfmx, which reads no file (`parseDvi`, decision 0008).
 */
function refusedOutputSpecial(
  parsed: DviDocument,
  allowed: (file: string) => boolean,
): string | undefined {
  for (const page of parsed.pages)
    for (const item of page.items) {
      if (item.kind !== "special") continue;
      const refused = refusedSpecial(item.text);
      if (refused === undefined) continue;
      const file = SHOWS_AN_IMAGE.has(refused) ? imageFileOf(item.text) : undefined;
      if (file === undefined || !allowed(file)) return refused;
    }
  return undefined;
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
  /**
   * The engine of each job whose last compile succeeded, which `pdf` needs. A failed compile can
   * leave in the folder the pages TeX shipped before its error, which are not the document.
   */
  private readonly outputOf = new Map<string, Engine>();

  private constructor(
    private readonly engine: EngineModule,
    private readonly header: Uint8Array,
    private readonly stackTop: number,
    private readonly printed: string[],
    private readonly tally: Tally,
    private readonly afterRun: (() => void) | undefined,
    /** The tree's folders of OpenType and TrueType fonts, which `fontsByName` lists. */
    private readonly fontFolders: readonly string[],
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
          for (const folder of [JOBS, BUILDS, FORMATS, FONTCONFIG_HOME]) FS.mkdirTree(folder);
          mountOnDemand(FS, options, tally);
          FS.symlink(TREE_FONTCONFIG, `${FONTCONFIG_HOME}/${FONTCONFIG_FILE}`);
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
      fontFoldersOf(options.manifest),
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
      this.engine.FS.writeFile(`${folder}/${name}.tex`, `${preamble}\n${DUMP_END}`);
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
    body: string | Uint8Array,
    options: CompileOptions = {},
  ): CompileResult {
    const job = options.job ?? "doc";
    const maxPasses = options.maxPasses ?? 3;
    checkEngine(engine);
    checkName("job", job);
    checkPasses(maxPasses);
    for (const path of Object.keys(options.files ?? {})) checkJobPath(path);
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
    this.outputOf.delete(job);

    this.tally.take();
    const fonts = options.fontsByName && engine === "xetex" ? this.fontconfig(job) : undefined;
    let attempt: ReturnType<EngineSession["passes"]>;
    try {
      attempt = this.passes(spec, formatPath, job, body, maxPasses, fonts);
      const left = maxPasses - attempt.passes.length;
      if (!attempt.ok && !attempt.fresh && left > 0) {
        this.clearFolder(job);
        const again = this.passes(spec, formatPath, job, body, left, fonts);
        attempt = { ...again, passes: [...attempt.passes, ...again.passes] };
      }
    } finally {
      // The session's default again: the next compile of the job scans no folder.
      if (fonts) this.removeTree(`${JOBS}/${job}/${FONTCONFIG_FILE}`);
    }
    const { fresh: _, ...result } = attempt;
    if (result.ok) this.outputOf.set(job, engine);
    return { ...result, fetched: this.tally.take() };
  }

  /**
   * The PDF of a job's last compile, which xdvipdfmx makes from the DVI or XDV that compile left
   * in the job's folder, so that the PDF and the page come from one output (plan section 5.5). A
   * job with no compile, or whose last compile failed, has none. The PDF is read and removed at
   * once, and comes back with what xdvipdfmx printed, where its warnings go. Why a PDF could not
   * be made is for the console, never for a user: xdvipdfmx speaks of fonts and specials.
   *
   * The page size is the output's own: geometry, hyperref and XeTeX write it in a `papersize=` or
   * `pdf:pagesize` special, which the page is drawn to (`paperSize` in `src/page/draw.ts`) and
   * which xdvipdfmx honours. An output without one is drawn on US Letter, so xdvipdfmx is told
   * Letter for it, since its own default, from `dvipdfmx.cfg`, is A4. It is told only then, because
   * a size given to it (`-p`) overrides the special, and XeTeX only ever writes the special.
   *
   * xdvipdfmx does not honour `openin_any`, so before it runs, every special of the output is
   * scanned and the PDF refused when one would read a file or reconfigure the run (`refusedSpecial`):
   * a template's special could otherwise embed another job's or a TeX Live file (decision 0008).
   * The one exception is an image the caller wrote into the job as a blank stand-in and lists in
   * `images` (decision 0019): a special that shows it, by a path inside the job's folder of plain
   * characters (`isShowableImage`), is taken while the file still holds the bytes the caller gave.
   *
   * Whatever becomes of the PDF, the result says so, and `pdf` throws only for arguments it
   * refuses, as every method does: an output it cannot read, whose specials it cannot scan, is not
   * handed to xdvipdfmx, and a run of xdvipdfmx that aborts rather than exits, as the tree's does
   * with a memory fault on an `x:escale` with no `x:bscale` open (decision 0013), is a PDF it
   * could not make, with the reason. `run` has put the engine back as start-up left it, so the
   * session goes on.
   */
  pdf(job: string, options: PdfOptions = {}): PdfResult {
    checkName("job", job);
    const { compress } = options;
    if (compress !== undefined && !(Number.isInteger(compress) && compress >= 0 && compress <= 9))
      throw new Error(`compress must be a whole number from 0 to 9: ${compress}`);
    const engine = this.outputOf.get(job);
    const file = engine === undefined ? undefined : `${job}.${ENGINES[engine].output}`;
    const output = file === undefined ? undefined : this.read(`${JOBS}/${job}/${file}`);
    if (file === undefined || output === undefined)
      return { ok: false, ms: 0, output: "", error: `${job} has no output to make a PDF of` };
    let parsed: DviDocument;
    try {
      parsed = parseDvi(output, () => undefined);
    } catch (error) {
      return {
        ok: false,
        ms: 0,
        output: "",
        error: `the output cannot be read: ${messageOf(error)}`,
      };
    }
    const images = new Set((options.images ?? []).filter(isShowableImage));
    const refused = refusedOutputSpecial(
      parsed,
      (file) => isShowableImage(file) && images.has(file) && this.holds(job, file),
    );
    if (refused !== undefined)
      return {
        ok: false,
        ms: 0,
        output: "",
        error: `the output has a \\special that reads a file or reconfigures xdvipdfmx: ${refused}`,
      };
    const args = [
      "xdvipdfmx",
      ...(namesPaperSize(parsed) ? [] : ["-p", "letter"]),
      ...(compress === undefined ? [] : ["-z", String(compress)]),
      "-o",
      `${job}.pdf`,
      file,
    ];
    const at = `${JOBS}/${job}/${job}.pdf`;
    let run: RunResult | undefined;
    let aborted: unknown;
    let pdf: Uint8Array | undefined;
    const started = performance.now();
    // A file TeX wrote under that name must not pass for the PDF.
    this.removeTree(at);
    try {
      run = this.run(args, `${JOBS}/${job}`);
      pdf = run.code === 0 ? this.read(at) : undefined;
    } catch (error) {
      // xdvipdfmx aborted rather than exited; `run` has put the engine back as start-up left it.
      aborted = error;
    } finally {
      this.removeTree(at);
    }
    if (run !== undefined && pdf !== undefined)
      return { ok: true, pdf, ms: run.ms, output: run.output };
    // What xdvipdfmx printed: all of it when it exited, and what it had when it aborted.
    const printed = run?.output ?? this.printed.join("\n");
    const said = printed.split("\n").filter((line) => line.startsWith("xdvipdfmx:"));
    const why =
      run === undefined
        ? `xdvipdfmx aborted: ${messageOf(aborted)}`
        : run.code === 0
          ? "xdvipdfmx wrote no PDF"
          : `xdvipdfmx exited with ${run.code}`;
    return {
      ok: false,
      ms: run?.ms ?? performance.now() - started,
      output: printed,
      error: [why, ...said.slice(-LAST_MESSAGES)].join("\n"),
    };
  }

  /** Forget a job: its folder, its files and its format, so its next compile starts afresh. */
  forget(job: string) {
    checkName("job", job);
    this.clearFolder(job);
    this.formatOf.delete(job);
    this.filesOf.delete(job);
    this.outputOf.delete(job);
  }

  /** Remove a job's folder, so it compiles as a new document; its files are written back. */
  private clearFolder(job: string) {
    this.removeTree(`${JOBS}/${job}`);
  }

  /**
   * Compile a job's body once, and again while it is new or its log asks, with `fonts`, when
   * given, as fontconfig's configuration in the job's folder.
   */
  private passes(
    spec: EngineSpec,
    formatPath: string,
    job: string,
    body: string | Uint8Array,
    maxPasses: number,
    fonts?: string,
  ): Omit<CompileResult, "fetched"> & { fresh: boolean } {
    const folder = `${JOBS}/${job}`;
    const at = (extension: string) => `${folder}/${job}.${extension}`;
    this.engine.FS.mkdirTree(folder);
    this.writeFiles(folder, this.filesOf.get(job) ?? {}, checkJobPath);
    this.engine.FS.writeFile(at("tex"), body);
    if (fonts !== undefined) this.engine.FS.writeFile(`${folder}/${FONTCONFIG_FILE}`, fonts);
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

  /**
   * Write files into a folder, each after `check` takes its name: a plain file name for a dump's,
   * a path in the job's folder for a compile's, whose folders are made first.
   */
  private writeFiles(folder: string, files: JobFiles, check = checkFileName) {
    for (const [name, data] of Object.entries(files)) {
      check(name);
      const slash = name.lastIndexOf("/");
      if (slash > 0) this.engine.FS.mkdirTree(`${folder}/${name.slice(0, slash)}`);
      this.engine.FS.writeFile(`${folder}/${name}`, data);
    }
  }

  /**
   * A fontconfig configuration that lists the tree's OpenType and TrueType folders and the job's
   * own, so that XeTeX finds a font by name there (`CompileOptions.fontsByName`).
   */
  private fontconfig(job: string): string {
    const folders = [...this.fontFolders, `${JOBS}/${job}`];
    return [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
      "<fontconfig>",
      ...folders.map((folder) => `  <dir>${folder}</dir>`),
      "</fontconfig>",
      "",
    ].join("\n");
  }

  /** Whether a file of a job's folder holds what the caller gave the job under its path. */
  private holds(job: string, path: string): boolean {
    const given = this.filesOf.get(job)?.[path];
    const held = this.read(`${JOBS}/${job}/${path}`);
    if (given === undefined || held === undefined) return false;
    const bytes = typeof given === "string" ? new TextEncoder().encode(given) : given;
    return bytes.length === held.length && bytes.every((byte, i) => byte === held[i]);
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
