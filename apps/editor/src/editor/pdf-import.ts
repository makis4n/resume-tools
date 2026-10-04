/**
 * Importing a resume from a PDF (milestone 3 second pass, item 14): the way in from the documents
 * screen, which takes a PDF as it takes a `.tex`, and the review, where the person corrects what was
 * read, picks one of the built-in templates and creates the document, which is then an ordinary one
 * of that template. A PDF import promises the content, not the look.
 *
 * The steps, each of which Cancel ends with nothing stored:
 *
 * 1. The size check, before the file is read into memory (decision 0052).
 * 2. The first time, the question whether PDFs' text may be sent to the reading service
 *    (decision 0047, item 13), whose answer is kept in this browser; a Cancel here keeps no answer.
 * 3. The reading, in the reader's worker, which draws each page as a picture too, for the review.
 *    While the answer is yes, one line says the text is being sent.
 * 4. The resume, by `resumeOfPdf`, with the model's labeller, which reads the answer afresh and
 *    sends nothing without a yes; the rules answer otherwise, and the review says who read it.
 * 5. The review, its draft held in a history of its own and set on the template picked, by the
 *    engine, as the editor sets a document. Nothing of it is stored until "Create document".
 *
 * The flow is a hook so that the app and the tests drive the same code; what it needs from the app,
 * the reader, the store, the compiler and the kept answer, comes in `PdfImportDeps`.
 */

import type { Resume } from "@resume-tools/resume-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { isPdfRefusal, type PdfReading, refusedBySize } from "../pdf";
import type { ConsentStore, PdfConsent } from "../pdf/consent";
import type { FetchLike } from "../pdf/model-labeller";
import type { PdfResume } from "../pdf/resume";
import { CURATED, curated } from "../templates/curated";
import type { TemplatePackage } from "../templates/package";
import type { ImportShown } from "./DocumentList";
import { type Command, CommandError, type Document, History, newDocument } from "./document";

/** What the progress line says while a PDF is read and its lines are labelled. */
export const PDF_READING = "Reading the PDF";

/** What the user reads when the PDF chosen cannot be read from the disk. */
export const PDF_COULD_NOT_READ = "The PDF could not be read. Try choosing it again.";

/** What the user reads when the reader or the reading fails for a reason of the editor's. */
export const PDF_FAILED = "The import could not finish. Try again.";

/** What the user reads when the document read could not be kept. */
export const PDF_NOT_KEPT =
  "The document could not be kept in this browser. Check that the browser allows this site to store data, and try again.";

/** The template a review opens on, until the person picks another: the first built-in one. */
export const FIRST_TEMPLATE = "jake";

/** How many pixels a point the PDF's pages are drawn at, for a sharp picture at half that width. */
export const DRAW_SCALE = 1.5;

/** One of the PDF's pages as a picture: its address in the page, and its size in points. */
export interface PdfPicture {
  url: string;
  width: number;
  height: number;
}

/** A review under way: what was read, the PDF's pages, and the draft the person corrects. */
export interface Review {
  read: PdfResume;
  /** The PDF's pages drawn, in order; undefined when they could not be drawn. */
  pictures: PdfPicture[] | undefined;
  /** The draft, the resume read set on the template picked, as the person has corrected it. */
  document: Document;
  /** Whether "Create document" is keeping it, which takes no other step meanwhile. */
  creating: boolean;
  /** Why it could not be kept, when it could not. */
  notice?: string;
}

/** Where a PDF import is. */
export type PdfImportState =
  | { step: "idle" }
  | { step: "asking"; file: File }
  | { step: "reading"; sending: boolean }
  | { step: "review"; review: Review };

export interface PdfImportDeps {
  /** Where the answer is kept, read afresh at every step. */
  consent: ConsentStore;
  /** Keep an answer given to the question, as the documents screen's setting keeps one. */
  answer(answer: PdfConsent): void;
  /** Read a PDF: `readPdfFile`, which runs in the reader's worker, in the app. */
  read(bytes: Uint8Array, options: { signal: AbortSignal; drawScale: number }): Promise<PdfReading>;
  /** Stands in for the platform's `fetch`, for a test that counts what would be sent. */
  fetch?: FetchLike;
  /** Set a draft on its template: `Compiler.open` for a new template, `update` for an edit. */
  open(pkg: TemplatePackage, doc: Document): void;
  update(doc: Document): void;
  /** Store a new document of a built-in template, and give its id: `DocumentStore.create`. */
  create(template: string, resume: Resume): Promise<string>;
  /** The document created, which the app opens. */
  created(id: string): void;
  /** Say why the import stopped, in the documents screen's notice; undefined clears it. */
  notice(message: string | undefined): void;
  /** The locale a new document's page size follows, as a new document's does. */
  locale?: string;
  /** Make a picture's address, and let it go: `URL.createObjectURL` and its revoke, by default. */
  pictureUrl?(blob: Blob): string;
  revokeUrl?(url: string): void;
}

export interface PdfImport {
  state: PdfImportState;
  /** Whether a PDF import is under way, at any step, which takes no other import meanwhile. */
  busy: boolean;
  /** The progress line, while the PDF is read, and whether its text is being sent. */
  importing: ImportShown | undefined;
  /** Import this PDF. */
  start(file: File): void;
  /** The person's answer to the question. */
  answerQuestion(answer: PdfConsent): void;
  /** Stop at whatever step, keeping nothing. */
  cancel(): void;
  /** Set the draft on another built-in template, the person's corrections kept. */
  pickTemplate(id: string): void;
  /** A correction to the draft, as the editor's page and panel send one. */
  command(command: Command, group?: string): void;
  /** End a visit to a field, which ends its step. */
  seal(): void;
  /** Keep the draft as an ordinary document of its template, and open it. */
  create(): void;
}

const defaultUrl = (blob: Blob) => URL.createObjectURL(blob);
const defaultRevoke = (url: string) => URL.revokeObjectURL(url);

export function usePdfImport(deps: PdfImportDeps): PdfImport {
  const [state, setState] = useState<PdfImportState>({ step: "idle" });
  // The deps of the latest render, which the steps below read when they run.
  const latest = useRef(deps);
  latest.current = deps;
  /** The run under way: Cancel aborts it, and a step of a run no longer current does nothing. */
  const run = useRef<AbortController | undefined>(undefined);
  /** The draft's history while a review is up. */
  const history = useRef<History | undefined>(undefined);
  /** The pictures' addresses, let go when the review ends. */
  const urls = useRef<string[]>([]);

  const letGo = useCallback(() => {
    const revoke = latest.current.revokeUrl ?? defaultRevoke;
    for (const url of urls.current) revoke(url);
    urls.current = [];
    history.current = undefined;
  }, []);

  // The pictures go with the screen, should the app go away mid-review.
  useEffect(() => () => letGo(), [letGo]);

  const end = useCallback(
    (notice?: string) => {
      run.current?.abort();
      run.current = undefined;
      letGo();
      setState({ step: "idle" });
      latest.current.notice(notice);
    },
    [letGo],
  );

  const read = useCallback(
    async (file: File) => {
      const controller = new AbortController();
      run.current = controller;
      const current = () => run.current === controller;
      const { consent } = latest.current;
      setState({ step: "reading", sending: consent.get() === "yes" });
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        console.error("The PDF to import could not be read:", error);
        if (current()) end(PDF_COULD_NOT_READ);
        return;
      }
      if (!current()) return;
      let reading: PdfReading;
      let read: PdfResume;
      try {
        reading = await latest.current.read(bytes, {
          signal: controller.signal,
          drawScale: DRAW_SCALE,
        });
        if (!current()) return;
        if (isPdfRefusal(reading)) {
          end(reading.message);
          return;
        }
        // The steps after the reading load with the first PDF, as the reader does, and the
        // model's labeller reads the answer afresh, and sends nothing without a yes.
        const [{ resumeOfPdf }, { modelLabeller }] = await Promise.all([
          import("../pdf/resume"),
          import("../pdf/model-labeller"),
        ]);
        if (!current()) return;
        const { fetch } = latest.current;
        const labeller = modelLabeller({ consent, ...(fetch === undefined ? {} : { fetch }) });
        read = await resumeOfPdf(reading, { labeller, signal: controller.signal });
      } catch (error) {
        if (!current()) return;
        console.error("The PDF could not be imported:", error);
        end(PDF_FAILED);
        return;
      }
      if (!current()) return;
      const pictureUrl = latest.current.pictureUrl ?? defaultUrl;
      let pictures: PdfPicture[] | undefined;
      if (reading.pictures !== undefined && reading.pictures.length === reading.pages.length) {
        try {
          pictures = reading.pictures.map((blob, i) => {
            const url = pictureUrl(blob);
            urls.current.push(url);
            const page = reading.pages[i];
            return { url, width: page?.width ?? 612, height: page?.height ?? 792 };
          });
        } catch (error) {
          console.error("The PDF's pages could not be shown:", error);
          pictures = undefined;
        }
      }
      let document: Document;
      try {
        document = newDocument(FIRST_TEMPLATE, read.filed.resume, latest.current.locale);
      } catch (error) {
        console.error("The resume read from the PDF was refused:", error);
        end(PDF_FAILED);
        return;
      }
      // The reading is done: the review's draft is what holds the import from now on.
      run.current = undefined;
      history.current = new History(document, curated(FIRST_TEMPLATE).package);
      latest.current.notice(undefined);
      setState({ step: "review", review: { read, pictures, document, creating: false } });
      latest.current.open(curated(FIRST_TEMPLATE).package, document);
    },
    [end],
  );

  const start = useCallback(
    (file: File) => {
      if (run.current !== undefined || history.current !== undefined) return;
      const { consent, notice } = latest.current;
      notice(undefined);
      const tooLarge = refusedBySize(file.size);
      if (tooLarge) {
        notice(tooLarge.message);
        return;
      }
      if (consent.get() === undefined) {
        // A run of its own already, so that nothing else starts while the question is up.
        run.current = new AbortController();
        setState({ step: "asking", file });
        return;
      }
      void read(file);
    },
    [read],
  );

  const answerQuestion = useCallback(
    (answer: PdfConsent) => {
      if (state.step !== "asking") return;
      latest.current.answer(answer);
      run.current = undefined;
      void read(state.file);
    },
    [state, read],
  );

  /** The review's draft has a new present: shown, and set on its template. */
  const follow = useCallback((next: Document, opened: boolean) => {
    setState((now) =>
      now.step === "review"
        ? { step: "review", review: { ...now.review, document: next, notice: undefined } }
        : now,
    );
    if (opened) latest.current.open(curated(next.template).package, next);
    else latest.current.update(next);
  }, []);

  const pickTemplate = useCallback(
    (id: string) => {
      const draft = history.current;
      if (draft === undefined || !CURATED.has(id) || draft.present.template === id) return;
      if (state.step === "review" && state.review.creating) return;
      const document = newDocument(id, draft.present.resume, latest.current.locale);
      history.current = new History(document, curated(id).package);
      follow(document, true);
    },
    [state, follow],
  );

  const command = useCallback(
    (cmd: Command, group?: string) => {
      const draft = history.current;
      if (draft === undefined || (state.step === "review" && state.review.creating)) return;
      const before = draft.present;
      try {
        draft.dispatch(cmd, group);
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        console.warn("The template refused an edit:", error.message);
        return;
      }
      if (draft.present !== before) follow(draft.present, false);
    },
    [state, follow],
  );

  const seal = useCallback(() => history.current?.seal(), []);

  const create = useCallback(() => {
    const draft = history.current;
    if (draft === undefined || state.step !== "review" || state.review.creating) return;
    draft.seal();
    const { template, resume } = draft.present;
    setState({ step: "review", review: { ...state.review, creating: true, notice: undefined } });
    void latest.current.create(template, resume).then(
      (id) => {
        if (history.current !== draft) return;
        letGo();
        setState({ step: "idle" });
        latest.current.created(id);
      },
      (error: unknown) => {
        console.error("The document read from the PDF could not be kept:", error);
        if (history.current !== draft) return;
        setState((now) =>
          now.step === "review"
            ? { step: "review", review: { ...now.review, creating: false, notice: PDF_NOT_KEPT } }
            : now,
        );
      },
    );
  }, [state, letGo]);

  const cancel = useCallback(() => {
    // A document being kept is the person's already: it opens once it is.
    if (state.step === "idle" || (state.step === "review" && state.review.creating)) return;
    end();
  }, [state, end]);

  return {
    state,
    busy: state.step !== "idle",
    importing:
      state.step === "reading" ? { label: PDF_READING, sending: state.sending } : undefined,
    start,
    answerQuestion,
    cancel,
    pickTemplate,
    command,
    seal,
    create,
  };
}
