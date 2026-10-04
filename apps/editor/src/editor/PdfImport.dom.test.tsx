// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONSENT_NO,
  CONSENT_QUESTION,
  CONSENT_YES,
  type ConsentStore,
  memoryConsent,
  SENDING_NOTICE,
} from "../pdf/consent";
import type { Features, Role } from "../pdf/label";
import type { FetchLike } from "../pdf/model-labeller";
import type { PdfReading, ReadPdf, TextRun } from "../pdf/read";
import { DocumentStore } from "../storage/store";
import type { TemplatePackage } from "../templates/package";
import { DocumentList } from "./DocumentList";
import type { Document } from "./document";
import { usePdfConsent } from "./PdfReading";
import { CANCEL, CONTENT_NOT_LOOK, CREATE, FLAGS_TITLE, PdfReview } from "./PdfReview";
import { type PdfImportDeps, usePdfImport } from "./pdf-import";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A PDF's import as a person meets it, through the same hook, list and review the app shows, with
// the reader, the reading service and the compiler standing in; every text here is invented.

const run = (text: string, baseline: number, size = 10, bold = false): TextRun => ({
  text,
  x: 50,
  baseline,
  size,
  width: text.length * size * 0.5,
  font: bold ? "Invented-Bold" : "Invented-Regular",
  bold,
  italic: false,
});

/** What the reading service answers for each invented line, by its text. */
const ROLE_OF: Record<string, Role> = {
  "Ilse Marrowind": "name",
  "ilse@example.com": "contact",
  EXPERIENCE: "section heading",
  "Glassblower, Fennick Works": "entry head",
  "Whenever the kilns allow": "date",
  "Blew forty invented vases a day": "bullet",
};

const READ: ReadPdf = {
  pages: [
    {
      number: 1,
      width: 612,
      height: 792,
      runs: [
        run("Ilse Marrowind", 60, 22, true),
        run("ilse@example.com", 84),
        run("EXPERIENCE", 130, 12, true),
        run("Glassblower, Fennick Works", 152, 10, true),
        run("Whenever the kilns allow", 172),
        run("Blew forty invented vases a day", 192),
      ],
      links: [],
      marks: [],
    },
  ],
  ms: 1,
  pictures: [new Blob(["an invented picture"], { type: "image/png" })],
};

/** The reading service, answering the roles above and counting what is sent to it. */
function service() {
  const calls: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push(input);
    const { lines } = JSON.parse(String(init.body)) as { lines: Features[] };
    const roles = lines.map((line) => ROLE_OF[line.text] ?? "running text");
    return new Response(JSON.stringify({ roles }), { status: 200 });
  };
  return { fetch, calls };
}

interface Rig {
  consent: ConsentStore;
  fetch: FetchLike;
  read: PdfImportDeps["read"];
  store: DocumentStore;
  opened: { template: string; doc: Document }[];
  created: string[];
  revoked: string[];
}

function Screen({ rig }: { rig: Rig }) {
  const [answer, setAnswer] = usePdfConsent(rig.consent);
  const [notice, setNotice] = useState<string>();
  const pdf = usePdfImport({
    consent: rig.consent,
    answer: setAnswer,
    read: rig.read,
    fetch: rig.fetch,
    open: (pkg: TemplatePackage, doc) => rig.opened.push({ template: pkg.id, doc }),
    update: () => {},
    create: (template, resume) => rig.store.create(template, resume),
    created: (id) => rig.created.push(id),
    notice: setNotice,
    pictureUrl: () => "blob:invented-page",
    revokeUrl: (url) => rig.revoked.push(url),
  });
  if (pdf.state.step === "review")
    return (
      <PdfReview
        review={pdf.state.review}
        onTemplate={pdf.pickTemplate}
        onCommand={pdf.command}
        onSeal={pdf.seal}
        onCreate={pdf.create}
        onCancel={pdf.cancel}
      />
    );
  return (
    <DocumentList
      documents={[]}
      {...(notice === undefined ? {} : { notice })}
      onOpen={() => {}}
      onNew={() => {}}
      onDelete={() => {}}
      onImport={(files) => {
        const [file] = files;
        if (file !== undefined) pdf.start(file);
      }}
      {...(pdf.importing === undefined ? {} : { importing: pdf.importing })}
      onCancelImport={pdf.cancel}
      pdfReading={{ consent: answer, onChange: setAnswer }}
      {...(pdf.state.step === "asking"
        ? { pdfQuestion: { onAnswer: pdf.answerQuestion, onCancel: pdf.cancel } }
        : {})}
    />
  );
}

describe("importing a resume from a PDF, through the review", () => {
  let host: HTMLElement;
  let root: Root;
  let rig: Rig;
  let names = 0;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const { fetch, calls } = service();
    rig = {
      consent: memoryConsent(),
      fetch,
      read: async () => READ,
      store: new DocumentStore({ name: `pdf-import-${++names}` }),
      opened: [],
      created: [],
      revoked: [],
    };
    sent = calls;
    act(() => root.render(<Screen rig={rig} />));
  });

  let sent: string[] = [];

  afterEach(async () => {
    act(() => root.unmount());
    host.remove();
    await rig.store.close();
  });

  const button = (text: string) => {
    const found = [...host.querySelectorAll("button")].find((each) => each.textContent === text);
    if (found === undefined) throw new Error(`no button ${text}`);
    return found;
  };
  const dialog = () => host.querySelector('[role="dialog"]');
  const review = () => host.querySelector("h1")?.textContent?.startsWith("Review") === true;

  /** Choose a PDF in the documents screen's picker, and let what follows settle. */
  const choose = async (name = "invented.pdf") => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no picker");
    expect(input.accept.split(",")).toContain(".pdf");
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
      type: "application/pdf",
    });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  };
  /** Let the steps under way run: the reading, the pipeline's first load, the labelling. */
  const settle = async () => {
    for (let i = 0; i < 40; i++) await act(async () => new Promise((done) => setTimeout(done, 5)));
  };
  const click = async (element: HTMLElement) => {
    await act(async () => element.click());
    await settle();
  };

  it("asks once; with a yes the model reads the PDF, and later imports only say so", async () => {
    await choose();
    expect(dialog()?.textContent).toContain(CONSENT_QUESTION);
    expect(sent).toHaveLength(0);
    await click(button(CONSENT_YES));
    expect(rig.consent.get()).toBe("yes");
    expect(review()).toBe(true);
    expect(sent).toEqual(["/v1/label"]);
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/model/);
    expect(host.textContent).toContain(CONTENT_NOT_LOOK);
    // The review set the draft on the first built-in template, by the compiler.
    expect(rig.opened.map((each) => each.template)).toEqual(["jake"]);
    await click(button(CANCEL));
    expect(review()).toBe(false);
    expect(rig.revoked).toEqual(["blob:invented-page"]);
    // The second import asks nothing, and says in one line that the text is being sent.
    let finish: (reading: PdfReading) => void = () => {};
    rig.read = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await choose();
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain(SENDING_NOTICE);
    await act(async () => finish(READ));
    await settle();
    expect(review()).toBe(true);
    expect(sent).toHaveLength(2);
    expect(await rig.store.list()).toEqual([]);
  });

  it("with a no, sends nothing, and the review says the editor's rules read it", async () => {
    await choose();
    await click(button(CONSENT_NO));
    expect(rig.consent.get()).toBe("no");
    expect(review()).toBe(true);
    expect(sent).toHaveLength(0);
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/not sent/);
    expect(host.textContent).not.toContain(SENDING_NOTICE);
  });

  it("shows what was read in doubt first, beside the PDF's pages", async () => {
    rig.consent.set("yes");
    await choose();
    const headings = [...host.querySelectorAll("h2")].map((each) => each.textContent);
    expect(headings[0]).toBe(FLAGS_TITLE);
    const flagged = host.querySelector('[aria-label="Flagged"]');
    if (flagged === null) throw new Error(host.textContent ?? "");
    expect(flagged?.textContent).toContain("Whenever the kilns allow");
    expect(flagged?.textContent).toContain("Glassblower");
    const page = host.querySelector<HTMLImageElement>('img[alt="Page 1 of your PDF"]');
    expect(page?.getAttribute("src")).toBe("blob:invented-page");
  });

  it("creates an ordinary document of the template picked, with the corrections made", async () => {
    rig.consent.set("no");
    await choose();
    const altacv = host.querySelector<HTMLInputElement>('input[type="radio"][value="altacv"]');
    if (altacv === null) throw new Error("no AltaCV in the picker");
    await click(altacv);
    expect(rig.opened.map((each) => each.template)).toEqual(["jake", "altacv"]);
    // A correction in the panel, as the editor's own panel takes one: the phone the PDF lacked.
    const phone = [...host.querySelectorAll("label")]
      .find((label) => label.textContent?.startsWith("Phone"))
      ?.querySelector("input");
    if (phone === null || phone === undefined) throw new Error("no phone input");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(phone, "+46 70 000 00 00");
      phone.dispatchEvent(new Event("input", { bubbles: true }));
      phone.focus();
      phone.blur();
    });
    await settle();
    expect(await rig.store.list()).toEqual([]);
    await click(button(CREATE));
    expect(rig.created).toHaveLength(1);
    const [id] = rig.created;
    const stored = await rig.store.get(id as string);
    expect(stored?.document.template).toBe("altacv");
    expect(stored?.document.resume.header.name).toEqual({ first: "Ilse", last: "Marrowind" });
    expect(stored?.document.resume.header.phone).toBe("+46 70 000 00 00");
    expect(stored?.document.resume.sections.some((each) => each.kind === "entries")).toBe(true);
    expect((await rig.store.list()).map((each) => each.template)).toEqual(["altacv"]);
    // The import is over: the next PDF goes the same way, on the first template again.
    await choose();
    expect(review()).toBe(true);
    expect(rig.opened.at(-1)?.template).toBe("jake");
  });

  it("keeps nothing when cancelled at the question or during the reading", async () => {
    await choose();
    await click(button("Cancel"));
    expect(dialog()).toBeNull();
    expect(rig.consent.get()).toBeUndefined();
    rig.consent.set("yes");
    let stopped = false;
    rig.read = (_bytes, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          stopped = true;
          reject(new DOMException("stopped", "AbortError"));
        });
      });
    await choose();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Reading the PDF");
    await click(button("Cancel"));
    expect(stopped).toBe(true);
    expect(review()).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(sent).toHaveLength(0);
    expect(await rig.store.list()).toEqual([]);
  });

  it("refuses a PDF past the size cap before reading it, and one the reader refuses", async () => {
    rig.consent.set("no");
    let reads = 0;
    rig.read = async () => {
      reads++;
      return { refused: true, reason: "no-text", message: "This PDF has no text to read." };
    };
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    await act(async () => input?.dispatchEvent(new Event("change", { bubbles: true })));
    expect(reads).toBe(0);
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/^This /);
    await choose();
    expect(reads).toBe(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("This PDF has no text to read.");
    expect(await rig.store.list()).toEqual([]);
  });
});
