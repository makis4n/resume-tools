// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageFile } from "../import/bridge";
import { refusal } from "../import/refusal";
import { LOCK_WHY, type Report } from "../import/report";
import {
  CONSENT_NO,
  CONSENT_QUESTION,
  CONSENT_YES,
  type ConsentStore,
  memoryConsent,
} from "../pdf/consent";
import type { FetchLike } from "../pdf/model-labeller";
import type { ReadPdf, TextRun } from "../pdf/read";
import { DocumentStore } from "../storage/store";
import { DocumentList, PDF_OFFER, PDF_OFFER_PICK } from "./DocumentList";
import { MOVE, MOVE_OFFER } from "./ImportReport";
import { CREATE, PdfReview } from "./PdfReview";
import { usePdfImport } from "./pdf-import";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The bridge between the two ways in (milestone 3 second pass, item 16), as a person meets it: a
// refused `.tex` offers to import a PDF of the same resume, and a partial one under the bar offers
// to move its content onto a built-in template, each through the ordinary PDF import, its question
// and its setting. The engine's PDF of the page, the reader and the reading service stand in;
// every word here is invented.

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

/** What the reader reads of the page's PDF: an invented resume. */
const READ: ReadPdf = {
  pages: [
    {
      number: 1,
      width: 612,
      height: 792,
      runs: [
        run("Tamsin Holloway", 60, 22, true),
        run("tamsin@example.invalid", 84),
        run("EXPERIENCE", 130, 12, true),
        run("Bookbinder, Sparrow Lane Bindery", 152, 10, true),
        run("2019 – 2024", 172),
        run("• Bound three hundred invented ledgers", 192),
      ],
      links: [],
      marks: [],
    },
  ],
  ms: 1,
};

/** An invented report of a partial import, at the share given. */
const partial = (rate: number): Report => ({
  outcome: "partial",
  rate,
  matched: true,
  words: {
    editable: Math.round(100 * rate),
    panel: 0,
    retype: 0,
    locked: 100 - Math.round(100 * rate),
    byReason: { unmapped: 100 - Math.round(100 * rate) },
    body: 100,
    template: 0,
  },
  locked: [{ words: "Invented words", count: 2, reason: "unmapped", why: LOCK_WHY.unmapped }],
  dropped: [],
  notes: [],
});

/** The invented bytes the engine's PDF of the page stands in with. */
const PAGE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const REFUSED = refusal("package", "inventedquillstyle");

interface Rig {
  consent: ConsentStore;
  store: DocumentStore;
  /** What the reader was given, by its bytes' length, and the requests the service got. */
  read: number[];
  sent: string[];
  created: string[];
  /** The partial import's report that waits, or the refusal the list's notice says. */
  start: { waiting: Report } | { refused: string };
}

function Screen({ rig }: { rig: Rig }) {
  const [waiting, setWaiting] = useState(
    "waiting" in rig.start ? rig.start.waiting : (undefined as Report | undefined),
  );
  const [notice, setNotice] = useState("refused" in rig.start ? rig.start.refused : undefined);
  const fetch: FetchLike = async (input) => {
    rig.sent.push(input);
    return new Response(JSON.stringify({ roles: [] }), { status: 200 });
  };
  const pdf = usePdfImport({
    consent: rig.consent,
    answer: (answer) => rig.consent.set(answer),
    read: async (bytes) => {
      rig.read.push(bytes.length);
      return READ;
    },
    fetch,
    open: () => {},
    update: () => {},
    create: (template, resume) => rig.store.create(template, resume),
    created: (id) => rig.created.push(id),
    notice: setNotice,
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
      onImport={() => {}}
      {...(pdf.importing === undefined ? {} : { importing: pdf.importing })}
      {...(pdf.state.step === "asking"
        ? { pdfQuestion: { onAnswer: pdf.answerQuestion, onCancel: pdf.cancel } }
        : {})}
      {...(notice !== undefined && notice === REFUSED.message
        ? { pdfOffer: { onChoose: (file: File) => pdf.start(file) } }
        : {})}
      {...(waiting === undefined
        ? {}
        : {
            waiting: {
              report: waiting,
              onContinue: () => setWaiting(undefined),
              onStop: () => setWaiting(undefined),
              // As the app moves it: the engine's PDF of the page, taken by the PDF import.
              onMove: () => {
                setWaiting(undefined);
                pdf.start(pageFile(PAGE, "cv.tex"));
              },
            },
          })}
    />
  );
}

describe("the bridge between the two ways in", () => {
  let host: HTMLElement;
  let root: Root;
  let rig: Rig;
  let names = 0;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    act(() => root.unmount());
    host.remove();
    await rig.store.close();
  });

  const shown = (start: Rig["start"], consent = memoryConsent()) => {
    rig = {
      consent,
      store: new DocumentStore({ name: `bridge-${++names}` }),
      read: [],
      sent: [],
      created: [],
      start,
    };
    act(() => root.render(<Screen rig={rig} />));
  };
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((each) => each.textContent === text);
  const settle = async () => {
    for (let i = 0; i < 40; i++) await act(async () => new Promise((done) => setTimeout(done, 5)));
  };
  const click = async (element: HTMLElement | undefined) => {
    if (element === undefined) throw new Error("nothing to click");
    await act(async () => element.click());
    await settle();
  };
  const review = () => host.querySelector("h1")?.textContent?.startsWith("Review") === true;
  const offerPicker = () =>
    [...host.querySelectorAll("label")]
      .find((label) => label.textContent?.startsWith(PDF_OFFER_PICK))
      ?.querySelector<HTMLInputElement>('input[type="file"]');

  it("offers a refused .tex its PDF, which goes through the PDF import, nothing sent on a no", async () => {
    shown({ refused: REFUSED.message });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(REFUSED.message);
    expect(host.textContent).toContain(PDF_OFFER);
    expect(host.textContent).not.toContain(MOVE_OFFER);
    const picker = offerPicker();
    if (picker === undefined || picker === null) throw new Error("no offer's picker");
    expect(picker.accept).toBe(".pdf,application/pdf");
    const own = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "orla.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(picker, "files", { value: [own], configurable: true });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    expect(host.textContent).toContain(CONSENT_QUESTION);
    await click(button(CONSENT_NO));
    expect(review()).toBe(true);
    expect(rig.read).toEqual([own.size]);
    expect(rig.sent).toEqual([]);
    await click(button(CREATE));
    expect((await rig.store.list()).map((each) => each.template)).toEqual(["jake"]);
  });

  it("offers an import under the bar the move, which ends in a document of a built-in template", async () => {
    shown({ waiting: partial(0.72) });
    expect(host.textContent).toContain(MOVE_OFFER);
    expect(host.textContent).not.toContain(PDF_OFFER);
    await click(button(MOVE));
    // The same question as any PDF's, asked once: a no reads the page by rules and sends nothing.
    expect(host.textContent).toContain(CONSENT_QUESTION);
    await click(button(CONSENT_NO));
    expect(rig.consent.get()).toBe("no");
    expect(review()).toBe(true);
    expect(rig.read).toEqual([PAGE.length]);
    expect(rig.sent).toEqual([]);
    await click(button(CREATE));
    expect(rig.created).toHaveLength(1);
    const stored = await rig.store.get(rig.created[0] as string);
    expect(stored?.document.template).toBe("jake");
    expect(stored?.document.resume.header.name).toEqual({ first: "Tamsin", last: "Holloway" });
  });

  it("moves under a yes on record without asking, and sends the page's text as a PDF's", async () => {
    shown({ waiting: partial(0.5) }, memoryConsent("yes"));
    await click(button(MOVE));
    expect(host.textContent).not.toContain(CONSENT_QUESTION);
    expect(button(CONSENT_YES)).toBeUndefined();
    expect(review()).toBe(true);
    expect(rig.sent).toEqual(["/v1/label"]);
  });

  it("offers no move at the bar or over it, nor anything to a refusal it was not given", async () => {
    shown({ waiting: partial(0.9) });
    expect(host.textContent).not.toContain(MOVE_OFFER);
    expect(button(MOVE)).toBeUndefined();
    expect(button("Continue")).toBeDefined();
    act(() => root.unmount());
    await rig.store.close();
    root = createRoot(host);
    shown({ refused: "The files could not be read." });
    expect(host.textContent).not.toContain(PDF_OFFER);
    expect(offerPicker()).toBeUndefined();
  });
});
