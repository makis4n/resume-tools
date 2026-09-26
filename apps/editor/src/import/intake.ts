/**
 * The import pipeline's first step (milestone 3 item 3, plan section 6 step 1, decision 0019): an
 * upload, one `.tex` file or a zip of a resume's files, becomes the files of a job the engine can
 * compile, or a refusal that says why in plain English.
 *
 * A zip is unpacked with fflate, within caps on the zip, its entries, each file, the text files and
 * the fonts together, and all of it together (`CAPS`), and refused whole for a name that is not a
 * safe relative path (`paths.ts`).
 * Its main file is the `.tex` that starts a document with `\documentclass` and that no other
 * `.tex` inputs; none, or more than one, is refused, and so is LaTeX 2.09's `\documentstyle`. Its
 * text files are read as UTF-8, or as Latin-1 when their bytes are not UTF-8, and the job gets
 * their bytes as they are, but for the two edits below.
 *
 * The job is the main file's folder: each file there or below keeps its path from it, as TeX's
 * working folder is the main file's; each file elsewhere keeps its path from the top of the
 * upload, a zip's one wrapping folder aside, where a template such as Awesome-CV keeps its class
 * and fonts beside an `examples/` folder; and a class or package the document loads that the upload
 * holds anywhere else is put where TeX finds it, beside the main file, as the corpus's survey takes
 * one (decision 0017). A path the main file or a file it inputs names above its folder, `../img/`,
 * is rewritten to the path the job holds that file at, and `\pdfoutput=1` to `\pdfoutput=0`, since
 * the editor's pdfTeX writes DVI; each with a warning.
 *
 * The engine is read from the source as the survey reads it (`source.ts`): LuaTeX is refused, XeTeX
 * is XeTeX, and pdfTeX or either is pdfTeX. Fonts the upload ships go into the job for the
 * reference compile alone, and are named for item 8. Images never do (decision 0008): each PNG,
 * JPEG and PDF becomes a blank stand-in of the same size (`images.ts`), with a `.xbb` for pdfTeX
 * for each name graphicx sizes by, and so does each file `\includegraphics` names that the upload
 * lacks, of the tree's image's size when the tree has one and 1 by 1 otherwise; every other image
 * is dropped, and the result names each. The upload's images are read within one budget
 * (`UPLOAD_BUDGET`), past which the rest are dropped, with one warning; a PDF whose page's size
 * cannot be read is dropped with a warning that names it.
 *
 * It is a function of the upload's bytes, and of the tree when it is given the tree's, and runs in
 * the browser and in Node alike. Each reader of the source runs once for each text it reads.
 */

import { unzipSync } from "fflate";
import type { Engine } from "../engine/session";
import type { Tree } from "./fonts";
import {
  type ImageInfo,
  imageInfo,
  MAX_SIDE,
  ONE_BY_ONE,
  ONE_POINT_PDF,
  standIn,
  tooLarge,
  uploadBudget,
  xbb,
} from "./images";
import { extensionOf, folderOf, isSafePath, joinPath, nameOf, withoutExtension } from "./paths";
import { type Refusal, refusal, refusedAtIntake, shownInMessage } from "./refusal";
import {
  classOptions,
  engineFrom,
  graphicsNames,
  graphicsPaths,
  holdsDocumentClass,
  holdsDocumentStyle,
  optionValues,
  pathsAbove,
  pdfOutputSettings,
  type Reading,
  type Reference,
  readSource,
  references,
  type SourceEngine,
  viewNeeds,
} from "./source";

/** What a person uploads: one `.tex` file, or a zip of a resume's files, and its name. */
export interface Upload {
  name: string;
  bytes: Uint8Array;
}

export interface IntakeOptions {
  /**
   * The engine's tree, which says whether a package a source loads only if it is present
   * (`\IfFileExists`) is there. Without it, only the upload's own files count as present.
   */
  tree?: Tree;
  /**
   * An image of the tree by the name graphicx would find it under, as a class keeps its logos
   * there, or undefined when the tree has none (`treeImages`). A stand-in of its size takes its
   * place, as one does an upload's image's; without this, a name the upload lacks gets a 1 by 1
   * stand-in whatever the tree holds.
   */
  treeImage?: (name: string) => Uint8Array | undefined;
}

/** An image the intake stood in for, and where its stand-in is in the job. */
export interface StandIn {
  /** The image as the upload has it, or as `\includegraphics` names it when the upload lacks it. */
  name: string;
  /** Where its stand-in is in the job: what `session.pdf` may take as an image (decision 0019). */
  path: string;
  /** The image the stand-in takes the place of: a PNG, a JPEG or a PDF. */
  kind: "png" | "jpeg" | "pdf";
  /** True when the upload lacks the image, and the stand-in is 1 by 1. */
  missing?: true;
  /** True when the image is the tree's, as a class's logo is, and the stand-in is of its size. */
  tree?: true;
}

/**
 * An image the intake dropped, and why: a format it has no stand-in for (`format`); bytes it
 * cannot read as the image its name says, more pixels on a side than it stands in for, or an image
 * past the upload's budget for reading them (`unreadable`); a name outside the job (`outside`); or
 * an image at the same path in the job as one beside the main file, which comes first
 * (`duplicate`).
 */
export interface Dropped {
  name: string;
  why: "format" | "unreadable" | "outside" | "duplicate";
  /**
   * Where it would be in the job, for one the upload holds that is not there: the reference compile
   * refuses a document that shows one in a format it has no stand-in for (decision 0019).
   */
  path?: string;
}

export interface Intake {
  /** The engine the reference compile runs: XeTeX when the source needs it, pdfTeX otherwise. */
  engine: Engine;
  /** What the source asks for (`engineFrom`), which chose the engine. */
  source: Exclude<SourceEngine, "luatex">;
  /**
   * The main file: its path in the upload, its text for reading, and its bytes for the engine, as
   * the job has them, its paths above its folder and `\pdfoutput` rewritten.
   */
  main: { path: string; text: string; bytes: Uint8Array };
  /** Every file of the job, by its path in the job, but the main file, which is the compile's body. */
  files: Record<string, Uint8Array>;
  /** The fonts the upload ships, by their paths in the job, for the reference compile alone. */
  fonts: string[];
  /** The images stood in for, and those dropped. */
  images: { replaced: StandIn[]; dropped: Dropped[] };
  /** What a developer, or the report, may want to know: plain English, naming files at most. */
  warnings: string[];
}

const MB = 1_000_000;

/** The caps on an upload (decision 0019). */
export const CAPS = {
  /** A zip's own size. */
  zipBytes: 20 * MB,
  /** Its entries, folders among them. */
  entries: 400,
  /** Any one file, unpacked. */
  fileBytes: 10 * MB,
  /** The text files together, unpacked. */
  textBytes: 5 * MB,
  /** The fonts together, unpacked. */
  fontBytes: 30 * MB,
  /**
   * Everything unpacked together: a zip's entries can say they unpack to a thousand times their
   * size, so the other caps alone would let 20 MB of zip unpack to gigabytes of images.
   */
  unpackedBytes: 100 * MB,
} as const;

/** Text files, read for what they load and ask of the engine, and put in the job as they are. */
export const TEXT_EXTENSIONS: readonly string[] = [
  ...[".tex", ".cls", ".sty", ".def", ".clo", ".fd", ".bib", ".bst", ".ldf", ".cfg", ".lco"],
];

/** Fonts, which go into the job for the reference compile alone (decision 0014). */
export const FONT_EXTENSIONS: readonly string[] = [".otf", ".ttf", ".pfb", ".afm", ".tfm"];

/** Images a blank stand-in of the same size takes the place of. */
export const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".pdf"];

/** Images of other formats, which are dropped and named. */
const OTHER_IMAGE_EXTENSIONS: readonly string[] = [
  ...[".eps", ".ps", ".svg", ".gif", ".bmp", ".tif", ".tiff", ".ai", ".jp2", ".jpf", ".jpx"],
  ...[".webp", ".heic", ".heif", ".avif", ".mps", ".emf", ".wmf", ".ico", ".xbm", ".pnm"],
];

/** Whether a name's extension is of a format the intake drops. */
export const isDroppedFormat = (name: string) => OTHER_IMAGE_EXTENSIONS.includes(extensionOf(name));

/**
 * The extensions graphicx tries, in its order, for a name `\includegraphics` gives without one:
 * `dvipdfmx.def`'s and `xetex.def`'s, which are the same (checked).
 */
export const DRIVER_EXTENSIONS: readonly string[] = [
  ...[".pdf", ".PDF", ".ai", ".AI", ".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG"],
  ...[".jp2", ".JP2", ".jpf", ".JPF", ".bmp", ".BMP", ".ps", ".PS", ".eps", ".EPS"],
  ...[".mps", ".MPS"],
];

/** Of DRIVER_EXTENSIONS, those a stand-in can be, in graphicx's order. */
const STAND_IN_TRIES = DRIVER_EXTENSIONS.filter((each) =>
  IMAGE_EXTENSIONS.includes(each.toLowerCase()),
);

/**
 * Of images of one name but for their extensions, in one folder, the one graphicx takes for the
 * name without an extension: the first in the drivers' order, the extension's case counting as
 * it does to them; one of an extension they do not try comes after the rest.
 */
export function pickedImage(paths: readonly string[]): string | undefined {
  const rank = (path: string) => {
    const at = DRIVER_EXTENSIONS.indexOf(path.slice(withoutExtension(path).length));
    return at < 0 ? DRIVER_EXTENSIONS.length : at;
  };
  return [...paths].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/**
 * Of images of one name but for their extensions, in one folder, the one whose size pdfTeX's
 * graphicx reads for every one of them, from the name's `.xbb`: of those the job has an image of,
 * the upload's or the tree's, the one graphicx takes (`pickedImage`); a stand-in for a name the
 * upload lacks (`lacked`) only when every one is such a stand-in, whatever the drivers' order says,
 * since its 1 by 1 is a guess and an image's size is not.
 */
export function sizedImage(
  paths: readonly string[],
  lacked: (path: string) => boolean,
): string | undefined {
  return pickedImage(paths.filter((path) => !lacked(path))) ?? pickedImage(paths);
}

type Kind = "text" | "bbl" | "font" | "image" | "other-image";

/** What a file of the upload is by its extension, or undefined for one the job does not need. */
function kindOf(path: string): Kind | undefined {
  const extension = extensionOf(path);
  if (TEXT_EXTENSIONS.includes(extension)) return "text";
  if (extension === ".bbl") return "bbl";
  if (FONT_EXTENSIONS.includes(extension)) return "font";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  if (OTHER_IMAGE_EXTENSIONS.includes(extension)) return "other-image";
  return undefined;
}

/**
 * Whether a file is one no document reads: a dot file, which TeX may not open, and what macOS and
 * Windows put in a zip beside a folder's files. A file in a dot folder may be a document's, as one
 * kept in `.overleaf-repo/` is, and goes into the job when the folder is above the main file's.
 */
const isJunk = (path: string) => {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  return (
    name.startsWith(".") ||
    name === "Thumbs.db" ||
    name === "desktop.ini" ||
    parts.includes("__MACOSX")
  );
};

/** Whether a path may be one in the job: no part of it a dot file or dot folder (`isJobPath`). */
const inJob = (path: string) => path.split("/").every((part) => !part.startsWith("."));

/** A file of the upload: its path from the upload's top, its kind and its bytes. */
interface Entry {
  path: string;
  kind: Kind;
  bytes: Uint8Array;
}

/** Thrown out of fflate's filter to stop unpacking at a cap; the refusal is kept beside it. */
const STOP = new Error("the upload was refused while it was unpacked");

/**
 * Take an upload in: unpack it, find its main file, lay out its job, edit its sources' paths above
 * its folder and its PDF mode, read its engine, and stand in for its images; or refuse it, saying
 * why.
 */
export function intake(upload: Upload, options: IntakeOptions = {}): Intake | Refusal {
  const unpacked = unpack(upload);
  if ("refused" in unpacked) return unpacked;
  const { entries, droppedFormats } = unpacked;
  const referencesOf = once(references);

  const texts = new Map<string, string>();
  for (const entry of entries)
    if (entry.kind === "text") texts.set(entry.path, decodeText(entry.bytes));
  const main = mainFile(entries, texts, referencesOf);
  if ("refused" in main) return main;

  const job = layOut(entries, main.path);
  const images = placeImages(job, entries, main.path, droppedFormats);
  const edit = editor(job, main.path);
  const edited = edit(main.path, texts.get(main.path) ?? "", main.bytes);
  const mainText = edited.text;
  const reached = reachable(mainText, job, entries, referencesOf, (path, text) => {
    const bytes = job.files[path];
    if (bytes === undefined) return text;
    const done = edit(path, text, bytes);
    job.files[path] = done.bytes;
    return done.text;
  });
  const read = [{ path: "", text: mainText }, ...reached]
    .filter((file) => extensionOf(file.path) !== ".bib")
    .map((file) => ({ ...file, isClass: extensionOf(file.path) === ".cls" }));
  const known = optionValues(read, classOptions(mainText));
  const readings = read.map((file) => ({ ...file, reading: readSource(file.text, known) }));
  const present = (name: string) =>
    job.files[`${name}.sty`] !== undefined || options.tree?.styles.has(`${name}.sty`) === true;
  const needsOf = (view: (reading: Reading) => string) => {
    const views = readings.map((file) => view(file.reading));
    return viewNeeds(views, loadedPackages(views, present, referencesOf));
  };
  const source = engineFrom(
    needsOf((reading) => reading.pdftex),
    needsOf((reading) => reading.xetex),
    readings.some((file) => file.reading.guarded),
  );
  if (source === "luatex") return refusal("luatex");
  const engine: Engine = source === "xetex" ? "xetex" : "pdftex";

  const views = readings.map((file) =>
    engine === "xetex" ? file.reading.xetex : file.reading.pdftex,
  );
  const folders = [
    "",
    ...views
      .flatMap(graphicsPaths)
      .flatMap((each) => joinPath("", each.replace(/^(\.\/)+/, "")) ?? []),
  ];
  const named = [...new Set(views.flatMap(graphicsNames))];
  standInNamed(job, images, named, folders, options.treeImage);
  if (engine === "pdftex") boundingBoxes(job, images, named, folders);
  return {
    engine,
    source,
    main: { path: main.path, text: mainText, bytes: edited.bytes },
    files: job.files,
    fonts: job.fonts,
    images: { replaced: images.replaced, dropped: images.dropped },
    warnings: job.warnings,
  };
}

/** A reader of text that reads each text once, however many times it is asked for it. */
function once<T>(read: (text: string) => T): (text: string) => T {
  const done = new Map<string, T>();
  return (text) => {
    const found = done.get(text);
    if (found !== undefined) return found;
    const result = read(text);
    done.set(text, result);
    return result;
  };
}

/** A text file's bytes as text, for reading: UTF-8, or Latin-1 when the bytes are not UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let text = "";
    for (let at = 0; at < bytes.length; at += 8192)
      text += String.fromCharCode(...bytes.subarray(at, at + 8192));
    return text;
  }
}

/**
 * A text as bytes the way `original` was: UTF-8, its byte-order mark kept, when `original` is
 * UTF-8, and Latin-1 otherwise; undefined when the text holds a character Latin-1 cannot.
 */
export function encodeLike(original: Uint8Array, text: string): Uint8Array | undefined {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(original);
  } catch {
    const bytes = new Uint8Array(text.length);
    for (let at = 0; at < text.length; at++) {
      const code = text.charCodeAt(at);
      if (code > 0xff) return undefined;
      bytes[at] = code;
    }
    return bytes;
  }
  const encoded = new TextEncoder().encode(text);
  const marked = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf;
  return marked ? new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]) : encoded;
}

// Unpacking.

/**
 * The upload's files, by their paths from its top, a zip's one wrapping folder aside, with the
 * images of other formats named apart; or a refusal for a cap, a name, or bytes that are neither a
 * `.tex` file nor a zip.
 */
function unpack(upload: Upload): { entries: Entry[]; droppedFormats: string[] } | Refusal {
  const extension = extensionOf(upload.name);
  const isZip =
    extension === ".zip" ||
    (upload.bytes[0] === 0x50 && upload.bytes[1] === 0x4b && extension !== ".tex");
  if (!isZip) {
    if (extension !== ".tex")
      return refusedAtIntake("Upload a .tex file, or a zip of your resume's files.");
    if (upload.bytes.length > CAPS.fileBytes || upload.bytes.length > CAPS.textBytes)
      return refusedAtIntake(`This file is larger than ${CAPS.textBytes / MB} MB.`);
    const name = nameOf(upload.name);
    const path = isSafePath(name) && !isJunk(name) ? name : "resume.tex";
    return { entries: [{ path, kind: "text", bytes: upload.bytes }], droppedFormats: [] };
  }
  if (upload.bytes.length > CAPS.zipBytes)
    return refusedAtIntake(`This zip is larger than ${CAPS.zipBytes / MB} MB.`);

  let refused: Refusal | undefined;
  const stop = (message: string): never => {
    refused = refusedAtIntake(message);
    throw STOP;
  };
  let count = 0;
  const names: string[] = [];
  const seen = new Set<string>();
  const kinds = new Map<string, Kind>();
  const droppedNames: string[] = [];
  let text = 0;
  let fonts = 0;
  let total = 0;
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(upload.bytes, {
      filter(file) {
        if (++count > CAPS.entries) stop(`This zip holds more than ${CAPS.entries} files.`);
        if (file.name.endsWith("/")) return false;
        const shown = shownInMessage(file.name);
        if (!isSafePath(file.name)) stop(`This zip holds a file whose name is not safe: ${shown}.`);
        if (seen.has(file.name)) stop(`This zip holds two files named ${shown}.`);
        seen.add(file.name);
        if (isJunk(file.name)) return false;
        names.push(file.name);
        const kind = kindOf(file.name);
        if (kind === undefined) return false;
        if (kind === "other-image") {
          droppedNames.push(file.name);
          return false;
        }
        // A stored file is its compressed size; a deflated one unpacks to no more than it says.
        const size = file.compression === 0 ? file.size : file.originalSize;
        if (size > CAPS.fileBytes)
          stop(`The file ${shown} in this zip is larger than ${CAPS.fileBytes / MB} MB.`);
        if (kind === "text" && (text += size) > CAPS.textBytes)
          stop(`The text files in this zip are larger than ${CAPS.textBytes / MB} MB together.`);
        if (kind === "font" && (fonts += size) > CAPS.fontBytes)
          stop(`The fonts in this zip are larger than ${CAPS.fontBytes / MB} MB together.`);
        if ((total += size) > CAPS.unpackedBytes)
          stop(`This zip unpacks to more than ${CAPS.unpackedBytes / MB} MB.`);
        kinds.set(file.name, kind);
        return true;
      },
    });
  } catch (error) {
    if (error === STOP && refused) return refused;
    return refusedAtIntake("This zip cannot be opened.");
  }
  const top = wrapper(names);
  const entries: Entry[] = [];
  for (const [name, bytes] of Object.entries(unpacked)) {
    const kind = kinds.get(name);
    if (kind !== undefined) entries.push({ path: name.slice(top.length), kind, bytes });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, droppedFormats: droppedNames.map((name) => name.slice(top.length)) };
}

/**
 * The folders every file of a zip is in, as `resume-main/` wraps what GitHub zips, with its slash;
 * "" when the files are not all in one.
 */
function wrapper(names: readonly string[]): string {
  let top = "";
  for (;;) {
    const rest = names.map((name) => name.slice(top.length));
    const first = rest[0]?.split("/")[0];
    if (first === undefined || !rest.every((name) => name.startsWith(`${first}/`))) return top;
    top += `${first}/`;
  }
}

// The main file.

/**
 * The `.tex` of the upload that starts a document, `\documentclass`, and that no other `.tex`
 * inputs; a refusal when there is none, when there is more than one, or when the one holds LaTeX
 * 2.09's `\documentstyle` alone.
 */
function mainFile(
  entries: readonly Entry[],
  texts: ReadonlyMap<string, string>,
  referencesOf: (text: string) => Reference[],
): Entry | Refusal {
  const sources = entries.filter((entry) => extensionOf(entry.path) === ".tex");
  const inputted = new Set<string>();
  for (const source of sources)
    for (const reference of referencesOf(texts.get(source.path) ?? "")) {
      if (reference.kind !== "input") continue;
      const name = extensionOf(reference.name) === "" ? `${reference.name}.tex` : reference.name;
      for (const folder of [folderOf(source.path), ""]) {
        const path = joinPath(folder, name);
        if (path !== undefined && path !== source.path) inputted.add(path);
      }
    }
  const starts = sources.filter((source) => {
    const text = texts.get(source.path) ?? "";
    return !inputted.has(source.path) && (holdsDocumentClass(text) || holdsDocumentStyle(text));
  });
  const [main, ...others] = starts;
  if (main === undefined)
    return refusedAtIntake(
      "This upload holds no LaTeX document: none of its .tex files starts one. Upload the file your resume is compiled from, or a zip that holds it.",
    );
  if (others.length > 0) {
    const listed = starts.slice(0, 5).map((entry) => shownInMessage(entry.path));
    return refusedAtIntake(
      `This upload holds more than one document: ${listed.join(", ")}${starts.length > 5 ? " and more" : ""}. Upload one resume at a time.`,
    );
  }
  if (!holdsDocumentClass(texts.get(main.path) ?? ""))
    return refusedAtIntake(
      "This resume is written for LaTeX 2.09, from before 1994, which is too old for this editor.",
    );
  return main;
}

// The job.

interface Job {
  files: Record<string, Uint8Array>;
  /** The upload's path of each file of the job that is one of the upload's, or a stand-in of one. */
  source: Map<string, string>;
  fonts: string[];
  warnings: string[];
  /** The main file's folder in the upload, "" at its top. */
  folder: string;
}

/** A path of the upload as a path of the job: from the main file's folder when it is there. */
const jobPathOf = (folder: string, path: string) =>
  folder !== "" && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;

/** Whether a path of the upload is in the main file's folder, or below it. */
const insideOf = (folder: string, path: string) => folder === "" || path.startsWith(`${folder}/`);

/**
 * The job's files but for its stand-ins: each text file, bibliography and font at its path from
 * the main file's folder when it is there or below, and at its path from the upload's top
 * otherwise, unless a file of the main file's folder is there already; not the main file itself,
 * which the compile is given as its body, and no image.
 */
function layOut(entries: readonly Entry[], main: string): Job {
  const folder = folderOf(main);
  const job: Job = { files: {}, source: new Map(), fonts: [], warnings: [], folder };
  const place = (entry: Entry, path: string) => {
    if (!inJob(path)) return;
    job.files[path] = entry.bytes;
    job.source.set(path, entry.path);
    if (entry.kind === "font") job.fonts.push(path);
  };
  const kept = entries.filter((entry) => entry.kind !== "image" && entry.path !== main);
  for (const entry of kept)
    if (insideOf(folder, entry.path)) place(entry, jobPathOf(folder, entry.path));
  for (const entry of kept) {
    if (insideOf(folder, entry.path)) continue;
    if (job.files[entry.path] === undefined) place(entry, entry.path);
    else
      job.warnings.push(
        `${shownInMessage(entry.path)} is left out: a file of the same path beside the main file comes first.`,
      );
  }
  return job;
}

/** A text file of the job as text. */
const jobText = (files: Readonly<Record<string, Uint8Array>>, path: string) => {
  const bytes = files[path];
  return bytes === undefined ? "" : decodeText(bytes);
};

/**
 * What edits a source of the main file's, the main file or a file it inputs, into what the job
 * compiles, with a warning for each edit, once: a path it names above the main file's folder, in
 * `pathsAbove`' commands, becomes the path the job holds that file or folder at, as its path
 * from the upload's top, since TeX reads nothing above its folder; unless the job holds another
 * of the upload's files there, or the path leaves the upload. A path that names nothing is
 * rewritten too, and is missing as any other. And `\pdfoutput` set above 0 is set to 0: the
 * editor's pdfTeX writes DVI (decision 0003), which a document written for PDF mode ships as any.
 */
function editor(
  job: Job,
  main: string,
): (path: string, text: string, bytes: Uint8Array) => { text: string; bytes: Uint8Array } {
  const warned = new Set<string>();
  const warn = (warning: string) => {
    if (!warned.has(warning)) job.warnings.push(warning);
    warned.add(warning);
  };
  /** Whether the job's files at a path, or in a folder, are the upload's of `upload` there. */
  const holdsOnly = (upload: string, path: string, folder: boolean) => {
    for (const [at, from] of job.source)
      if (folder) {
        if (at.startsWith(`${path}/`) && !from.startsWith(`${upload}/`)) return false;
      } else if (
        (at === path || at.startsWith(`${path}.`)) &&
        from !== upload + at.slice(path.length)
      )
        return false;
    return true;
  };
  const rewrite = (given: string, folder: boolean): string | undefined => {
    const relative = given.replace(/^(?:\.\/)+/, "");
    if (!relative.startsWith("../")) return undefined;
    const upload = joinPath(job.folder, relative);
    if (upload === undefined) return undefined;
    const path = jobPathOf(job.folder, upload);
    if (!holdsOnly(upload, path, folder)) return undefined;
    return folder && given.endsWith("/") ? `${path}/` : path;
  };
  return (path, text, bytes) => {
    const edits: { start: number; end: number; to: string }[] = [];
    for (const argument of pathsAbove(text)) {
      const to = rewrite(argument.path, argument.folder);
      if (to === undefined) continue;
      edits.push({ start: argument.start, end: argument.end, to });
      warn(
        `${shownInMessage(argument.path)} is read as ${shownInMessage(to)}, the upload's path it names: this editor reads nothing above the main file's folder.`,
      );
    }
    const settings = pdfOutputSettings(text);
    for (const { start, end } of settings) edits.push({ start, end, to: "\\pdfoutput=0" });
    if (settings.length > 0)
      warn(
        `${shownInMessage(path)} asks for PDF output, which this editor makes from DVI: it is compiled for DVI.`,
      );
    if (edits.length === 0) return { text, bytes };
    edits.sort((a, b) => a.start - b.start);
    let out = "";
    let at = 0;
    for (const { start, end, to } of edits) {
      if (start < at) continue;
      out += text.slice(at, start) + to;
      at = end;
    }
    out += text.slice(at);
    const encoded = encodeLike(bytes, out);
    return encoded === undefined ? { text, bytes } : { text: out, bytes: encoded };
  };
}

/**
 * The text files of the job the main file loads, followed as far as they go, in the order they are
 * reached, with their text as the job has it: classes and packages beside the main file or at the
 * path they are named by, and sources at the path they are named by, from the main file's folder,
 * TeX's working folder, or from the caller's for `\subimport`, each source `edit`ed before it is
 * read. A class or package the upload holds anywhere but where TeX finds it is put there, the
 * shallowest of its name first, as the corpus's survey takes it to be the document's (decision
 * 0017).
 */
function reachable(
  mainText: string,
  job: Job,
  entries: readonly Entry[],
  referencesOf: (text: string) => Reference[],
  edit: (path: string, text: string) => string,
): { path: string; text: string }[] {
  const { files } = job;
  const reached: { path: string; text: string }[] = [];
  const seen = new Set<string>();
  const queue = [{ path: "", text: mainText }];
  for (let file = queue.shift(); file; file = queue.shift()) {
    for (const reference of referencesOf(file.text)) {
      let path: string | undefined;
      if (reference.kind === "class" || reference.kind === "package") {
        const extension = reference.kind === "class" ? ".cls" : ".sty";
        const name = reference.name.endsWith(extension)
          ? reference.name
          : `${reference.name}${extension}`;
        path = joinPath("", name);
        if (path !== undefined && files[path] === undefined && !name.includes("/")) {
          const elsewhere = entries
            .filter((entry) => entry.kind === "text" && nameOf(entry.path) === name)
            .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
          if (elsewhere) {
            files[path] = elsewhere.bytes;
            job.source.set(path, elsewhere.path);
          }
        }
      } else if (reference.kind === "input") {
        const name = kindOf(reference.name) === "text" ? reference.name : `${reference.name}.tex`;
        path = joinPath(reference.fromCaller ? folderOf(file.path) : "", name);
      }
      if (path === undefined || files[path] === undefined || seen.has(path)) continue;
      if (kindOf(path) !== "text") continue;
      seen.add(path);
      const text = jobText(files, path);
      const read = reference.kind === "input" ? edit(path, text) : text;
      reached.push({ path, text: read });
      queue.push({ path, text: read });
    }
  }
  return reached;
}

/**
 * The packages views of a document's files load, once each, but for one every load of which is in
 * `\IfFileExists`'s branch for a file that is there, and which is not `present`: TeX loads such a
 * package only when it is there, as the survey reads it.
 */
function loadedPackages(
  views: readonly string[],
  present: (name: string) => boolean,
  referencesOf: (text: string) => Reference[],
): string[] {
  const optional = new Map<string, boolean>();
  for (const view of views)
    for (const reference of referencesOf(view))
      if (reference.kind === "package")
        optional.set(
          reference.name,
          (optional.get(reference.name) ?? true) && reference.optional === true,
        );
  return [...optional].filter(([name, only]) => !only || present(name)).map(([name]) => name);
}

// Images.

/** Raster images a PNG stands in for. */
const RASTER = new Set([".png", ".jpg", ".jpeg"]);

/** The images of an intake so far, and each stand-in's image, by its path in the job. */
interface Images {
  replaced: StandIn[];
  dropped: Dropped[];
  infos: Map<string, ImageInfo>;
}

/**
 * Blank stand-ins for the upload's images, each at its place in the job, those beside the main
 * file first, as `layOut` places other files, so that one at the same path above them is left out;
 * a PDF named as the main file is, beside it, is the document compiled, and is left out too. An
 * image that cannot be read, or that has more than MAX_SIDE pixels on a side, is dropped, and so is
 * every image of another format, at the path it would have had; a PDF whose page's size cannot be
 * read is named in a warning. The images are read within one budget (`UPLOAD_BUDGET`): once a PDF
 * is past it, that one and every image after it are dropped, and one warning says so.
 */
function placeImages(
  job: Job,
  entries: readonly Entry[],
  main: string,
  droppedFormats: readonly string[],
): Images {
  const images: Images = {
    replaced: [],
    dropped: droppedFormats.map((name) => ({
      name,
      why: "format",
      path: jobPathOf(job.folder, name),
    })),
    infos: new Map(),
  };
  const compiled = `${withoutExtension(main)}.pdf`;
  const candidates = entries.filter((entry) => entry.kind === "image" && entry.path !== compiled);
  const beside = candidates.filter((entry) => insideOf(job.folder, entry.path));
  const above = candidates.filter((entry) => !insideOf(job.folder, entry.path));
  const budget = uploadBudget();
  let unread = 0;
  for (const entry of [...beside, ...above]) {
    const path = jobPathOf(job.folder, entry.path);
    if (!inJob(path)) continue;
    const shown = shownInMessage(entry.path);
    if (job.files[path] !== undefined) {
      images.dropped.push({ name: entry.path, why: "duplicate" });
      job.warnings.push(
        `${shown} is left out: an image of the same path beside the main file comes first.`,
      );
      continue;
    }
    const info = budget.spent ? undefined : imageInfo(entry.bytes, budget);
    if (budget.spent) {
      images.dropped.push({ name: entry.path, why: "unreadable", path });
      unread++;
      continue;
    }
    const isPdf = extensionOf(entry.path) === ".pdf";
    if (info === undefined || (info.kind === "pdf") !== isPdf) {
      images.dropped.push({ name: entry.path, why: "unreadable", path });
      if (isPdf)
        job.warnings.push(`${shown} is left out: this editor could not read its page's size.`);
      continue;
    }
    if (tooLarge(info) && info.kind !== "pdf") {
      images.dropped.push({ name: entry.path, why: "unreadable", path });
      job.warnings.push(
        `${shown} is left out: at ${info.width.toLocaleString("en")} by ${info.height.toLocaleString("en")} pixels, it is larger than this editor stands in for, ${MAX_SIDE.toLocaleString("en")} pixels on a side.`,
      );
      continue;
    }
    job.files[path] = standIn(info);
    job.source.set(path, entry.path);
    images.infos.set(path, info);
    images.replaced.push({ name: entry.path, path, kind: info.kind });
  }
  if (unread > 0)
    job.warnings.push(
      `This upload has too many images to read: ${unread} of them ${unread === 1 ? "is" : "are"} left out.`,
    );
  return images;
}

/**
 * Stand-ins for the files `\includegraphics` names, in the engine's view of the files the main file
 * loads, that the job lacks. A name is the upload's when graphicx would find a file of it, from
 * TeX's working folder or a folder `\graphicspath` names, with an extension it tries when the name
 * has none; one that finds only an image of the upload's in a format with no stand-in gets none, so
 * that the compile, if the document shows it, stops on it and the reference compile refuses it; a
 * name the tree's when `treeImage` finds one, whose stand-in is of its size; otherwise a 1 by 1
 * stand-in goes where graphicx looks first: a PDF for a name ending in `.pdf`, and a PNG otherwise,
 * `.png` added to a name without an extension. A name out of the job, or of another format that the
 * upload lacks, is dropped, once.
 */
function standInNamed(
  job: Job,
  images: Images,
  named: readonly string[],
  folders: readonly string[],
  treeImage: IntakeOptions["treeImage"],
) {
  const put = (path: string, info: ImageInfo, standing: StandIn) => {
    job.files[path] = standIn(info);
    images.infos.set(path, info);
    images.replaced.push(standing);
  };
  const droppedAt = new Set(
    images.dropped.flatMap((each) => (each.why === "format" && each.path ? [each.path] : [])),
  );
  const found = (tries: readonly string[], held: (path: string) => boolean) =>
    folders.some((folder) =>
      tries.some((tried) => {
        const at = joinPath(folder, tried);
        return at !== undefined && held(at);
      }),
    );
  for (const name of named) {
    const path = joinPath("", name.replace(/^(\.\/)+/, ""));
    if (path === undefined) {
      images.dropped.push({ name, why: "outside" });
      continue;
    }
    const extension = extensionOf(path);
    const tries = extension === "" ? STAND_IN_TRIES.map((each) => `${path}${each}`) : [path];
    if (found(tries, (at) => job.files[at] !== undefined)) continue;
    const anyTries = extension === "" ? DRIVER_EXTENSIONS.map((each) => `${path}${each}`) : [path];
    if (found(anyTries, (at) => droppedAt.has(at))) continue;
    const inTree =
      treeImage &&
      tries.flatMap((tried) => {
        const bytes = treeImage(tried);
        const info = bytes && imageInfo(bytes);
        return info && !tooLarge(info) && (info.kind === "pdf") === (extensionOf(tried) === ".pdf")
          ? [{ tried, info }]
          : [];
      })[0];
    if (inTree) {
      put(inTree.tried, inTree.info, {
        name,
        path: inTree.tried,
        kind: inTree.info.kind,
        tree: true,
      });
      continue;
    }
    if (extension !== "" && extension !== ".pdf" && !RASTER.has(extension)) {
      images.dropped.push({ name, why: "format" });
      continue;
    }
    const at = extension === "" ? `${path}.png` : path;
    const info = extension === ".pdf" ? ONE_POINT_PDF : ONE_BY_ONE;
    put(at, info, { name, path: at, kind: info.kind, missing: true });
  }
}

/**
 * The `.xbb` files pdfTeX's graphicx reads an image's size from, with dvipdfmx's driver: one for
 * each name, since the driver reads `<name>.xbb` whatever the extension, for the image graphicx
 * takes for the name without an extension, but that an image the job has, the upload's or the
 * tree's, comes before a stand-in for one the upload lacks (`sizedImage`). Another image of the
 * name is shadowed, which a warning says, and one more when the document names it with its
 * extension, since it then takes the other's size; a stand-in for one the upload lacks, shadowed
 * by an image, has one warning, which says so.
 */
function boundingBoxes(
  job: Job,
  images: Images,
  named: readonly string[],
  folders: readonly string[],
) {
  const byName = new Map<string, string[]>();
  const lacked = new Set<string>();
  for (const { path, missing } of images.replaced) {
    const base = withoutExtension(path);
    byName.set(base, [...(byName.get(base) ?? []), path]);
    if (missing) lacked.add(path);
  }
  const shows = new Set(
    named
      .filter((name) => extensionOf(name) !== "")
      .flatMap((name) => folders.flatMap((folder) => joinPath(folder, name) ?? [])),
  );
  for (const [base, paths] of byName) {
    const picked = sizedImage(paths, (path) => lacked.has(path)) ?? "";
    const info = images.infos.get(picked);
    if (info === undefined) continue;
    job.files[`${base}.xbb`] = new TextEncoder().encode(xbb(info));
    for (const other of paths) {
      if (other === picked) continue;
      if (lacked.has(other) && !lacked.has(picked)) {
        job.warnings.push(
          `${shownInMessage(other)}, which the upload lacks, is shadowed by ${shownInMessage(picked)}, of the same name, whose size it takes: on pdfTeX, this editor sizes the two by the name they share.`,
        );
        continue;
      }
      job.warnings.push(
        `${shownInMessage(other)} is shadowed by ${shownInMessage(picked)}, of the same name, which graphicx takes when the document names neither's extension.`,
      );
      if (shows.has(other))
        job.warnings.push(
          `${shownInMessage(other)} is shown at the size of ${shownInMessage(picked)}: on pdfTeX, this editor sizes the two by the name they share.`,
        );
    }
  }
}

/**
 * The tree's images by the name graphicx finds them under, from the engine's file list and a
 * reader of its files: an image of a `tex/` folder whose path ends with the name, of the first
 * tree kpathsea searches (`TREES`), as `\IfFileExists` finds one after the job's folder.
 */
export function treeImages(
  files: Readonly<Record<string, number>>,
  read: (path: string) => Uint8Array,
): (name: string) => Uint8Array | undefined {
  const byName = new Map<string, string[]>();
  for (const path of Object.keys(files)) {
    if (!/\/tex\//.test(path) || !IMAGE_EXTENSIONS.includes(extensionOf(path))) continue;
    const name = nameOf(path);
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  return (name) => {
    const found = (byName.get(nameOf(name)) ?? [])
      .filter((path) => path.endsWith(`/${name}`))
      .sort((a, b) => treeOrder(a) - treeOrder(b))[0];
    return found === undefined ? undefined : read(found);
  };
}

/** Where a path's tree comes in kpathsea's search: the tree of TeX Live first, the bundles' after. */
const treeOrder = (path: string) => (path.startsWith("/texlive/") ? 0 : 1);
