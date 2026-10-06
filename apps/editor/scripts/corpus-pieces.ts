/**
 * `corpus run`'s diagnostics of each imported document (the perf run's D1): where its words not in
 * place are, and where its compiles go.
 *
 * The words: each of the body's words the report counts as not in place, through the retype or
 * locked (`visitImportWords`, the report's own count), set down to the piece of the source that
 * holds most of its glyphs, as the probe's runs say (`Probe.runs`): a macro's or an environment's
 * argument, a section's title, a list's item, a paragraph, or a raw chunk; with why, `retype` or
 * the reason it is locked, and where that reason was decided. A piece is named by its macro's or
 * environment's name only where that name is plainly one and something public defines it: a file
 * of TeX Live's the document loaded, a public class's (the upstream samples'), or LaTeX's own
 * (`pieceName`); one the document's own `.tex` defines is a user macro or environment, one only an
 * uploaded class or package defines a class macro, and anything else another macro, whatever its
 * name. So the counts add up to the report's, reason by reason (`piecesOf`).
 *
 * The compiles: each compile of an import, timed where the session makes it (`TrialClock`), set
 * down to the step it is in, or in the checks, to the phase they say (`CheckEvent`), the probe's
 * bisection apart from the rest of the probe; and the budgets that ran out.
 *
 * What is printed and written is names of pieces, reasons, ids and counts, never a document's text.
 */

// Node runs this file by stripping its types, so it imports values only from files that import
// nothing Node lacks, and the editor's modules as types alone, with their real extensions.
import type { EngineSession } from "../src/engine/session.ts";
import type { CheckEvent, CheckPhase } from "../src/import/checks.ts";
import type { ProbeCandidate, UncoveredRun } from "../src/import/probe.ts";
// The report imports nothing but types, so Node runs it as it is.
import { type LockReason, type Report, visitImportWords } from "../src/import/report.ts";
import type { ImportStep } from "../src/import/run.ts";
import {
  BREAKDOWNS,
  CAUSE_BUCKETS,
  DECIDED,
  type Decided,
  DIFFERENCE_KINDS,
  type ImportBudgets,
  type ImportRow,
  imported,
  LOCK_REASONS,
  MOVED_DETAILS,
  type PieceWords,
  SHAPE_RULES,
  TRIALS,
  type TrialKind,
} from "./corpus-import.ts";
import { FAMILIES, printable } from "./corpus-manifest.ts";

// The names a text defines or mentions.

/** The macros and environments a text names, by name. */
export interface Names {
  macros: Set<string>;
  environments: Set<string>;
}

/**
 * A command that defines another, a macro, an environment, a list, a theorem or a box, in any of
 * TeX's, LaTeX's, xparse's, etoolbox's, tcolorbox's, mdframed's, letltxmacro's, fontspec's or
 * expl3's ways: a control word that begins `new`, `renew`, `provide` or `declare`, whatever its
 * case, or that holds `def`, `let`, `command`, `cmd`, `environ`, `list`, `theorem`, `box`,
 * `env`, `macro`, `family`, `_new`, `_set` or `_gset`. Generous on purpose: a name taken for
 * the document's own where it is not costs only a bucket.
 */
const DEFINER = String.raw`\\(?:(?:[Nn]ew|[Rr]enew|[Pp]rovide|[Dd]eclare)[A-Za-z@_:]*|[A-Za-z@_:]*(?:def|[Ll]et|[Cc]ommand|cmd|[Ee]nviron|list|theorem|[Bb]ox|env|[Mm]acro|[Ff]amily|_new|_set|_gset)[A-Za-z@_:]*)\*?\s*(?:\[[^\]]*\]\s*)*`;

/** A name a definer defines: `\x`, `{\x}`, or `{x}` for an environment or by its letters. */
const DEFINED_MACRO = new RegExp(`${DEFINER}(?:\\{\\s*)?\\\\([A-Za-z@]+)`, "g");
const DEFINED_BY_NAME = new RegExp(`${DEFINER}\\{\\s*([A-Za-z@]+\\*?)\\s*\\}`, "g");
/** A name made from its letters, which `\csname` defines as well as any. */
const CSNAME = /\\csname\s*([A-Za-z@]+)\s*\\endcsname/g;

/**
 * The names a text defines: each macro after a definer (`DEFINER`), and each name a definer takes
 * in braces, as an environment's or a list's, or a macro's by its letters, which counts as both,
 * as does a name built with `\csname`; and an environment `x` whose `\endx` it defines, as TeX
 * defines one by hand.
 */
export function definedNames(text: string): Names {
  const macros = new Set<string>();
  const environments = new Set<string>();
  for (const [, name] of text.matchAll(DEFINED_MACRO)) if (name !== undefined) macros.add(name);
  for (const regex of [DEFINED_BY_NAME, CSNAME])
    for (const [, name] of text.matchAll(regex))
      if (name !== undefined) {
        macros.add(name.replace(/\*$/, ""));
        environments.add(name);
      }
  for (const name of macros) if (/^end[A-Za-z@]+$/.test(name)) environments.add(name.slice(3));
  return { macros, environments };
}

/** Names together. */
export function joinedNames(all: Iterable<Names>): Names {
  const joined: Names = { macros: new Set(), environments: new Set() };
  for (const each of all) {
    for (const name of each.macros) joined.macros.add(name);
    for (const name of each.environments) joined.environments.add(name);
  }
  return joined;
}

/**
 * The files of TeX Live's tree a compile's log says it opened, `(/texmf/...` or `(/texlive/...`, which
 * `inTree` must know: the log's lines joined first, since TeX breaks a long path across them.
 */
export function loadedTreeFiles(log: string, inTree: (path: string) => boolean): string[] {
  const joined = log.replace(/\r?\n/g, "");
  const found = new Set<string>();
  for (const [, path] of joined.matchAll(
    /\((\/(?:texmf|texlive)\/[^\s()"]*?\.(?:cls|sty|def|cfg|clo|ldf|fd|ltx|tex))/g,
  ))
    if (path !== undefined && inTree(path)) found.add(path);
  return [...found];
}

/** What a macro or an environment is, as a piece of the source. */
export type NameKind = "macro" | "environment";

/** A name a table may show: letters and `@`, a star at the end at most, as TeX's are. */
export const PIECE_NAME = /^[A-Za-z@]{1,40}\*?$/;

/** The raw chunks' reasons (`RawWhy`), each a bucket of its own: `raw math`. */
const RAW_WHYS = [
  "command",
  "unknown",
  "unresolved",
  "definition",
  "environment",
  "math",
  "verbatim",
  "typewriter",
  "skipped",
  "alignment",
] as const;

/** The pieces that are no name: a closed list of words. */
export const PIECE_BUCKETS: readonly string[] = [
  "paragraph",
  "running line",
  "locked part",
  "user macro",
  "user environment",
  "class macro",
  "class environment",
  "other macro",
  "other environment",
  ...RAW_WHYS.map((why) => `raw ${why}`),
  "raw other",
];

/**
 * Where a document's names are defined, as either kind: its own `.tex` files (`user`), the other text files it
 * uploaded, its own classes and packages (`uploaded`), and whether something public defines one
 * (`known`): a file of TeX Live's it loaded, a public class, or LaTeX's own.
 */
export interface NameSources {
  user: Names;
  uploaded: Names;
  known: (kind: NameKind, name: string) => boolean;
}

/**
 * A macro's or an environment's name as a piece is named: a user macro or environment where the
 * document's own `.tex` defines it, as either kind, whatever else does; the name itself where it is plainly one and
 * something public defines it; a class macro or environment where only an uploaded class or package
 * does; and another macro or environment otherwise, as a name that is no name is.
 */
export function pieceName(kind: NameKind, name: string, sources: NameSources): string {
  if (!PIECE_NAME.test(name)) return `other ${kind}`;
  // Defined as either kind: a name the upload defines as a macro and uses as an environment, or
  // the other way, is its own all the same.
  const bare = name.replace(/\*$/, "");
  const has = (names: Names) =>
    [name, bare].some((each) => names.macros.has(each) || names.environments.has(each));
  if (has(sources.user)) return `user ${kind}`;
  if (sources.known(kind, name)) return name;
  if (has(sources.uploaded)) return `class ${kind}`;
  return `other ${kind}`;
}

/** The text files of an upload a name may be defined in, by extension. */
const TEXT_FILES = /\.(?:tex|cls|sty|def|cfg|clo|ldf|fd|ltx)$/i;

/**
 * An upload's own definitions (`definedNames`): its main file's and its other `.tex` files', and
 * those of its other text files, its own classes and packages.
 */
export function uploadNames(
  main: string,
  files: Readonly<Record<string, Uint8Array>>,
): { user: Names; uploaded: Names } {
  const decoder = new TextDecoder();
  const user = [definedNames(main)];
  const uploaded: Names[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (!TEXT_FILES.test(path)) continue;
    const names = definedNames(decoder.decode(bytes));
    (/\.tex$/i.test(path) ? user : uploaded).push(names);
  }
  return { user: joinedNames(user), uploaded: joinedNames(uploaded) };
}

/** What `namerOf` names a document's pieces from. */
export interface NamerInput {
  /** The document as the probe took it: its main file's text and its other files. */
  intake: { main: { text: string }; files: Readonly<Record<string, Uint8Array>> };
  /** Its reference compile's log, which names the files of the tree it loaded. */
  log: string;
  /** What the engine said of the names its body uses (`EngineSignatures`). */
  signatures: {
    commands: Readonly<Record<string, { kind: string }>>;
    environments: Readonly<Record<string, { kind: string }>>;
  };
  /** LaTeX's tables of its own macros and environments (`STANDARD`, `STANDARD_ENVIRONMENTS`). */
  standard: { macros: ReadonlyMap<string, unknown>; environments: ReadonlyMap<string, unknown> };
  /** Whether a path is a file of the tree, and what it defines (`definedNames`). */
  inTree: (path: string) => boolean;
  treeNames: (path: string) => Names;
  /** What the upstream samples' classes define, which are public. */
  shared: Names;
}

/**
 * How a document's pieces are named (`pieceName`): from its upload's own definitions, and what is
 * public: LaTeX's tables, what the engine says is LaTeX's own, what the files of the tree its
 * reference compile loaded define, and what the upstream samples' classes define.
 */
export function namerOf(input: NamerInput): (kind: NameKind, name: string) => string {
  const loaded = joinedNames(loadedTreeFiles(input.log, input.inTree).map(input.treeNames));
  const { commands, environments } = input.signatures;
  const { standard, shared } = input;
  const known = (kind: NameKind, name: string) =>
    kind === "macro"
      ? standard.macros.has(name) ||
        commands[name]?.kind === "standard" ||
        loaded.macros.has(name) ||
        shared.macros.has(name)
      : standard.environments.has(name) ||
        environments[name]?.kind === "standard" ||
        loaded.environments.has(name) ||
        shared.environments.has(name);
  const sources = { ...uploadNames(input.intake.main.text, input.intake.files), known };
  return (kind, name) => pieceName(kind, name, sources);
}

// The words not in place, by piece.

/** What `piecesOf` reads. */
export interface PiecesInput {
  /** The import, as `visitImportWords` counts its words. */
  imported: Parameters<typeof visitImportWords>[0];
  /** The probe's runs, in the order the report's owners were made from them (`ownersOf`). */
  runs: readonly UncoveredRun[];
  candidates: readonly Pick<
    ProbeCandidate,
    "id" | "kind" | "of" | "name" | "index" | "within" | "verdict"
  >[];
  /** A macro's or an environment's name as a piece is named (`pieceName`). */
  name: (kind: NameKind, name: string) => string;
  /**
   * For a candidate kept for `shape`, `differs` or `moved`, the rule, kind or detail behind it
   * (`causesOf`), which the pieces break their words down by (`PieceWords`); none, no breakdown.
   */
  cause?: (kept: keyof typeof BREAKDOWNS, candidate: string) => string;
}

/** What sets a glyph, as a piece: its name, an argument's place, and what kind of source it is. */
interface Label {
  piece: string;
  arg?: number;
  source: "raw" | "parse" | "probe" | "field";
  /** The probe's candidate whose run sets it, if one does. */
  candidate?: string;
}

/** Where a reason was decided, for a glyph no run of the probe's sets, a running line's copy. */
const decidedOf = (reason: LockReason): Decided =>
  reason === "raw"
    ? "parse"
    : reason === "shape"
      ? "outline"
      : reason === "differs" || reason === "compile" || reason === "text"
        ? "checks"
        : "probe";

/**
 * The words not in place of an import, by piece (the module's comment), the most first, and the
 * words as the report counts them, which they add up to: the retype's, and the locked by reason.
 */
export function piecesOf(input: PiecesInput): { pieces: PieceWords[]; words: Report["words"] } {
  const byId = new Map(input.candidates.map((each) => [each.id, each]));
  /** A candidate as a piece: a paragraph inside another the other's, which holds its words. */
  const pieceOfCandidate = (id: string, depth = 0): Omit<Label, "source"> => {
    const candidate = byId.get(id);
    if (candidate === undefined) return { piece: "other macro" };
    if (candidate.kind === "paragraph")
      return candidate.within !== undefined && depth < 8
        ? pieceOfCandidate(candidate.within, depth + 1)
        : { piece: "paragraph" };
    if (candidate.kind === "argument")
      return {
        piece: input.name(candidate.of === "environment" ? "environment" : "macro", candidate.name),
        ...(candidate.index === undefined ? {} : { arg: candidate.index }),
      };
    if (candidate.kind === "section") return { piece: input.name("macro", candidate.name) };
    return { piece: input.name("environment", candidate.name) };
  };
  const labelOf = (run: UncoveredRun): Label | undefined => {
    if (run.by === "raw" && run.raw !== undefined) {
      const { why, name } = run.raw;
      const environment = why === "environment" || why === "verbatim" || why === "alignment";
      const named =
        name !== undefined &&
        (environment ||
          why === "command" ||
          why === "unknown" ||
          why === "unresolved" ||
          why === "typewriter");
      return {
        piece: named
          ? input.name(environment ? "environment" : "macro", name)
          : (RAW_WHYS as readonly string[]).includes(why)
            ? `raw ${why}`
            : "raw other",
        source: "raw",
      };
    }
    if (run.by !== "candidate" || run.candidate === undefined) return undefined;
    const verdict = byId.get(run.candidate)?.verdict;
    return {
      ...pieceOfCandidate(run.candidate),
      candidate: run.candidate,
      source:
        verdict === "raw"
          ? "parse"
          : verdict === "editable" || verdict === "container"
            ? "field"
            : "probe",
    };
  };
  // Each glyph's label, as the report's owners give each glyph its run: later runs over earlier.
  const pages = input.imported.report.reference.pages;
  const labels = pages.map(
    (page) =>
      new Array<Label | undefined>(page.items.filter((item) => item.kind === "glyph").length),
  );
  for (const run of input.runs) {
    const row = labels[run.page];
    const label = labelOf(run);
    if (row === undefined || label === undefined) continue;
    for (let at = Math.max(0, run.from); at < Math.min(run.to, row.length); at++) row[at] = label;
  }
  const tally = new Map<string, PieceWords>();
  const visit = ({ word, owners, owner, counted, reason }: Parameters<VisitorOf>[0]) => {
    if (counted !== "retype" && counted !== "locked") return;
    const kept: LockReason = reason ?? "unmapped";
    // The piece that sets most of the word's glyphs among those it was set down to, the first of
    // them where two set as many; a running line's copy, which no run sets, where none does.
    const row = labels[word.page] ?? [];
    const counts = new Map<string, { label: Label; n: number }>();
    for (const at of word.glyphs) {
      const label = owners[at] === owner ? row[at] : undefined;
      if (label === undefined) continue;
      const key = `${label.piece}|${label.arg ?? ""}|${label.source}`;
      const each = counts.get(key) ?? { label, n: 0 };
      each.n++;
      counts.set(key, each);
    }
    let best: Label | undefined;
    let most = 0;
    for (const { label, n } of counts.values())
      if (n > most) {
        best = label;
        most = n;
      }
    const piece = owner.startsWith("p:") ? "locked part" : (best?.piece ?? "running line");
    const by: Decided =
      best === undefined
        ? decidedOf(kept)
        : best.source === "raw" || best.source === "parse"
          ? "parse"
          : best.source === "probe"
            ? "probe"
            : kept === "shape"
              ? "outline"
              : "checks";
    const why = counted === "retype" ? "retype" : kept;
    const arg = best?.arg;
    const key = `${piece}|${arg ?? ""}|${why}|${kept}|${by}`;
    const entry = tally.get(key) ?? {
      piece,
      ...(arg === undefined ? {} : { arg }),
      why,
      kept,
      by,
      words: 0,
    };
    entry.words++;
    // Why it is kept, further: the rule, kind or detail of the candidate whose runs set most of the
    // word's glyphs among those it was set down to; its piece's bucket where no candidate's run does.
    const breakdown = (BREAKDOWNS as Partial<Record<LockReason, keyof typeof CAUSES>>)[kept];
    if (breakdown !== undefined && input.cause !== undefined) {
      const reason = kept as keyof typeof BREAKDOWNS;
      const causes = new Map<string, number>();
      for (const at of word.glyphs) {
        const candidate = owners[at] === owner ? row[at]?.candidate : undefined;
        if (candidate === undefined) continue;
        const cause = input.cause(reason, candidate);
        causes.set(cause, (causes.get(cause) ?? 0) + 1);
      }
      let cause: string = (CAUSE_BUCKETS as readonly string[]).includes(piece) ? piece : "(other)";
      let n = 0;
      for (const [each, count] of causes)
        if (count > n) {
          cause = each;
          n = count;
        }
      const split = entry[breakdown] ?? {};
      split[cause] = (split[cause] ?? 0) + 1;
      entry[breakdown] = split;
    }
    tally.set(key, entry);
  };
  const words = visitImportWords(input.imported, visit);
  const pieces = [...tally.values()].sort(
    (a, b) =>
      b.words - a.words ||
      (a.piece < b.piece ? -1 : a.piece > b.piece ? 1 : 0) ||
      (a.arg ?? 0) - (b.arg ?? 0) ||
      (a.why < b.why ? -1 : a.why > b.why ? 1 : 0) ||
      (a.by < b.by ? -1 : a.by > b.by ? 1 : 0),
  );
  return { pieces, words };
}

type VisitorOf = Parameters<typeof visitImportWords>[1];

/** The fields a piece breaks its words down in, by reason kept (`BREAKDOWNS`). */
const CAUSES = { rules: true, kinds: true, details: true } as const;

/**
 * What a word kept for `shape`, `differs` or `moved` is set down to, from what the import said
 * as it ran (`ImportObserver`), changing nothing it did: for `shape`, the rule the outline the
 * checks left declined its candidate by (`Outline.declined`), `container` for one the probe found
 * holds structure, and `unknown candidate` for one it does not know; for `differs`, the kind of
 * difference check 1 found (`CheckEvent`); for `moved`, the probe's detail. Each is a name of a
 * closed list (`SHAPE_RULES`, `DIFFERENCE_KINDS`, `MOVED_DETAILS`), or `(other)`.
 */
export class Causes {
  private declined: ReadonlyMap<string, string> = new Map();
  private readonly differs = new Map<string, string>();

  /** The checks' events: check 1's kind of difference for each candidate it kept for `differs`. */
  readonly onCheck = (event: CheckEvent) => {
    if ("differs" in event) this.differs.set(event.differs, event.kind ?? "(none)");
  };

  /** The outline as the checks leave it, the rule behind each editable candidate it holds no field of. */
  readonly outlined = (outline: { declined: ReadonlyMap<string, string> }) => {
    this.declined = outline.declined;
  };

  /** The cause of a candidate kept for a reason, by the probe's candidates (`PiecesInput.cause`). */
  of(
    candidates: readonly Pick<ProbeCandidate, "id" | "verdict" | "detail">[],
  ): NonNullable<PiecesInput["cause"]> {
    const byId = new Map(candidates.map((each) => [each.id, each]));
    const closed = (list: readonly string[], name: string | undefined) =>
      name !== undefined && list.includes(name) ? name : "(other)";
    return (kept, id) => {
      const candidate = byId.get(id);
      if (kept === "moved") return closed(MOVED_DETAILS, candidate?.detail);
      if (kept === "differs") return closed(DIFFERENCE_KINDS, this.differs.get(id));
      if (candidate === undefined) return "unknown candidate";
      if (candidate.verdict === "container") return "container";
      return closed(Object.keys(SHAPE_RULES), this.declined.get(id));
    };
  }
}

/** Whether pieces add up to the report's words: the retype's, and the locked by reason. */
export function addsUp(pieces: readonly PieceWords[], words: Report["words"]): boolean {
  const retype = pieces.filter((each) => each.why === "retype");
  if (retype.reduce((sum, each) => sum + each.words, 0) !== words.retype) return false;
  const locked = pieces.filter((each) => each.why !== "retype");
  if (locked.reduce((sum, each) => sum + each.words, 0) !== words.locked) return false;
  const byReason = new Map<string, number>();
  for (const each of locked) byReason.set(each.why, (byReason.get(each.why) ?? 0) + each.words);
  const reasons = Object.entries(words.byReason).filter(([, n]) => (n ?? 0) > 0);
  return (
    reasons.length === byReason.size && reasons.every(([reason, n]) => byReason.get(reason) === n)
  );
}

// The compiles, by kind of trial.

/** The kind of trial a step's compiles are, where the step is not the checks'. */
const STEP_TRIALS: Partial<Record<ImportStep, TrialKind>> = {
  reference: "reference",
  fonts: "fonts",
  rewrite: "rewrite",
  signatures: "signatures",
  probe: "probe",
};

/**
 * What `TrialClock` comes to: compiles and milliseconds by kind of trial, the formats dumped and
 * the PDFs made, each counted and timed apart, and the budgets.
 */
export interface Trials {
  compiles: Partial<Record<TrialKind, number>>;
  ms: Partial<Record<TrialKind, number>>;
  dumps: { n: number; ms: number };
  pdfs: { n: number; ms: number };
  budgets: Omit<ImportBudgets, "probe">;
}

/**
 * Each compile of an import, timed as the session makes it and set down to its kind of trial: the
 * step it is in (`enter`), as the import's `onStep` says; in the checks, the phase they say
 * (`onCheck`). The session the import is given (`timed`) times each compile, dump and PDF, each
 * kind apart, and hands it on as it is: it changes nothing the import does.
 */
export class TrialClock {
  private step: ImportStep = "intake";
  private phase: CheckPhase | undefined;
  private readonly made: { kind: TrialKind; ms: number }[] = [];
  private readonly dumps = { n: 0, ms: 0 };
  private readonly pdfs = { n: 0, ms: 0 };
  private readonly budgets: Trials["budgets"] = {
    checks: { hits: 0, fields: 0 },
    units: { hits: 0, groups: 0 },
  };

  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** The import's step, as `onStep` hears it. */
  enter(step: ImportStep) {
    if (step === this.step) return;
    this.step = step;
    this.phase = undefined;
  }

  /** The checks' phases and budgets (`CheckEvent`), and nothing else they say. */
  readonly onCheck = (event: CheckEvent) => {
    if ("phase" in event) {
      this.phase = event.phase;
      return;
    }
    if (!("budget" in event)) return;
    if (event.budget === "check 3") {
      this.budgets.units.hits++;
      this.budgets.units.groups += event.left;
    } else {
      this.budgets.checks.hits++;
      this.budgets.checks.fields += event.left;
    }
  };

  /**
   * The session as the import is to compile on it: each compile, dump and PDF timed, each kind
   * apart, and everything else the session's own, as `watched` wraps one.
   */
  timed(session: EngineSession): EngineSession {
    const proxy = Object.create(session) as EngineSession;
    const timing =
      <A extends unknown[], R>(call: (...args: A) => R, done: (ms: number) => void) =>
      (...args: A): R => {
        const began = this.now();
        try {
          return call(...args);
        } finally {
          done(this.now() - began);
        }
      };
    proxy.compile = timing(session.compile.bind(session), (ms) => {
      const kind =
        this.step === "validate" ? (this.phase ?? "other") : (STEP_TRIALS[this.step] ?? "other");
      this.made.push({ kind, ms });
    });
    proxy.dump = timing(session.dump.bind(session), (ms) => {
      this.dumps.n++;
      this.dumps.ms += ms;
    });
    proxy.pdf = timing(session.pdf.bind(session), (ms) => {
      this.pdfs.n++;
      this.pdfs.ms += ms;
    });
    return proxy;
  }

  /**
   * The compiles by kind, the probe's last `bisection` of them its bisection's (`Probe.compiles`,
   * the compiles its candidates took, which come after the rest of its compiles), in milliseconds
   * rounded; the dumps and the PDFs; and the budgets.
   */
  result(bisection: number): Trials {
    const probes = this.made.filter((each) => each.kind === "probe");
    const split = new Set(probes.slice(Math.max(0, probes.length - bisection)));
    const compiles: Trials["compiles"] = {};
    const ms: Trials["ms"] = {};
    for (const each of this.made) {
      const kind: TrialKind = split.has(each) ? "probe bisection" : each.kind;
      compiles[kind] = (compiles[kind] ?? 0) + 1;
      ms[kind] = (ms[kind] ?? 0) + each.ms;
    }
    const order = <V>(record: Partial<Record<TrialKind, V>>, map: (value: V) => V) =>
      Object.fromEntries(
        TRIALS.flatMap((kind) => {
          const value = record[kind];
          return value === undefined ? [] : [[kind, map(value)]];
        }),
      ) as Partial<Record<TrialKind, V>>;
    return {
      compiles: order(compiles, (n) => n),
      ms: order(ms, (n) => Math.round(n)),
      dumps: { n: this.dumps.n, ms: Math.round(this.dumps.ms) },
      pdfs: { n: this.pdfs.n, ms: Math.round(this.pdfs.ms) },
      budgets: {
        checks: { ...this.budgets.checks },
        units: { ...this.budgets.units },
      },
    };
  }
}

// The tables per family.

/** How many pieces each family's table lists, the most words first. */
export const TOP_PIECES = 10;

/** A piece as a table shows it: its name, or a bucket, and an argument's place. */
function shownPiece(piece: string, arg: number | undefined): string {
  const name = PIECE_BUCKETS.includes(piece)
    ? piece
    : PIECE_NAME.test(piece)
      ? `\`${piece}\``
      : "(unnamed)";
  return arg === undefined || !Number.isInteger(arg) ? name : `${name} #${arg}`;
}

/** Why, as a table shows it: the retype and the reason kept, or the reason locked. */
function shownWhy(why: string, kept: string): string {
  const reason = (each: string) =>
    (LOCK_REASONS as readonly string[]).includes(each) ? each : "(unknown)";
  return why === "retype" ? `retype, kept: ${reason(kept)}` : reason(why);
}

/** The names each breakdown's table may show (`BREAKDOWNS`): its closed list and the buckets. */
const CAUSE_NAMES: Record<keyof typeof BREAKDOWNS, readonly string[]> = {
  shape: [...Object.keys(SHAPE_RULES), ...CAUSE_BUCKETS, "(other)"],
  differs: [...DIFFERENCE_KINDS, ...CAUSE_BUCKETS, "(other)"],
  moved: [...MOVED_DETAILS, ...CAUSE_BUCKETS, "(other)"],
};

/**
 * The words kept for `shape`, `differs` and `moved` of some rows, retyped or locked, by the rule,
 * kind or detail behind them (`PieceWords`): words, documents, and the piece holding the most of
 * them; the most words first within each reason. None where no row breaks them down.
 */
export function causeTable(rows: readonly ImportRow[]): string[] {
  const found = new Map<
    string,
    { kept: string; cause: string; words: number; ids: Set<string>; pieces: Map<string, number> }
  >();
  for (const row of rows)
    for (const each of row.pieces ?? []) {
      const reason = each.kept as keyof typeof BREAKDOWNS;
      const field = BREAKDOWNS[reason];
      if (field === undefined) continue;
      for (const [name, words] of Object.entries(each[field] ?? {})) {
        const cause = CAUSE_NAMES[reason].includes(name) ? name : "(unknown)";
        const key = `${reason}|${cause}`;
        const entry = found.get(key) ?? {
          kept: reason,
          cause,
          words: 0,
          ids: new Set<string>(),
          pieces: new Map<string, number>(),
        };
        entry.words += words;
        entry.ids.add(row.id);
        const piece = shownPiece(each.piece, each.arg);
        entry.pieces.set(piece, (entry.pieces.get(piece) ?? 0) + words);
        found.set(key, entry);
      }
    }
  if (found.size === 0) return [];
  const order = Object.keys(BREAKDOWNS);
  const ranked = [...found.values()].sort(
    (a, b) => order.indexOf(a.kept) - order.indexOf(b.kept) || b.words - a.words,
  );
  const largest = (pieces: ReadonlyMap<string, number>) => {
    let name = "";
    let most = 0;
    for (const [each, n] of pieces)
      if (n > most) {
        name = each;
        most = n;
      }
    return `${name}, ${most.toLocaleString("en-GB")}`;
  };
  return [
    "",
    "| Kept | Rule, kind or detail | Words | Documents | Largest piece |",
    "|---|---|--:|--:|---|",
    ...ranked.map(
      (each) =>
        `| ${each.kept} | ${each.cause} | ${each.words.toLocaleString("en-GB")} | ${each.ids.size} | ${largest(each.pieces)} |`,
    ),
  ];
}

/** Seconds, as a table shows them. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Per family and in all, of the documents imported: the pieces that hold the most words not in
 * place, with why and where it was decided, how many words and in how many documents; the
 * compiles and time by kind of trial, the dumps and the PDFs; how many rows have no pieces; and the
 * budgets that ran out. Names of pieces, reasons and numbers, never text.
 */
export function pieceTables(rows: readonly ImportRow[]): string {
  const lines: string[] = [];
  for (const family of [...FAMILIES, "all"] as const) {
    const of = rows.filter((row) => imported(row) && (family === "all" || row.family === family));
    const diagnosed = of.filter((row) => row.pieces !== undefined || row.compiles?.trials);
    if (diagnosed.length === 0) continue;
    const pieces = new Map<
      string,
      { piece: string; arg?: number; why: string; kept: string; by: string; words: number }
    >();
    const holders = new Map<string, Set<string>>();
    for (const row of of)
      for (const each of row.pieces ?? []) {
        const key = `${each.piece}|${each.arg ?? ""}|${each.why}|${each.kept}|${each.by}`;
        const entry = pieces.get(key) ?? { ...each, words: 0 };
        entry.words += each.words;
        pieces.set(key, entry);
        holders.set(key, (holders.get(key) ?? new Set()).add(row.id));
      }
    const ranked = [...pieces.entries()].sort(([, a], [, b]) => b.words - a.words);
    const shown = ranked.slice(0, TOP_PIECES);
    const rest = ranked.slice(TOP_PIECES);
    const notInPlace = ranked.reduce((sum, [, each]) => sum + each.words, 0);
    // A row whose pieces did not add up to its report's words keeps none, which is said.
    const without = of.filter((row) => row.pieces === undefined).length;
    lines.push(
      `**${family}**, ${of.length} imported: ${notInPlace.toLocaleString("en-GB")} words not in place, by the piece that holds them`,
      ...(without === 0
        ? []
        : [
            `${without} of the ${of.length} ${without === 1 ? "has" : "have"} no pieces, their words not set down to any, and ${without === 1 ? "its words are" : "theirs are"} not in the table.`,
          ]),
      "",
      "| Piece | Why | Decided by | Words | Documents |",
      "|---|---|---|--:|--:|",
      ...shown.map(
        ([key, each]) =>
          `| ${shownPiece(each.piece, each.arg)} | ${shownWhy(each.why, each.kept)} | ${(DECIDED as readonly string[]).includes(each.by) ? each.by : "(unknown)"} | ${each.words.toLocaleString("en-GB")} | ${holders.get(key)?.size ?? 0} |`,
      ),
      ...(rest.length === 0
        ? []
        : [
            `| ${rest.length} more | | | ${rest.reduce((sum, [, each]) => sum + each.words, 0).toLocaleString("en-GB")} | |`,
          ]),
      ...causeTable(of),
      "",
      "| Trial | Compiles | Time | Documents |",
      "|---|--:|--:|--:|",
    );
    for (const kind of TRIALS) {
      const with_ = of.filter((row) => (row.compiles?.trials?.[kind] ?? 0) > 0);
      if (with_.length === 0) continue;
      const n = with_.reduce((sum, row) => sum + (row.compiles?.trials?.[kind] ?? 0), 0);
      const ms = with_.reduce((sum, row) => sum + (row.times.trials?.[kind] ?? 0), 0);
      lines.push(`| ${kind} | ${n.toLocaleString("en-GB")} | ${seconds(ms)} | ${with_.length} |`);
    }
    const dumped = of.filter((row) => (row.compiles?.dumps ?? 0) > 0);
    if (dumped.length > 0)
      lines.push(
        `| dumps | ${dumped.reduce((sum, row) => sum + (row.compiles?.dumps ?? 0), 0).toLocaleString("en-GB")} | ${seconds(dumped.reduce((sum, row) => sum + (row.times.dumps ?? 0), 0))} | ${dumped.length} |`,
      );
    const pdfs = of.filter((row) => (row.compiles?.pdfs ?? 0) > 0);
    if (pdfs.length > 0)
      lines.push(
        `| PDFs | ${pdfs.reduce((sum, row) => sum + (row.compiles?.pdfs ?? 0), 0).toLocaleString("en-GB")} | ${seconds(pdfs.reduce((sum, row) => sum + (row.times.pdfs ?? 0), 0))} | ${pdfs.length} |`,
      );
    const ran = (pick: (budgets: ImportBudgets) => number) =>
      of.filter((row) => row.budgets !== undefined && pick(row.budgets) > 0).length;
    const total = (pick: (budgets: ImportBudgets) => number) =>
      of.reduce((sum, row) => sum + (row.budgets === undefined ? 0 : pick(row.budgets)), 0);
    lines.push(
      "",
      `Budgets that ran out: the probe's in ${ran((b) => b.probe.hits)} documents (${total((b) => b.probe.fields)} candidates untested); the checks' bisections ${total((b) => b.checks.hits)} times in ${ran((b) => b.checks.hits)} documents (${total((b) => b.checks.fields)} fields kept untried); check 3's in ${ran((b) => b.units.hits)} documents (${total((b) => b.units.groups)} groups untried).`,
      "",
    );
  }
  return `${lines.map(printable).join("\n")}`;
}
