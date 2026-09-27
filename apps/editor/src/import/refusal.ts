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
 * A font's name as a message shows it (decision 0023): the name the document gave it, a backslash
 * before any other character than a letter taken off, as `Invented\ Sans` is `Invented Sans`; or
 * undefined for a name only TeX could read, one that holds a command, a parameter or a group, as
 * `\headfont` or `#1`, or none at all, which a message calls a font set by a command.
 */
export function plainFontName(name: string): string | undefined {
  if (/\\[A-Za-z@]/.test(name)) return undefined;
  const plain = shownInMessage(name.replace(/\\([^A-Za-z@])/g, "$1"));
  return plain === "" || /[\\{}#$%^~]/.test(plain) ? undefined : plain;
}

/**
 * What the XeTeX rewrite of a resume's fonts cannot reproduce (decision 0023), as its refusal
 * names it: one of fontspec's options by its key alone, never its value, as `Scale`; a command
 * that sets fonts, by its name, as `\addfontfeatures`; a package that needs fontspec itself, as
 * polyglossia; or a document whose main file does not itself begin the document or load its class.
 */
export type Unreproduced =
  | { option: string }
  | { command: string }
  | { package: string }
  | { document: "begin" | "class" };

/**
 * A refusal for what the XeTeX rewrite cannot reproduce, `feature`, whose message names it in
 * plain words, never as source: an option by its key, or as one a command gives when the key is
 * not a plain word; a command by its name without the backslash, as the font command
 * addfontfeatures; a package by its name. `name` keeps what the refusal names for developers.
 */
export function unreproduced(what: Unreproduced, log?: string): Refusal {
  const word = (text: string) => (/^[A-Za-z][A-Za-z0-9]*$/.test(text) ? text : undefined);
  let message: string;
  let name: string;
  if ("option" in what) {
    name = what.option;
    const key = word(what.option);
    message =
      key === undefined
        ? "This resume sets its fonts with options a command gives, which this editor cannot reproduce."
        : `This resume sets its fonts with the font option ${key}, which this editor cannot reproduce.`;
  } else if ("command" in what) {
    name = what.command;
    const command = word(what.command.replace(/^\\/, ""));
    message =
      command === undefined
        ? "This resume sets its fonts with a font command this editor cannot reproduce."
        : `This resume sets its fonts with the font command ${command}, which this editor cannot reproduce.`;
  } else if ("package" in what) {
    name = what.package;
    message = `This resume sets its fonts with the package ${shownInMessage(what.package)}, which this editor cannot reproduce.`;
  } else {
    name = what.document === "begin" ? "document" : "documentclass";
    message =
      what.document === "begin"
        ? "This resume begins its document in another file than its main one, so this editor cannot rewrite its fonts."
        : "This resume loads its template from another file than its main one, so this editor cannot rewrite its fonts.";
  }
  return { refused: true, reason: "feature", message, name, ...(log === undefined ? {} : { log }) };
}

/**
 * A refusal for a reason, with the message a person reads, which names `name` where the reason is
 * a missing thing. A missing file is the upload's when it is a source, a `.tex` or a name with no
 * extension, and the editor's otherwise. A font is named as the document named it when that is a
 * plain name (`plainFontName`), and otherwise called a font set by a command; a feature, by its key
 * (`unreproduced` names commands and packages too).
 */
export function refusal(reason: RefusalReason, name?: string, log?: string): Refusal {
  if (reason === "feature") return unreproduced({ option: name ?? "" }, log);
  const shown = name === undefined ? "" : shownInMessage(name);
  const font = name === undefined ? undefined : plainFontName(name);
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
  const messages: Record<Exclude<RefusalReason, "feature">, string> = {
    intake: "This upload cannot be taken as a resume.",
    luatex: "This resume needs LuaTeX, which this editor does not have.",
    class: `This resume needs the template ${shown}, which this editor does not have.`,
    package: `This resume needs the package ${shown}, which this editor does not have.`,
    font:
      font === undefined
        ? "This resume needs a font set by a command, which this editor cannot reproduce."
        : `This resume needs the font ${font}, which this editor does not have.`,
    file: /\.tex$|^[^.]*$/i.test(shown)
      ? `This resume needs the file ${shown}, which is not in the upload.`
      : `This resume needs the file ${shown}, which this editor does not have.`,
    image: `This resume shows the image ${shown}, in a format this editor does not take: it takes PNG, JPEG and PDF images.`,
    stopped: "This resume could not be compiled by this editor.",
    passes:
      "This resume came out differently every time it was compiled, so this editor cannot take it.",
    timeout: "This resume took too long to compile.",
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
