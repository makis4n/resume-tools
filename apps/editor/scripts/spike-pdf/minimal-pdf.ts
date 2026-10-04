/**
 * Small PDFs made by hand, for the PDF spike's tests (item 3): pages of text in the standard 14
 * fonts, filled rectangles and links, and, for the reader's refusals, a PDF locked with a password
 * nobody knows. Every text in them is the test's own.
 */

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

export interface PdfPageSpec {
  texts?: PdfText[];
  rects?: PdfRect[];
  links?: PdfLinkBox[];
}

const HEIGHT = 792;
const FONTS = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Times-Roman"] as const;

/** A string as a PDF literal string, its backslashes and brackets escaped. */
const literal = (text: string) => `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`;

/**
 * A PDF of US Letter pages with the texts, rectangles and links given, in WinAnsi Latin; or, with
 * `locked`, one encrypted under the standard handler with a user password nobody knows, which a
 * reader cannot open without it.
 */
export function minimalPdf(pages: readonly PdfPageSpec[], options: { locked?: boolean } = {}) {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const pagesId = add("");
  const fontIds = FONTS.map((font) =>
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`),
  );
  const fontResources = FONTS.map((_, index) => `/F${index} ${fontIds[index]} 0 R`).join(" ");
  const kids: number[] = [];
  for (const page of pages) {
    const content = [
      ...(page.rects ?? []).map(
        (rect) => `${rect.x} ${HEIGHT - rect.y - rect.height} ${rect.width} ${rect.height} re f`,
      ),
      ...(page.texts ?? []).map((text) => {
        const font = FONTS.indexOf(text.font ?? "Helvetica");
        return `BT /F${font} ${text.size} Tf ${text.x} ${HEIGHT - text.y} Td ${literal(text.text)} Tj ET`;
      }),
    ].join("\n");
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const annots = (page.links ?? []).map((link) =>
      add(
        `<< /Type /Annot /Subtype /Link /Rect [${link.x} ${HEIGHT - link.y - link.height} ${link.x + link.width} ${HEIGHT - link.y}] /Border [0 0 0] /A << /S /URI /URI ${literal(link.url)} >> >>`,
      ),
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 ${HEIGHT}] /Resources << /Font << ${fontResources} >> >> /Contents ${stream} 0 R${annots.length > 0 ? ` /Annots [${annots.map((id) => `${id} 0 R`).join(" ")}]` : ""} >>`,
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
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
