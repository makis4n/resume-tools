/**
 * Small PDFs made by hand, for the PDF reader's tests (item 10) and the spike's (item 3): pages of
 * text in the standard 14 fonts, filled rectangles, forms and links, compressed or not, and, for
 * the reader's refusals, a PDF locked with a password nobody knows. Every text in them is the
 * test's own.
 */

import { zlibSync } from "fflate";

/** A run of text at a point, its baseline `y` from the page's top. */
export interface PdfText {
  x: number;
  y: number;
  size: number;
  text: string;
  font?: "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique" | "Times-Roman";
}

/** A filled rectangle, its top-left corner and size in points, from the page's top. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfLinkBox extends PdfRect {
  url: string;
}

/** A form XObject the page draws once: its rectangles, in its own space, through its matrix. */
export interface PdfForm {
  matrix?: readonly [number, number, number, number, number, number];
  rects: PdfRect[];
}

export interface PdfPageSpec {
  texts?: PdfText[];
  rects?: PdfRect[];
  links?: PdfLinkBox[];
  forms?: PdfForm[];
  /** Content operators written as they are, after the rest: what a test of the caps needs. */
  operators?: string;
}

export interface MinimalPdfOptions {
  /** Encrypted under the standard handler with a user password nobody knows. */
  locked?: boolean;
  /** Each page's content compressed with Flate, as most PDFs are. */
  deflate?: boolean;
}

/** An object of a PDF: its dictionary, or a stream's dictionary and its data. */
export type PdfObject = string | { dict: string; data: Uint8Array };

const HEIGHT = 792;
const FONTS = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Times-Roman"] as const;

/** A string as a PDF literal string, its backslashes and brackets escaped. */
const literal = (text: string) => `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`;

const encode = (text: string) => new TextEncoder().encode(text);

/** A rectangle filled, from the top-left points the specs use to the PDF's own. */
const filled = (rect: PdfRect) =>
  `${rect.x} ${HEIGHT - rect.y - rect.height} ${rect.width} ${rect.height} re f`;

/**
 * A PDF of the objects given, numbered from 1 in their order, with its cross-reference table and
 * a trailer naming `root` as its catalogue, and `trailer` added to the trailer's dictionary.
 */
export function assemblePdf(objects: readonly PdfObject[], root: number, trailer = ""): Uint8Array {
  const parts: Uint8Array[] = [encode("%PDF-1.4\n")];
  let length = parts[0]?.length ?? 0;
  const push = (part: Uint8Array) => {
    parts.push(part);
    length += part.length;
  };
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    if (typeof object === "string") push(encode(`${index + 1} 0 obj\n${object}\nendobj\n`));
    else {
      push(encode(`${index + 1} 0 obj\n${object.dict}\nstream\n`));
      push(object.data);
      push(encode("\nendstream\nendobj\n"));
    }
  });
  const xref = length;
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
  push(encode(tail));
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A PDF of US Letter pages with the texts, rectangles, forms and links given, in WinAnsi Latin;
 * with `deflate`, its pages' content compressed; with `locked`, one encrypted under the standard
 * handler with a user password nobody knows, which a reader cannot open without it.
 */
export function minimalPdf(pages: readonly PdfPageSpec[], options: MinimalPdfOptions = {}) {
  const objects: PdfObject[] = [];
  const add = (body: PdfObject) => {
    objects.push(body);
    return objects.length;
  };
  const stream = (content: string, extra = "") => {
    const data = options.deflate ? zlibSync(encode(content)) : encode(content);
    const filter = options.deflate ? " /Filter /FlateDecode" : "";
    return add({ dict: `<< /Length ${data.length}${filter}${extra} >>`, data });
  };
  const catalog = add("");
  const pagesId = add("");
  const fontIds = FONTS.map((font) =>
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`),
  );
  const fontResources = FONTS.map((_, index) => `/F${index} ${fontIds[index]} 0 R`).join(" ");
  const kids: number[] = [];
  for (const page of pages) {
    const forms = (page.forms ?? []).map((form) =>
      stream(
        form.rects.map(filled).join("\n"),
        ` /Type /XObject /Subtype /Form /BBox [0 0 612 ${HEIGHT}]${form.matrix ? ` /Matrix [${form.matrix.join(" ")}]` : ""}`,
      ),
    );
    const content = [
      ...(page.rects ?? []).map(filled),
      ...forms.map((_, index) => `/Fm${index} Do`),
      ...(page.texts ?? []).map((text) => {
        const font = FONTS.indexOf(text.font ?? "Helvetica");
        return `BT /F${font} ${text.size} Tf ${text.x} ${HEIGHT - text.y} Td ${literal(text.text)} Tj ET`;
      }),
      ...(page.operators === undefined ? [] : [page.operators]),
    ].join("\n");
    const contents = stream(content);
    const annots = (page.links ?? []).map((link) =>
      add(
        `<< /Type /Annot /Subtype /Link /Rect [${link.x} ${HEIGHT - link.y - link.height} ${link.x + link.width} ${HEIGHT - link.y}] /Border [0 0 0] /A << /S /URI /URI ${literal(link.url)} >> >>`,
      ),
    );
    const xObjects =
      forms.length === 0
        ? ""
        : ` /XObject << ${forms.map((id, index) => `/Fm${index} ${id} 0 R`).join(" ")} >>`;
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 ${HEIGHT}] /Resources << /Font << ${fontResources} >>${xObjects} >> /Contents ${contents} 0 R${annots.length > 0 ? ` /Annots [${annots.map((id) => `${id} 0 R`).join(" ")}]` : ""} >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let encrypt = "";
  if (options.locked) {
    // The owner's and the user's keys of a password nobody knows: no password opens it.
    const id = add(
      `<< /Filter /Standard /V 1 /R 2 /O <${"4f".repeat(32)}> /U <${"55".repeat(32)}> /P -4 >>`,
    );
    encrypt = ` /Encrypt ${id} 0 R /ID [<${"ab".repeat(16)}> <${"ab".repeat(16)}>]`;
  }
  return assemblePdf(objects, catalog, encrypt);
}
