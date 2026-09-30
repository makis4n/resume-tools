/**
 * Stand-ins at plain paths (milestone 3 item 12, decision 0038). The PDF shows a blank stand-in for
 * an upload's image only at a path of letters, digits, `.`, `_`, `-` and `/` (`isShowableImage`,
 * decision 0019), so that nothing in the special that shows it can mean anything to xdvipdfmx but
 * the file; a document that shows an image the upload keeps under any other name, one with a space
 * or an accent in it, had its PDF refused, which decision 0019 left to this item.
 *
 * Right after the intake, before the reference compile, so that every compile of the import sees
 * the same, each such stand-in is copied to a plain path: its name with each letter's accents taken
 * off and every other character past the plain ones a dash, and a number added where that path is
 * taken; with its name's `.xbb` on pdfTeX, which graphicx sizes it by. Every `\includegraphics` of
 * the main file and of the upload's `.tex` files that names it, as the name reaches graphicx
 * through the working folder or a `\graphicspath` folder, is rewritten to name the copy. The
 * stand-in stays at the document's own name for it beside the copy, for a name a macro builds,
 * which no rewrite can see and which then shows the stand-in under its own name, as before: that
 * PDF is still refused, and a warning of the intake's names the image.
 */

import { isShowableImage } from "../engine/session";
import { DRIVER_EXTENSIONS, decodeText, encodeLike, IMAGE_EXTENSIONS, type Intake } from "./intake";
import { extensionOf, joinPath, withoutExtension } from "./paths";
import { shownInMessage } from "./refusal";
import { graphicsArguments, graphicsPaths } from "./source";

/** Of the extensions graphicx tries for a name without one, those a stand-in can have, in order. */
const TRIES = DRIVER_EXTENSIONS.filter((each) => IMAGE_EXTENSIONS.includes(each.toLowerCase()));

/**
 * A path as a plain one, character by character, so that a folder and a name map the same whether
 * graphicx reads them apart or together: a letter's accents taken off (`é` is `e`), and every
 * character that is still not a letter or digit of ASCII, `.`, `_`, `-` or `/` a dash.
 */
export function plainPath(path: string): string {
  let out = "";
  for (const char of path) {
    const bare = char.normalize("NFD").replace(/\p{M}/gu, "");
    out += /^[A-Za-z0-9._\-/]+$/.test(bare) ? bare : "-";
  }
  return out;
}

/**
 * The intake with each stand-in whose path the PDF cannot show copied to a plain one, and the
 * sources' `\includegraphics` that name it rewritten to name the copy (the module's comment). An
 * intake whose stand-ins are all at plain paths comes back as it was.
 */
export function plainStandIns(intake: Intake): Intake {
  const unplain = intake.images.replaced.filter((image) => !isShowableImage(image.path));
  if (unplain.length === 0) return intake;
  const files: Record<string, Uint8Array> = { ...intake.files };
  // The names taken, without their extensions, since graphicx sizes an image by its name's `.xbb`
  // whatever its extension: a copy's base must be no other file's.
  const bases = new Set(Object.keys(files).map(withoutExtension));
  bases.add(withoutExtension(intake.main.path));
  /** Each unplain stand-in's base, and the plain one its copies take. */
  const renamed = new Map<string, string>();
  for (const image of unplain) {
    const base = withoutExtension(image.path);
    if (renamed.has(base)) continue;
    const plain = plainPath(base);
    // A name of accents alone has nothing left: the copy is an image's.
    const stem = isShowableImage(`${plain}.png`) ? plain : "image";
    let chosen = stem;
    for (let n = 2; bases.has(chosen); n++) chosen = `${stem}-${n}`;
    bases.add(chosen);
    renamed.set(base, chosen);
  }
  const warnings = [...intake.warnings];
  const replaced = intake.images.replaced.map((image) => {
    const base = withoutExtension(image.path);
    const plain = renamed.get(base);
    if (plain === undefined || isShowableImage(image.path)) return image;
    const path = `${plain}${image.path.slice(base.length)}`;
    const bytes = files[image.path];
    if (bytes !== undefined) files[path] = bytes;
    const box = files[`${base}.xbb`];
    if (box !== undefined) files[`${plain}.xbb`] = box;
    warnings.push(
      `${shownInMessage(image.path)} is shown from a copy named ${path}: this editor's PDF shows an image only under a name of plain letters, digits, dots, dashes and underscores.`,
    );
    return { ...image, path };
  });

  // The sources that may name them: the main file and the upload's other `.tex` files.
  const texts = new Map<string, string>([["", intake.main.text]]);
  for (const [path, bytes] of Object.entries(intake.files))
    if (extensionOf(path) === ".tex") texts.set(path, decodeText(bytes));
  const folders = [
    "",
    ...[...texts.values()]
      .flatMap(graphicsPaths)
      .flatMap((each) => joinPath("", each.replace(/^(\.\/)+/, "")) ?? []),
  ];
  /** The job's path graphicx takes for a name, extension by extension and folder by folder. */
  const resolve = (name: string): string | undefined => {
    const path = joinPath("", name.replace(/^(\.\/)+/, ""));
    if (path === undefined) return undefined;
    const tries = extensionOf(path) === "" ? TRIES.map((each) => `${path}${each}`) : [path];
    for (const tried of tries)
      for (const folder of folders) {
        const at = joinPath(folder, tried);
        if (at !== undefined && files[at] !== undefined) return at;
      }
    return undefined;
  };
  /** A source with each name graphicx takes for a renamed stand-in written as the copy's. */
  const rewrite = (text: string): string | undefined => {
    let out = "";
    let at = 0;
    for (const { name, start, end } of graphicsArguments(text)) {
      const found = resolve(name);
      const base = found === undefined ? undefined : withoutExtension(found);
      const plain = base === undefined ? undefined : renamed.get(base);
      if (plain === undefined || base === undefined) continue;
      // The name's own extension, as it gave it, or none, so that graphicx picks among the copies
      // as it picked among the stand-ins.
      const given = extensionOf(name) === "" ? "" : name.slice(withoutExtension(name).length);
      out += text.slice(at, start) + plain + given;
      at = end;
    }
    return at === 0 ? undefined : out + text.slice(at);
  };

  let main = intake.main;
  const mainText = rewrite(intake.main.text);
  if (mainText !== undefined)
    main = {
      ...main,
      text: mainText,
      bytes: encodeLike(main.bytes, mainText) ?? new TextEncoder().encode(mainText),
    };
  for (const [path, text] of texts) {
    if (path === "") continue;
    const written = rewrite(text);
    const bytes = files[path];
    if (written === undefined || bytes === undefined) continue;
    files[path] = encodeLike(bytes, written) ?? new TextEncoder().encode(written);
  }
  return { ...intake, main, files, images: { ...intake.images, replaced }, warnings };
}
