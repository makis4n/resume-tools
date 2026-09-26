import { describe, expect, it } from "vitest";
import { samplePdf } from "./sample-pdf";

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("samplePdf", () => {
  it("points every cross-reference entry at the byte where its object starts", async () => {
    const bytes = await bytesOf(samplePdf("Zoë (Lead) \\ Invented"));
    const text = new TextDecoder("latin1").decode(bytes);
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`);
    });
    const startxref = Number(text.match(/startxref\n(\d+)\n/)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("escapes the characters that end or break a PDF string", async () => {
    const text = new TextDecoder().decode(await bytesOf(samplePdf("A (B) \\ C")));
    expect(text).toContain("(A \\(B\\) \\\\ C) Tj");
  });
});
