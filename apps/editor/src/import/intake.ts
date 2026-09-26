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
 * their bytes as they are.
 *
 * The job is the main file's folder: each file there or below keeps its path from it, as TeX's
 * working folder is the main file's; each file elsewhere keeps its path from the top of the
 * upload, a zip's one wrapping folder aside, where a template such as Awesome-CV keeps its class
 * and fonts beside an `examples/` folder; and a class or package the document loads that the upload
 * holds anywhere else is put where TeX finds it, beside the main file, as the corpus's survey takes
 * one (decision 0017).
 *
 * The engine is read from the source as the survey reads it (`source.ts`): LuaTeX is refused, XeTeX
 * is XeTeX, and pdfTeX or either is pdfTeX. Fonts the upload ships go into the job for the
 * reference compile alone, and are named for item 8. Images never do (decision 0008): each PNG,
 * JPEG and PDF becomes a blank stand-in of the same size (`images.ts`), with its `.xbb` for
 * pdfTeX, and so does each file `\includegraphics` names that the upload lacks, of the tree's
 * image's size when the tree has one and 1 by 1 otherwise; every other image is dropped, and the
 * result names each.
 *
 * It is a function of the upload's bytes, and of the tree when it is given the tree's, and runs in
 * the browser and in Node alike.
 */

import { unzipSync } from "fflate";
import type { Engine } from "../engine/session";
import type { Tree } from "./fonts";
import { type ImageInfo, imageInfo, ONE_BY_ONE, ONE_POINT_PDF, standIn, xbb } from "./images";
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
  type Reading,
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
 * An image the intake dropped, and why: a format it has no stand-in for (`format`), bytes it cannot
 * read as the image its name says (`unreadable`), or a name outside the job (`outside`).
 */
export interface Dropped {
  name: string;
  why: "format" | "unreadable" | "outside";
}

export interface Intake {
  /** The engine the reference compile runs: XeTeX when the source needs it, pdfTeX otherwise. */
  engine: Engine;
  /** What the source asks for (`engineFrom`), which chose the engine. */
  source: Exclude<SourceEngine, "luatex">;
  /** The main file: its path in the upload, its text for reading, and its bytes for the engine. */
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

/**
 * The extensions graphicx tries, in its order, for a name `\includegraphics` gives without one,
 * of those a stand-in can be: `dvipdfmx.def` and `xetex.def` try PDF first, then PNG, then JPEG.
 */
const TRIED_EXTENSIONS = [".pdf", ".PDF", ".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG"];

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
 * Take an upload in: unpack it, find its main file, lay out its job, read its engine, and stand in
 * for its images; or refuse it, saying why.
 */
export function intake(upload: Upload, options: IntakeOptions = {}): Intake | Refusal {
  const unpacked = unpack(upload);
  if ("refused" in unpacked) return unpacked;
  const { entries, droppedFormats } = unpacked;

  const texts = new Map<string, string>();
  for (const entry of entries)
    if (entry.kind === "text") texts.set(entry.path, decodeText(entry.bytes));
  const main = mainFile(entries, texts);
  if ("refused" in main) return main;
  const mainText = texts.get(main.path) ?? "";

  const job = layOut(entries, main.path);
  const reached = reachable(mainText, job.files, entries);
  const read = [
    { path: "", text: mainText },
    ...reached.map((path) => ({ path, text: jobText(job.files, path) })),
  ]
    .filter((file) => extensionOf(file.path) !== ".bib")
    .map((file) => ({ ...file, isClass: extensionOf(file.path) === ".cls" }));
  const known = optionValues(read, classOptions(mainText));
  const readings = read.map((file) => ({ ...file, reading: readSource(file.text, known) }));
  const present = (name: string) =>
    job.files[`${name}.sty`] !== undefined || options.tree?.styles.has(`${name}.sty`) === true;
  const needsOf = (view: (reading: Reading) => string) => {
    const views = readings.map((file) => view(file.reading));
    return viewNeeds(views, loadedPackages(views, present));
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
  const images = standIns(job, entries, main.path, engine, views, options.treeImage);
  return {
    engine,
    source,
    main: { path: main.path, text: mainText, bytes: main.bytes },
    files: job.files,
    fonts: job.fonts,
    images: { replaced: images.replaced, dropped: [...droppedFormats, ...images.dropped] },
    warnings: job.warnings,
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

// Unpacking.

/**
 * The upload's files, by their paths from its top, a zip's one wrapping folder aside, with the
 * images of other formats named apart; or a refusal for a cap, a name, or bytes that are neither a
 * `.tex` file nor a zip.
 */
function unpack(upload: Upload): { entries: Entry[]; droppedFormats: Dropped[] } | Refusal {
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
  return {
    entries,
    droppedFormats: droppedNames.map((name) => ({ name: name.slice(top.length), why: "format" })),
  };
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
function mainFile(entries: readonly Entry[], texts: ReadonlyMap<string, string>): Entry | Refusal {
  const sources = entries.filter((entry) => extensionOf(entry.path) === ".tex");
  const inputted = new Set<string>();
  for (const source of sources)
    for (const reference of references(texts.get(source.path) ?? "")) {
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
  fonts: string[];
  warnings: string[];
}

/**
 * The job's files but for its stand-ins: each text file, bibliography and font at its path from
 * the main file's folder when it is there or below, and at its path from the upload's top
 * otherwise, unless a file of the main file's folder is there already; not the main file itself,
 * which the compile is given as its body, and no image.
 */
function layOut(entries: readonly Entry[], main: string): Job {
  const folder = folderOf(main);
  const inside = (path: string) => folder === "" || path.startsWith(`${folder}/`);
  const job: Job = { files: {}, fonts: [], warnings: [] };
  const place = (entry: Entry, path: string) => {
    if (!inJob(path)) return;
    job.files[path] = entry.bytes;
    if (entry.kind === "font") job.fonts.push(path);
  };
  const kept = entries.filter((entry) => entry.kind !== "image" && entry.path !== main);
  for (const entry of kept)
    if (inside(entry.path))
      place(entry, folder === "" ? entry.path : entry.path.slice(folder.length + 1));
  for (const entry of kept) {
    if (inside(entry.path)) continue;
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
 * The text files of the job the main file loads, followed as far as they go, in the order they are
 * reached: classes and packages beside the main file or at the path they are named by, and sources
 * at the path they are named by, from the main file's folder, TeX's working folder, or from the
 * caller's for `\subimport`. A class or package the upload holds anywhere but where TeX finds it is
 * put there, the shallowest of its name first, as the corpus's survey takes it to be the
 * document's (decision 0017).
 */
function reachable(
  mainText: string,
  files: Record<string, Uint8Array>,
  entries: readonly Entry[],
): string[] {
  const reached: string[] = [];
  const seen = new Set<string>();
  const queue = [{ path: "", text: mainText }];
  for (let file = queue.shift(); file; file = queue.shift()) {
    for (const reference of references(file.text)) {
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
          if (elsewhere) files[path] = elsewhere.bytes;
        }
      } else if (reference.kind === "input") {
        const name = kindOf(reference.name) === "text" ? reference.name : `${reference.name}.tex`;
        path = joinPath(reference.fromCaller ? folderOf(file.path) : "", name);
      }
      if (path === undefined || files[path] === undefined || seen.has(path)) continue;
      if (kindOf(path) !== "text") continue;
      seen.add(path);
      reached.push(path);
      queue.push({ path, text: jobText(files, path) });
    }
  }
  return reached;
}

/**
 * The packages views of a document's files load, once each, but for one every load of which is in
 * `\IfFileExists`'s branch for a file that is there, and which is not `present`: TeX loads such a
 * package only when it is there, as the survey reads it.
 */
function loadedPackages(views: readonly string[], present: (name: string) => boolean): string[] {
  const optional = new Map<string, boolean>();
  for (const view of views)
    for (const reference of references(view))
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

/**
 * Blank stand-ins for the upload's images and for the files `\includegraphics` names that it
 * lacks, into the job's files, with each one's `.xbb` for pdfTeX; and what is dropped. An image of
 * the upload stands in at its place in the job; a PDF named as the main file is, beside it, is the
 * document compiled, and is left out. A name `\includegraphics` gives, in the engine's view of the
 * files the main file loads, is the upload's when graphicx would find a file of it, from TeX's
 * working folder or a folder `\graphicspath` names, with an extension it tries when the name has
 * none; the tree's when `treeImage` finds one, whose stand-in is of its size; otherwise a 1 by 1
 * stand-in goes where graphicx looks first: a PDF for a name ending in `.pdf`, and a PNG
 * otherwise, `.png` added to a name without an extension.
 */
function standIns(
  job: Job,
  entries: readonly Entry[],
  main: string,
  engine: Engine,
  views: readonly string[],
  treeImage: IntakeOptions["treeImage"],
): { replaced: StandIn[]; dropped: Dropped[] } {
  const replaced: StandIn[] = [];
  const dropped: Dropped[] = [];
  const put = (path: string, info: ImageInfo) => {
    job.files[path] = standIn(info);
    if (engine === "pdftex")
      job.files[`${withoutExtension(path)}.xbb`] = new TextEncoder().encode(xbb(info));
  };
  const folder = folderOf(main);
  const inside = (path: string) => folder === "" || path.startsWith(`${folder}/`);
  const compiled = `${withoutExtension(main)}.pdf`;
  for (const entry of entries) {
    if (entry.kind !== "image" || entry.path === compiled) continue;
    const info = imageInfo(entry.bytes);
    const isPdf = extensionOf(entry.path) === ".pdf";
    if (info === undefined || (info.kind === "pdf") !== isPdf) {
      dropped.push({ name: entry.path, why: "unreadable" });
      continue;
    }
    const path =
      inside(entry.path) && folder !== "" ? entry.path.slice(folder.length + 1) : entry.path;
    if (job.files[path] !== undefined || !inJob(path)) continue;
    put(path, info);
    replaced.push({ name: entry.path, path, kind: info.kind });
  }

  const folders = [
    "",
    ...views
      .flatMap(graphicsPaths)
      .flatMap((each) => joinPath("", each.replace(/^(\.\/)+/, "")) ?? []),
  ];
  const named = new Set(views.flatMap(graphicsNames));
  for (const name of named) {
    const path = joinPath("", name.replace(/^(\.\/)+/, ""));
    if (path === undefined) {
      dropped.push({ name, why: "outside" });
      continue;
    }
    const extension = extensionOf(path);
    const tries = extension === "" ? TRIED_EXTENSIONS.map((each) => `${path}${each}`) : [path];
    const found = folders.some((each) =>
      tries.some((tried) => {
        const at = joinPath(each, tried);
        return at !== undefined && job.files[at] !== undefined;
      }),
    );
    if (found) continue;
    const inTree =
      treeImage &&
      tries.flatMap((tried) => {
        const bytes = treeImage(tried);
        const info = bytes && imageInfo(bytes);
        return info && (info.kind === "pdf") === (extensionOf(tried) === ".pdf")
          ? [{ tried, info }]
          : [];
      })[0];
    if (inTree) {
      put(inTree.tried, inTree.info);
      replaced.push({ name, path: inTree.tried, kind: inTree.info.kind, tree: true });
      continue;
    }
    if (extension !== "" && extension !== ".pdf" && !RASTER.has(extension)) {
      dropped.push({ name, why: "format" });
      continue;
    }
    const at = extension === "" ? `${path}.png` : path;
    const info = extension === ".pdf" ? ONE_POINT_PDF : ONE_BY_ONE;
    put(at, info);
    replaced.push({ name, path: at, kind: info.kind, missing: true });
  }
  return { replaced, dropped };
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
