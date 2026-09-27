/**
 * Why the import pipeline takes a resume no further, in words a person reads (decision 0019).
 *
 * A refusal names the thing that stopped it, a template, a package, a font, a file or LuaTeX, and
 * never a line of source: a person who uploads a resume never sees LaTeX (AGENTS.md). The compile's
 * log, which quotes the source, rides along for developers, in the result and on the console, and
 * never in a message.
 */

/**
 * Why a resume was refused: at intake, for its size, its files or its engine (`intake`, `luatex`);
 * or by the reference compile, for a template, package, font or file the editor or the upload
 * lacks, an image it shows in a format with no stand-in (`image`), another error (`stopped`), or
 * output that changed on every pass (`passes`); by the corpus runner, for a compile past its
 * time (`timeout`); or by the XeTeX rewrite of its fonts (decision 0023), for a fontspec feature or
 * package the rewrite cannot reproduce (`feature`), or fonts that come out otherwise than the
 * reference's (`difference`).
 */
export const REFUSAL_REASONS = [
  "intake",
  "luatex",
  "class",
  "package",
  "font",
  "file",
  "image",
  "stopped",
  "passes",
  "timeout",
  "feature",
  "difference",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export interface Refusal {
  refused: true;
  reason: RefusalReason;
  /** What a person reads: plain English that names the thing, never a line of source. */
  message: string;
  /** The template, package, font or file that is missing, as the log names it. */
  name?: string;
  /** The compile's log, for developers only: it quotes the source. */
  log?: string;
}

/** The longest name a message shows; a longer one is cut, with an ellipsis. */
const MAX_NAME = 80;

/**
 * A name as a message shows it: its control characters out, so that it stays one line, and no
 * longer than MAX_NAME characters.
 */
export function shownInMessage(name: string): string {
  const plain = name.replace(/\p{Cc}/gu, "").trim();
  return plain.length > MAX_NAME ? `${plain.slice(0, MAX_NAME - 1)}…` : plain;
}

/**
 * A refusal for a reason, with the message a person reads, which names `name` where the reason is
 * a missing thing. A missing file is the upload's when it is a source, a `.tex` or a name with no
 * extension, and the editor's otherwise.
 */
export function refusal(reason: RefusalReason, name?: string, log?: string): Refusal {
  const shown = name === undefined ? "" : shownInMessage(name);
  // A class, package or file named by a path out of the main file's folder: the engine reads only
  // inside it, and the upload's file there is not where the document looks.
  if (
    name !== undefined &&
    (reason === "class" || reason === "package" || reason === "file") &&
    (name.startsWith("/") || name.split("/").includes(".."))
  )
    return {
      refused: true,
      reason,
      message: `This resume loads ${shown} from outside its own folder, which this editor cannot reach.`,
      name,
      ...(log === undefined ? {} : { log }),
    };
  const messages: Record<RefusalReason, string> = {
    intake: "This upload cannot be taken as a resume.",
    luatex: "This resume needs LuaTeX, which this editor does not have.",
    class: `This resume needs the template ${shown}, which this editor does not have.`,
    package: `This resume needs the package ${shown}, which this editor does not have.`,
    font: `This resume needs the font ${shown}, which this editor does not have.`,
    file: /\.tex$|^[^.]*$/i.test(shown)
      ? `This resume needs the file ${shown}, which is not in the upload.`
      : `This resume needs the file ${shown}, which this editor does not have.`,
    image: `This resume shows the image ${shown}, in a format this editor does not take: it takes PNG, JPEG and PDF images.`,
    stopped: "This resume could not be compiled by this editor.",
    passes:
      "This resume came out differently every time it was compiled, so this editor cannot take it.",
    timeout: "This resume took too long to compile.",
    feature: `This resume sets its fonts with ${shown}, which this editor cannot reproduce.`,
    difference: `This editor sets this resume's font ${shown} otherwise than the resume does, so it cannot take it.`,
  };
  return {
    refused: true,
    reason,
    message: messages[reason],
    ...(name === undefined ? {} : { name }),
    ...(log === undefined ? {} : { log }),
  };
}

/**
 * A refusal at intake with its own message, which names the upload's file when one is at fault,
 * and that file's name for developers.
 */
export const refusedAtIntake = (message: string, name?: string): Refusal => ({
  refused: true,
  reason: "intake",
  message,
  ...(name === undefined ? {} : { name }),
});

/** Whether a result is a refusal. */
export const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && (value as { refused?: unknown }).refused === true;
