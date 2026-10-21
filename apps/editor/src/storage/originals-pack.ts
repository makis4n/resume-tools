/**
 * The two files an account keeps of a `.tex` import beside its row (milestone 4 item 8, decisions
 * 0090 and 0091), made from what the browser's store keeps of it and read back into the same:
 *
 * - `original.zip`: the person's uploaded files, exactly as given, name and bytes, zipped with
 *   fflate. Its entries are written with one fixed time, so the same upload always makes the same
 *   bytes.
 * - `import.bin`: everything else another device needs to open and compile the document, as a zip
 *   of a JSON manifest (`manifest.json`) and the binary files the manifest names. The manifest holds
 *   the imported package, the report, when it was imported, the upload's names in their order, and
 *   the job: each of its files, and its bibliography, is either one of the upload's own files, or an
 *   entry of an uploaded zip, named there and not stored again (decision 0091), or stored in
 *   `import.bin` itself, as a stand-in or a rewritten `.tex` is. The manifest says which format it is
 *   and its version (`IMPORT_FILES_VERSION`), so an editor refuses plainly a version it does not
 *   read rather than misread it.
 *
 * Pure: nothing here touches the network or the store. `unpackOriginals(packOriginals(...))` gives
 * back a package the schema accepts and a record equal to the one packed, byte for byte.
 */

import { unzipSync, zipSync } from "fflate";
import { z } from "zod";
import type { Upload } from "../import/intake";
import type { ImportJob, ImportReport } from "../import/run";
import { TemplatePackage } from "../templates/package";
import type { ImportRecord } from "./store";

/** The version of `import.bin`'s manifest this editor writes, and the only one it reads. */
export const IMPORT_FILES_VERSION = 1;

/** What `import.bin`'s manifest says it is. */
const FORMAT = "resume-tools import files";

const MANIFEST = "manifest.json";

/** The time every entry is written with, so that packing is the same each time (DOS time's first). */
const FIXED_TIME = new Date(1980, 0, 1, 0, 0, 0);

/**
 * The most either file may unpack to, in bytes. The import's caps keep an upload to 100 MB
 * unpacked; this is a backstop against a file that says it holds more, not a limit a real upload
 * meets.
 */
export const MAX_UNPACKED = 300 * 1024 * 1024;

/** The two files, as the account keeps them. */
export interface OriginalFiles {
  /** `original.zip`. */
  original: Uint8Array;
  /** `import.bin`. */
  import: Uint8Array;
}

/** What the two files give back: the store's package and import record. */
export interface Unpacked {
  package: TemplatePackage;
  record: ImportRecord;
}

/**
 * Files this editor cannot read: of another version, or not as it writes them. The message is for
 * developers; a person reads that the document cannot be opened.
 */
export class OriginalsUnreadable extends Error {
  constructor(why: string, options?: ErrorOptions) {
    super(`the import's files cannot be read: ${why}`, options);
    this.name = "OriginalsUnreadable";
  }
}

/** Where a file of the job comes from: the upload, by its name and zip entry, or `import.bin`. */
const Ref = z.union([
  z.strictObject({ original: z.string(), entry: z.string().optional() }),
  z.strictObject({ stored: z.string() }),
]);
type Ref = z.infer<typeof Ref>;

const Manifest = z.strictObject({
  format: z.literal(FORMAT),
  version: z.number(),
  package: z.unknown(),
  report: z.record(z.string(), z.unknown()),
  made: z.number(),
  upload: z.array(z.string()),
  job: z.strictObject({
    files: z.array(z.tuple([z.string(), Ref])),
    bbl: Ref.optional(),
    images: z.array(z.string()),
  }),
});
type Manifest = z.infer<typeof Manifest>;

/**
 * The two files of an import: the upload as given, and the rest of what the store keeps of it, the
 * job's files the upload holds named rather than stored again. Throws for an upload of two files of
 * one name, or a name a zip cannot hold, which the import never keeps.
 */
export function packOriginals(pkg: TemplatePackage, record: ImportRecord): OriginalFiles {
  const files = record.upload.files;
  const names = files.map((file) => file.name);
  if (new Set(names).size !== names.length)
    throw new Error("the upload holds two files of one name");
  for (const name of names)
    if (name === "" || name.endsWith("/")) throw new Error("the upload holds a file with no name");
  const original = zipSync(Object.fromEntries(files.map((file) => [file.name, file.bytes])), {
    level: 6,
    mtime: FIXED_TIME,
  });

  const sources = new Sources(files);
  const stored: Record<string, Uint8Array> = {};
  const refOf = (bytes: Uint8Array, path: string): Ref => {
    const found = sources.find(bytes, path);
    if (found !== undefined) return found;
    const name = `files/${Object.keys(stored).length}`;
    stored[name] = bytes;
    return { stored: name };
  };
  const { job } = record;
  const manifest: Manifest = {
    format: FORMAT,
    version: IMPORT_FILES_VERSION,
    package: pkg,
    report: record.report as unknown as Record<string, unknown>,
    made: record.made,
    upload: names,
    job: {
      files: Object.entries(job.files).map(([path, bytes]) => [path, refOf(bytes, path)]),
      ...(job.bbl === undefined ? {} : { bbl: refOf(job.bbl, "doc.bbl") }),
      images: job.images,
    },
  };
  const bin = zipSync(
    { [MANIFEST]: new TextEncoder().encode(JSON.stringify(manifest)), ...stored },
    { level: 6, mtime: FIXED_TIME },
  );
  return { original, import: bin };
}

/**
 * The package and import record the two files hold, as `packOriginals` made them. Throws
 * `OriginalsUnreadable` for files of another version, or not as this editor writes them, and for a
 * package the schema refuses.
 */
export function unpackOriginals(files: OriginalFiles): Unpacked {
  const bin = unzipped(files.import, "import.bin");
  const text = bin[MANIFEST];
  if (text === undefined) throw new OriginalsUnreadable("import.bin holds no manifest");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(text));
  } catch (error) {
    throw new OriginalsUnreadable("its manifest is not JSON", { cause: error });
  }
  const format = (json as { format?: unknown; version?: unknown } | null) ?? {};
  if (format.format !== FORMAT) throw new OriginalsUnreadable("import.bin is not the editor's");
  if (format.version !== IMPORT_FILES_VERSION)
    throw new OriginalsUnreadable(`import.bin is of version ${String(format.version)}`);
  const read = Manifest.safeParse(json);
  if (!read.success)
    throw new OriginalsUnreadable("its manifest is not as written", { cause: read.error });
  const manifest = read.data;
  const pkg = TemplatePackage.safeParse(manifest.package);
  if (!pkg.success)
    throw new OriginalsUnreadable("the package's schema refuses it", { cause: pkg.error });

  const uploaded = unzipped(files.original, "original.zip");
  const named = new Set(manifest.upload);
  if (named.size !== manifest.upload.length || Object.keys(uploaded).length !== named.size)
    throw new OriginalsUnreadable("original.zip does not hold the upload the manifest names");
  const upload: Upload[] = manifest.upload.map((name) => {
    const bytes = uploaded[name];
    if (bytes === undefined) throw new OriginalsUnreadable("original.zip lacks an uploaded file");
    return { name, bytes };
  });

  /** Each uploaded zip's entries, unpacked once when a file of the job names one. */
  const entries = new Map<string, Record<string, Uint8Array>>();
  const bytesOf = (ref: Ref): Uint8Array => {
    if ("stored" in ref) {
      const bytes = bin[ref.stored];
      if (bytes === undefined || ref.stored === MANIFEST)
        throw new OriginalsUnreadable("import.bin lacks a file its manifest names");
      return bytes;
    }
    const file = uploaded[ref.original];
    if (file === undefined) throw new OriginalsUnreadable("original.zip lacks a file named");
    if (ref.entry === undefined) return file;
    let inside = entries.get(ref.original);
    if (inside === undefined) {
      inside = unzipped(file, "an uploaded zip");
      entries.set(ref.original, inside);
    }
    const bytes = inside[ref.entry];
    if (bytes === undefined) throw new OriginalsUnreadable("an uploaded zip lacks an entry named");
    return bytes;
  };
  const job: ImportJob = {
    files: Object.fromEntries(manifest.job.files.map(([path, ref]) => [path, own(bytesOf(ref))])),
    ...(manifest.job.bbl === undefined ? {} : { bbl: own(bytesOf(manifest.job.bbl)) }),
    images: manifest.job.images,
  };
  return {
    package: pkg.data,
    record: {
      upload: { files: upload.map((file) => ({ name: file.name, bytes: own(file.bytes) })) },
      job,
      report: manifest.report as unknown as ImportReport,
      made: manifest.made,
    },
  };
}

/**
 * The upload's files and each uploaded zip's entries, which a file of the job may be, found by its
 * bytes. A zip that cannot be read is taken as a file and no more.
 */
class Sources {
  private readonly bySize = new Map<number, { ref: Ref; bytes: Uint8Array; name: string }[]>();

  constructor(files: readonly Upload[]) {
    for (const file of files) {
      this.add({ original: file.name }, file.bytes, file.name);
      if (!isZip(file.bytes)) continue;
      let inside: Record<string, Uint8Array>;
      try {
        inside = unzipped(file.bytes, "an uploaded zip");
      } catch {
        continue;
      }
      for (const [entry, bytes] of Object.entries(inside))
        if (!entry.endsWith("/")) this.add({ original: file.name, entry }, bytes, entry);
    }
  }

  private add(ref: Ref, bytes: Uint8Array, name: string) {
    const same = this.bySize.get(bytes.length) ?? [];
    same.push({ ref, bytes, name });
    this.bySize.set(bytes.length, same);
  }

  /** A source with these bytes, the one whose name ends as `path` does if there are several. */
  find(bytes: Uint8Array, path: string): Ref | undefined {
    const equal = (this.bySize.get(bytes.length) ?? []).filter((each) =>
      sameBytes(each.bytes, bytes),
    );
    const base = path.slice(path.lastIndexOf("/") + 1);
    return (equal.find((each) => each.name === path || each.name.endsWith(`/${base}`)) ?? equal[0])
      ?.ref;
  }
}

/** A zip's entries, within `MAX_UNPACKED`; `OriginalsUnreadable` for one fflate cannot read. */
function unzipped(bytes: Uint8Array, what: string): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_UNPACKED) throw new OriginalsUnreadable(`${what} unpacks to too much`);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof OriginalsUnreadable) throw error;
    throw new OriginalsUnreadable(`${what} is not a zip the editor can read`, { cause: error });
  }
}

/** Whether bytes begin as a zip does. */
const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * Bytes on a buffer of their own: IndexedDB keeps a view's whole buffer, so a file kept as a view
 * of an unpacked zip would keep the zip with it.
 */
function own(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}
