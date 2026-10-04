// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  browserConsent,
  CONSENT_DETAIL,
  CONSENT_KEY,
  CONSENT_NO,
  CONSENT_QUESTION,
  CONSENT_YES,
  type ConsentStore,
  SENDING_NOTICE,
  SETTING_LABEL,
} from "../pdf/consent";
import { labelLines } from "../pdf/label";
import { layOut } from "../pdf/layout";
import { type FetchLike, modelLabeller } from "../pdf/model-labeller";
import type { ReadPdf } from "../pdf/read";
import { DocumentList } from "./DocumentList";
import { PdfReadingQuestion, PdfSendingNotice, usePdfConsent } from "./PdfReading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The question, the setting and the notice as a person meets them, each tied to what the model's
// labeller then sends; every text here is invented.

/** An invented PDF's page, laid out. */
const read: ReadPdf = {
  pages: [
    {
      number: 1,
      width: 612,
      height: 792,
      runs: [
        {
          text: "Ilse Marrowind",
          x: 200,
          baseline: 60,
          size: 22,
          width: 150,
          font: "Invented-Bold",
          bold: true,
          italic: false,
        },
        {
          text: "Glassblower",
          x: 50,
          baseline: 140,
          size: 10,
          width: 60,
          font: "Invented-Regular",
          bold: false,
          italic: false,
        },
      ],
      links: [],
      marks: [],
    },
  ],
  ms: 0,
};
const layout = layOut(read);

/** A `fetch` standing in for the reading service, counting what is sent to it. */
function counting() {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(input);
    return new Response(JSON.stringify({ roles: layout.lines.map(() => "running text") }), {
      status: 200,
    });
  };
  return { fetch, calls };
}

/** The documents screen with its setting, as the app wires it to the kept answer. */
function Screen({ store }: { store: ConsentStore }) {
  const [consent, setConsent] = usePdfConsent(store);
  return (
    <DocumentList
      documents={[]}
      onOpen={() => {}}
      onNew={() => {}}
      onDelete={() => {}}
      onImport={() => {}}
      pdfReading={{ consent, onChange: setConsent }}
    />
  );
}

describe("asking, remembering and changing whether a PDF's text is sent", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });

  const buttonNamed = (text: string) => {
    const found = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === text,
    );
    if (found === undefined) throw new Error(`no button ${text}`);
    return found;
  };

  const setting = () => {
    const box = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (input) => input.closest("label")?.textContent?.includes(SETTING_LABEL),
    );
    if (box === undefined) throw new Error("no setting");
    return box;
  };

  it("nothing is sent to the model before a yes, and the question says what is sent and kept", async () => {
    const store = browserConsent();
    const answers: string[] = [];
    act(() =>
      root.render(
        <PdfReadingQuestion
          onAnswer={(answer) => {
            store.set(answer);
            answers.push(answer);
          }}
        />,
      ),
    );
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(CONSENT_QUESTION);
    expect(dialog?.textContent).toContain(CONSENT_DETAIL);
    // What the person reads names who receives the text, and what the editor's service keeps.
    expect(dialog?.textContent).toContain("passes the lines to a hosted language model");
    expect(dialog?.textContent).toContain("The editor's service keeps none of your text");
    const { fetch, calls } = counting();
    const labeller = modelLabeller({ consent: store, fetch });
    // Asked, not yet answered: nothing is sent.
    expect((await labelLines(layout, labeller)).fallback).toBe("no consent");
    // Answered no: nothing is sent, and the answer is kept in this browser.
    act(() => buttonNamed(CONSENT_NO).click());
    expect(localStorage.getItem(CONSENT_KEY)).toBe("no");
    expect((await labelLines(layout, labeller)).fallback).toBe("no consent");
    expect(calls).toHaveLength(0);
    // Answered yes: now, and only now, the lines are sent.
    act(() => buttonNamed(CONSENT_YES).click());
    expect(answers).toEqual(["no", "yes"]);
    expect((await labelLines(layout, labeller)).by).toBe("model");
    expect(calls).toEqual(["/v1/label"]);
  });

  it("nothing is sent after the setting is turned off", async () => {
    browserConsent().set("yes");
    act(() => root.render(<Screen store={browserConsent()} />));
    expect(setting().checked).toBe(true);
    const { fetch, calls } = counting();
    const labeller = modelLabeller({ consent: browserConsent(), fetch });
    expect((await labelLines(layout, labeller)).by).toBe("model");
    expect(calls).toHaveLength(1);
    // The person turns the setting off on the documents screen.
    act(() => setting().click());
    expect(setting().checked).toBe(false);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("no");
    expect(await labelLines(layout, labeller)).toMatchObject({
      by: "rules",
      fallback: "no consent",
    });
    expect(calls).toHaveLength(1);
    // And on again.
    act(() => setting().click());
    expect(localStorage.getItem(CONSENT_KEY)).toBe("yes");
    expect((await labelLines(layout, labeller)).by).toBe("model");
    expect(calls).toHaveLength(2);
  });

  it("shows the setting off while no answer is kept, and says in one line that an import sends", () => {
    act(() => root.render(<Screen store={browserConsent()} />));
    expect(setting().checked).toBe(false);
    act(() => root.render(<PdfSendingNotice />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe(SENDING_NOTICE);
  });
});
