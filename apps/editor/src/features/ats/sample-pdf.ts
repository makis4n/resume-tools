/**
 * A one-page PDF with one line of invented text, built by hand. It stands in for the editor's
 * real PDF until the compile path exposes one (ATS milestone 2), and serves as a test fixture.
 */
export function samplePdf(text = "Invented Person"): Blob {
  const encoder = new TextEncoder();
  const escaped = text.replace(/[\\()]/g, (character) => `\\${character}`);
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`,
  ];
  // Offsets and lengths are counted in bytes, which is what a PDF reader seeks by.
  let out = "%PDF-1.4\n";
  let bytes = encoder.encode(out).length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(bytes);
    const object = `${index + 1} 0 obj\n${body}\nendobj\n`;
    out += object;
    bytes += encoder.encode(object).length;
  });
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${bytes}\n%%EOF\n`;
  return new Blob([encoder.encode(out)], { type: "application/pdf" });
}
