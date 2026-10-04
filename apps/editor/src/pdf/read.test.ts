import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { CURATED } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { defaultControls, fontFiles } from "../templates/package";
import { minimalPdf } from "../test/minimal-pdf";
import { isPdfFile } from "./index";
import { readPdf } from "./node";
import {
  boldName,
  fontName,
  italicName,
  linkAddress,
  NothingFetched,
  type PdfReading,
  type ReadPdf,
} from "./read";
import {
  isPdfRefusal,
  looksLikePdf,
  MAX_PAGES,
  MAX_PDF_BYTES,
  PDF_REFUSAL_MESSAGES,
  type PdfRefusalReason,
  refusedBeforeReading,
} from "./refusals";

/** The PDFs the spike made in other tools: Chrome's print and macOS's text system (decision 0051). */
const OTHER_DIR = fileURLToPath(
  new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url),
);
const OTHER = readdirSync(OTHER_DIR).sort();
const otherPdf = (name: string) =>
  new Uint8Array(readFileSync(join(OTHER_DIR, name, "resume.pdf")));

const read = (result: PdfReading): ReadPdf => {
  if (isPdfRefusal(result)) throw new Error(`refused: ${result.reason}`);
  return result;
};

/** Every run's text, joined, without spaces or case: what a check that a word was read looks in. */
const flat = (pdf: ReadPdf) =>
  pdf.pages
    .flatMap((page) => page.runs.map((run) => run.text))
    .join("")
    .replace(/\s/g, "")
    .toLowerCase();

/** What every reading holds, whatever made the PDF: runs and links that sit on their page. */
function expectWellFormed(pdf: ReadPdf, what: string) {
  expect(pdf.pages.length, what).toBeGreaterThan(0);
  for (const page of pdf.pages) {
    expect(page.runs.length, `${what} p${page.number}`).toBeGreaterThan(0);
    for (const run of page.runs) {
      expect(run.text.trim(), what).toBe(run.text);
      expect(run.text, what).not.toBe("");
      expect(run.size, what).toBeGreaterThan(0);
      expect(run.width, what).toBeGreaterThanOrEqual(0);
      expect(run.font, what).not.toBe("");
      expect(run.x, `${what}: ${run.text}`).toBeGreaterThanOrEqual(-1);
      expect(run.x, `${what}: ${run.text}`).toBeLessThanOrEqual(page.width + 1);
      expect(run.baseline, `${what}: ${run.text}`).toBeGreaterThanOrEqual(0);
      expect(run.baseline, `${what}: ${run.text}`).toBeLessThanOrEqual(page.height + 1);
    }
    for (const link of page.links) {
      expect(linkAddress(link.url), what).toBeDefined();
      expect(link.x0, what).toBeLessThan(link.x1);
      expect(link.y0, what).toBeLessThan(link.y1);
    }
  }
}

describe("the PDF reader", () => {
  it("reads runs with their position, size, font and weight, links and drawn marks", async () => {
    const pdf = minimalPdf([
      {
        texts: [
          { x: 72, y: 80, size: 20, text: "Wren Halloway", font: "Helvetica-Bold" },
          { x: 72, y: 110, size: 10, text: "wren@example.com", font: "Helvetica-Oblique" },
        ],
        rects: [
          { x: 72, y: 120, width: 400, height: 1 },
          { x: 60, y: 140, width: 3, height: 3 },
        ],
        links: [{ x: 70, y: 100, width: 90, height: 14, url: "mailto:wren@example.com" }],
      },
    ]);
    const { pages } = read(await readPdf(pdf));
    expect(pages).toHaveLength(1);
    const [page] = pages;
    expect(page).toMatchObject({ number: 1, width: 612, height: 792 });
    expect(page?.runs.map((run) => run.text)).toEqual(["Wren Halloway", "wren@example.com"]);
    const [name, email] = page?.runs ?? [];
    expect(name).toMatchObject({ x: 72, baseline: 80, size: 20, bold: true, italic: false });
    expect(name?.font).toBe("Helvetica-Bold");
    expect(email).toMatchObject({ bold: false, italic: true, font: "Helvetica-Oblique" });
    expect(page?.links).toEqual([
      { x0: 70, y0: 100, x1: 160, y1: 114, url: "mailto:wren@example.com" },
    ]);
    expect(page?.marks.map((mark) => mark.kind).sort()).toEqual(["dot", "rule"]);
  }, 60_000);

  it.each(OTHER)(
    "reads %s, a resume made in another tool",
    async (name) => {
      const pdf = read(await readPdf(otherPdf(name)));
      expectWellFormed(pdf, name);
      // The truth is the resume the PDF was made from, written down as it was made.
      const { header } = JSON.parse(readFileSync(join(OTHER_DIR, name, "truth.json"), "utf8")) as {
        header: { name: { first: string; last: string }; email: string; links: { href: string }[] };
      };
      const { first, last } = header.name;
      expect(flat(pdf), name).toContain(`${first}${last}`.replace(/\s/g, "").toLowerCase());
      expect(
        pdf.pages.some((page) => page.runs.some((run) => run.bold)),
        name,
      ).toBe(true);
      // Chrome keeps a page's links in its PDF, and each is read with its address; AppKit's text
      // system, as these were printed, keeps none.
      const urls = pdf.pages.flatMap((page) =>
        page.links.map((link) => link.url.replace(/\/$/, "")),
      );
      if (name.startsWith("chrome-")) {
        expect(urls, name).toContain(`mailto:${header.email}`);
        for (const { href } of header.links) expect(urls, `${name}: ${href}`).toContain(href);
      } else expect(urls, name).toEqual([]);
    },
    60_000,
  );

  it("reads a resume Chrome printed, its bold name, its links and the dots of its bullets", async () => {
    const { pages } = read(await readPdf(otherPdf("chrome-one-column")));
    const runs = pages.flatMap((page) => page.runs);
    expect(runs.find((run) => run.text === "Teodor Amsel")).toMatchObject({ bold: true });
    expect(pages[0]?.links.map((link) => link.url)).toContain("mailto:teodor.amsel@example.com");
    expect(pages[0]?.marks.filter((mark) => mark.kind === "dot").length).toBeGreaterThan(3);
  }, 60_000);

  it("tells weights and slants from fonts' names, TeX's among them", () => {
    expect(fontName("ABCDEF+LMRoman10-Bold")).toBe("LMRoman10-Bold");
    for (const bold of ["LMRoman10-Bold", "SourceSansPro-Semibold", "CMBX10", "Roboto-Black"])
      expect(boldName(bold), bold).toBe(true);
    for (const regular of ["LMRoman10-Regular", "Lato-Regular", "CMR10", "Georgia"])
      expect(boldName(regular), regular).toBe(false);
    for (const italic of [
      "LMRoman10-Italic",
      "CMTI10",
      "Helvetica-Oblique",
      "SourceSansPro-LightIt",
    ])
      expect(italicName(italic), italic).toBe(true);
    expect(italicName("LMRomanCaps10-Regular")).toBe(false);
  });

  it("keeps a link only to a web, mail or phone address", async () => {
    expect(linkAddress("https://example.com/in/wren")).toBe("https://example.com/in/wren");
    expect(linkAddress("mailto:wren@example.com")).toBe("mailto:wren@example.com");
    expect(linkAddress("tel:+15550100")).toBe("tel:+15550100");
    // A bare domain, as some programs write one, is a web address.
    expect(linkAddress("example.com/in/wren")).toBe("https://example.com/in/wren");
    expect(linkAddress("www.example.org")).toBe("https://www.example.org");
    for (const kept of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>hi</b>",
      "file:///etc/hosts",
      "vbscript:msgbox",
      "\\\\server\\share\\notes.pdf",
      "../notes.pdf",
      "#page=2",
      "https://exa mple.com",
      "https://example.com/\u0000",
      `https://example.com/${"a".repeat(3000)}`,
      "",
    ])
      expect(linkAddress(kept), kept).toBeUndefined();
    const pdf = minimalPdf([
      {
        texts: [{ x: 72, y: 80, size: 12, text: "Invented links of every kind, for the reader" }],
        links: [
          { x: 70, y: 70, width: 90, height: 14, url: "javascript:alert(1)" },
          { x: 70, y: 90, width: 90, height: 14, url: "https://example.com/wren" },
          { x: 70, y: 110, width: 90, height: 14, url: "file:///etc/hosts" },
        ],
      },
    ]);
    const { pages } = read(await readPdf(pdf));
    expect(pages[0]?.links.map((link) => link.url)).toEqual(["https://example.com/wren"]);
  }, 60_000);
});

describe("the PDF reader's refusals", () => {
  const refusal = async (bytes: Uint8Array, reason: PdfRefusalReason) => {
    const result = await readPdf(bytes);
    expect(result).toEqual({ refused: true, reason, message: PDF_REFUSAL_MESSAGES[reason] });
    return result;
  };

  it("says each refusal in plain English, never naming the reader or its errors", () => {
    for (const message of Object.values(PDF_REFUSAL_MESSAGES)) {
      expect(message).toMatch(/^This (file|PDF) /);
      expect(message).not.toMatch(/pdf\.?js|exception|error|worker|undefined|null|\\/i);
    }
  });

  it("refuses a file that is not a PDF", async () => {
    const text = new TextEncoder().encode("Invented notes, not a PDF at all.");
    expect(looksLikePdf(text)).toBe(false);
    await refusal(text, "not-pdf");
    // A picture named as a PDF is refused by its first bytes, before the reader loads.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(refusedBeforeReading(png)).toMatchObject({ reason: "not-pdf" });
    await refusal(new Uint8Array(), "not-pdf");
    // One that begins as a PDF and is not one is refused too, never thrown.
    const broken = new TextEncoder().encode("%PDF-1.4\nnothing else");
    const result = await readPdf(broken);
    expect(isPdfRefusal(result)).toBe(true);
    // A PDF's header a little way in, as some programs write one, still reads.
    const padded = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented and late" }] }]);
    const late = new Uint8Array(padded.length + 3);
    late.set(new TextEncoder().encode("\n\n\n"));
    late.set(padded, 3);
    expect(looksLikePdf(late)).toBe(true);
  }, 60_000);

  it("refuses a PDF locked with a password", async () => {
    const pdf = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented and locked" }] }], {
      locked: true,
    });
    await refusal(pdf, "password");
  }, 60_000);

  it("refuses a PDF with no text, as a scan has", async () => {
    await refusal(minimalPdf([{ rects: [{ x: 50, y: 50, width: 500, height: 700 }] }]), "no-text");
    // A few characters, a page number or a mark, are not a resume's text either.
    await refusal(minimalPdf([{ texts: [{ x: 300, y: 770, size: 9, text: "1 / 1" }] }]), "no-text");
  }, 60_000);

  it("refuses a PDF past the size cap before it parses it", async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-1.4\n"));
    expect(refusedBeforeReading(big)).toMatchObject({ reason: "too-large" });
    await refusal(big, "too-large");
  });

  it("refuses a PDF past the page cap", async () => {
    const page = {
      texts: [{ x: 72, y: 80, size: 12, text: "An invented page of a long document" }],
    };
    await refusal(minimalPdf(Array.from({ length: MAX_PAGES + 1 }, () => page)), "too-large");
    // At the cap, it reads.
    const atCap = read(await readPdf(minimalPdf(Array.from({ length: MAX_PAGES }, () => page))));
    expect(atCap.pages).toHaveLength(MAX_PAGES);
  }, 60_000);

  it("takes a file as a PDF by its name or its type", () => {
    expect(isPdfFile({ name: "resume.PDF" })).toBe(true);
    expect(isPdfFile({ name: "resume", type: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "resume.tex", type: "text/x-tex" })).toBe(false);
    expect(isPdfFile({ name: "resume.pdf.zip" })).toBe(false);
  });
});

describe("reading a PDF makes no network request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the PDFs of other tools and one that wants a standard font, sending nothing", async () => {
    const asked = vi.fn((what: string) => {
      throw new Error(`The reader asked the network: ${what}`);
    });
    vi.stubGlobal("fetch", (url: unknown) => asked(`fetch ${String(url)}`));
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        open(_method: string, url: string) {
          asked(`XMLHttpRequest ${url}`);
        }
      },
    );
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor(url: string) {
          asked(`WebSocket ${url}`);
        }
      },
    );
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          asked(`EventSource ${url}`);
        }
      },
    );
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      sendBeacon: (url: string) => asked(url),
    });
    const sockets = vi.spyOn(net.Socket.prototype, "connect");
    const requests = [vi.spyOn(http, "request"), vi.spyOn(https, "request")];
    // pdf.js asks for the data it keeps outside itself, here the standard font Helvetica's, and is
    // told there is none: it reads on without it.
    const outside = vi.spyOn(NothingFetched.prototype, "fetch");
    const standard = minimalPdf([
      {
        texts: [
          { x: 72, y: 80, size: 20, text: "Wren Halloway", font: "Helvetica-Bold" },
          {
            x: 72,
            y: 110,
            size: 10,
            text: "An invented line in a standard font",
            font: "Times-Roman",
          },
        ],
        links: [{ x: 70, y: 100, width: 90, height: 14, url: "https://example.com/wren" }],
      },
    ]);
    expect(flat(read(await readPdf(standard)))).toContain("wrenhalloway");
    expect(outside).toHaveBeenCalled();
    await expect(outside.mock.results[0]?.value).rejects.toThrow(/fetches nothing/);
    for (const name of OTHER) read(await readPdf(otherPdf(name)));
    // And a refusal sends nothing either.
    expect(
      await readPdf(
        minimalPdf([{ texts: [{ x: 1, y: 1, size: 9, text: "x" }] }], { locked: true }),
      ),
    ).toMatchObject({ reason: "password" });
    expect(asked).not.toHaveBeenCalled();
    expect(sockets).not.toHaveBeenCalled();
    for (const request of requests) expect(request).not.toHaveBeenCalled();
  }, 60_000);
});

describe.skipIf(!engineAvailable())("reading the PDFs the built-in templates make", () => {
  /** Each built-in template's PDF of its own invented sample, as the editor exports one. */
  const made = new Map<string, Uint8Array>();

  beforeAll(async () => {
    const session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    for (const { package: pkg, sample } of CURATED.values()) {
      const values = defaultControls(pkg);
      const files = fontFiles(pkg);
      const covers = files.length === 0 ? undefined : (await fonts.coverage(files)).covers;
      const format = generateFormat(pkg, values);
      expect(session.dump(pkg.engine, format.name, format.preamble, format.files).ok).toBe(true);
      const body = generateBody(pkg, sample, values, covers === undefined ? {} : { covers });
      const job = `read-${pkg.id}`;
      const result = session.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 });
      expect(result.ok, pkg.id).toBe(true);
      const pdf = session.pdf(job);
      if (!pdf.ok || pdf.pdf === undefined) throw new Error(`${pkg.id} made no PDF: ${pdf.error}`);
      made.set(pkg.id, pdf.pdf);
    }
  }, 120_000);

  it.each([...CURATED.keys()])(
    "reads %s's PDF of its sample",
    async (id) => {
      const bytes = made.get(id);
      if (bytes === undefined) throw new Error(`${id} made no PDF`);
      const { sample } = CURATED.get(id) ?? {};
      if (sample === undefined) throw new Error(`no sample for ${id}`);
      const pdf = read(await readPdf(bytes));
      expectWellFormed(pdf, id);
      const runs = pdf.pages.flatMap((page) => page.runs);
      // The sample's name, its sections' titles and its bullets are read, in the template's fonts.
      const text = flat(pdf);
      expect(text, id).toContain(sample.header.name.last.replace(/\s/g, "").toLowerCase());
      for (const section of sample.sections)
        expect(text, `${id}: ${section.title}`).toContain(
          section.title.replace(/\s/g, "").toLowerCase(),
        );
      expect(
        runs.some((run) => run.bold),
        id,
      ).toBe(true);
      expect(new Set(runs.map((run) => run.size)).size, id).toBeGreaterThan(1);
      expect(new Set(runs.map((run) => run.font)).size, id).toBeGreaterThan(1);
      // The sample's email is a link, with its address.
      const urls = pdf.pages.flatMap((page) => page.links.map((link) => link.url));
      if (sample.header.email) expect(urls, id).toContain(`mailto:${sample.header.email}`);
      expect(urls.length, id).toBeGreaterThan(0);
    },
    60_000,
  );
});
