import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Controls } from "./editor/Controls";
import {
  COULD_NOT_MAKE_PDF,
  Compiler,
  type CompilerEvents,
  type ImportRun,
  type Shown,
} from "./editor/compiler";
import { DocumentList, type ImportShown } from "./editor/DocumentList";
import {
  type Command,
  CommandError,
  dropRefusedChoices,
  type Document as EditorDocument,
  FieldTooLong,
  History,
  REFUSED_STEP,
  TOO_LONG,
  UnitRefused,
} from "./editor/document";
import { pdfFileName, savePdf } from "./editor/download";
import { enterAdds } from "./editor/enter";
import { applyFit, type Fitted, fit } from "./editor/fit";
import { StructureGuard } from "./editor/guard";
import { ImportReport, offersMove } from "./editor/ImportReport";
import { Overlay } from "./editor/Overlay";
import { markerOf, outlineFields, outlineOf, unitPlace } from "./editor/outline";
import { lockedWordsOf, Panel, shownFieldsOf } from "./editor/Panel";
import { usePdfConsent } from "./editor/PdfReading";
import { PdfReview } from "./editor/PdfReview";
import { usePdfImport } from "./editor/pdf-import";
import { RetypeEditor, retypeEditorKey } from "./editor/RetypeEditor";
import {
  isRetype,
  namesOnPage,
  RETYPE_REFUSED,
  RetypeGuard,
  type RetypeVerdict,
  retypesOf,
} from "./editor/retype";
import { holdsTyping, useHistoryKeys, type Way } from "./editor/undo";
import { EngineCancelled, EngineClient } from "./engine/client";
import type { EngineManifest } from "./engine/manifest";
import { engineTag, fileUrl, manifestUrl } from "./engine/urls";
import { type PagePdf, pageFile } from "./import/bridge";
import type { Upload } from "./import/intake";
import { isRefusal } from "./import/refusal";
import { type Report, reportOfImport } from "./import/report";
import { IMPORT_STEPS, type Imported, type ImportJob, type ImportOutcome } from "./import/run";
import { FontLibrary } from "./page/fonts";
import { KEPT_TIPS, Pages } from "./page/Page";
import { TexLiveIndex } from "./page/texlive";
import { isPdfFile, readPdfFile } from "./pdf";
import { browserConsent } from "./pdf/consent";
import {
  CANNOT_OPEN,
  canLeave,
  DocumentRefused,
  DocumentStore,
  type Flushed,
  type Stored,
  type Summary,
} from "./storage/store";
import { curated } from "./templates/curated";
import type { TemplatePackage } from "./templates/package";
import { resolveTemplate, type Template } from "./templates/resolve";

/**
 * The editor as far as milestone 3 has come: the documents kept in this browser, and one of them
 * open at a time, whose page recompiles as it changes, which is saved after every command
 * (decision 0010), whose fields a click on the page opens in place (item 9), and whose changes
 * undo and redo a step at a time, a visit to a field being one step (item 12). A new document
 * starts from a curated template's sample, chosen in the list, and a resume the person already
 * has is imported there, on the same engine, while the list shows (milestone 3 item 12, decision
 * 0038); an imported document opens with its package from the store, as a curated one with its
 * own; and a locked part's words, where they are plain text, are retyped on its page and kept only
 * once the page outside it is as it was (milestone 3 item 16, decision 0042). Only the dev server
 * serves `/engine/` and the label route; hosting them is milestone 5, so
 * a production build keeps documents but shows the failure message for their pages until then.
 */

/** How long a compile may keep the page waiting before the message line says it is compiling. */
const MOMENT = 500;

/** What the user reads when the browser's storage fails; the details go to the console. */
const NO_STORAGE = "Documents cannot be read or kept in this browser.";

/** What the user reads while the open document's edits cannot be written; it stays open. */
const NOT_SAVED = "This document could not be saved in this browser.";

/** What the user reads once another tab has changed the open document. */
const CHANGED_ELSEWHERE = "This document was changed in another tab.";

/** What the user reads while a fit to one page runs, and when no setting it tries fits. */
const FITTING = "Fitting…";
const DOES_NOT_FIT = "It does not fit on one page at these settings.";

/**
 * What the user reads above the pages when a resume runs past one, with the fit to one page beside
 * it: every page is on screen (decision 0046), and the line says how many there are.
 */
function runsOnto(pages: number): string {
  return pages === 2
    ? "This resume runs onto a second page."
    : `This resume runs onto ${pages} pages.`;
}

/** What the user reads when a fit to one page could not finish; the details go to the console. */
const COULD_NOT_FIT = "Fit to one page could not finish.";

/**
 * What the user reads when a structural step stopped the page's compile, and was taken back: the
 * document is as it was before it, and nothing of it was saved (decision 0041).
 */
const TAKEN_BACK = "That change stopped the page from being made, so it was taken back.";

/** What the user reads when the files chosen to import cannot be read. */
const COULD_NOT_READ = "The files could not be read.";

/** What the user reads when an import fails for a reason of the editor's; the details go to the console. */
const IMPORT_FAILED = "The import could not finish. Try again.";

/** What the user reads when an import came through but the browser could not keep it. */
const COULD_NOT_KEEP = "The imported resume could not be kept in this browser.";

/**
 * What the progress line says while the bridge makes a PDF of a partial import's page, to move its
 * content onto a built-in template (milestone 3 second pass, item 16).
 */
const MOVE_STEP = "Making a PDF of your resume's pages";

/** What the user reads when no PDF of that page could be made; the details go to the console. */
const MOVE_NO_PDF =
  "This editor could not make a PDF of your resume's pages, so it cannot move its content. If you have a PDF of it, stop, and import that instead.";

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/**
 * The engine's tree as the main thread needs it: its tag, the fonts the page is drawn with, and
 * whether the tree has a file at a path, which is all the prefetch may fetch.
 */
async function loadTree(): Promise<{
  tag: string;
  fonts: FontLibrary;
  known: (path: string) => boolean;
}> {
  const manifest = (await (await get(manifestUrl())).json()) as EngineManifest;
  const tag = engineTag(manifest);
  const fonts = new FontLibrary(
    new TexLiveIndex(manifest),
    async (path) => new Uint8Array(await (await get(fileUrl(tag, path))).arrayBuffer()),
  );
  return { tag, fonts, known: (path) => Object.hasOwn(manifest.files, path) };
}

/**
 * Fetch a file into the HTTP cache, where the worker's synchronous reads will find it, and drop
 * it. The body is read to its end, since a response left unread may never finish reaching the
 * cache.
 */
async function fetchAhead(url: string): Promise<void> {
  await (await fetch(url)).arrayBuffer();
}

/**
 * A field opened on the page: the glyph clicked, as its field and the character in the field's
 * text it stands for, and which click it was, so that each click opens the field afresh.
 */
interface Click {
  field: string;
  offset: number;
  click: number;
}

/** The element the page is drawn in, which the overlay is placed in. */
const SHEET = { position: "relative" } as const;

/** The document open in the editor. */
interface Open {
  /** Its id in the store. */
  id: string;
  /** The revision it was read at, which its saves name, so none is written over another tab's. */
  revision: number;
  /**
   * Its template's package, whose rules its commands keep (decision 0026): what an imported
   * template requires and cannot take, which the history, the side panel and the controls follow.
   */
  pkg: TemplatePackage;
  /** An imported document's: what its compiles need beside the package (decision 0038). */
  job: ImportJob | undefined;
  /**
   * An imported document's locked parts' first words, by section, as its import's report names
   * them, which name their rows in the side panel (decision 0041); none for a curated one.
   */
  lockedWords: ReadonlyMap<string, string>;
  history: History;
  /** The history's present, as state, so that an edit renders. */
  present: EditorDocument;
  /**
   * Whether the history has a step to undo, and one to redo, as state, so that the buttons follow
   * it: a step that ends where it began is dropped when it ends (`History.seal`), which changes
   * what there is to undo and redo with no new present.
   */
  canUndo: boolean;
  canRedo: boolean;
  /** Whether another tab has changed it since it was read: it takes no edits until read again. */
  stale: boolean;
  /** Whether its newest save could not be written; it stays open until one is. */
  unsaved: boolean;
}

/**
 * An imported document's locked parts' first words, by section, as its import's report names them
 * (`lockedWordsOf`, decision 0041): none for a curated document, which keeps no part, nor where the
 * report cannot be read, when each part's row says it was kept as it was; why goes to the console.
 */
function lockedWordsFrom(
  template: Template,
  document: EditorDocument,
): ReadonlyMap<string, string> {
  if (template.report === undefined) return new Map();
  try {
    return lockedWordsOf(reportOfImport({ report: template.report, document }));
  } catch (error) {
    console.error("The import's report could not be read:", error);
    return new Map();
  }
}

/**
 * The open document after a flush: unsaved while its newest save is not written, and changed
 * elsewhere once one of its saves has met another tab's change.
 */
function afterFlush(open: Open, { failed, conflicts }: Flushed): Open {
  const unsaved = failed.includes(open.id);
  const stale = open.stale || conflicts.includes(open.id);
  return unsaved === open.unsaved && stale === open.stale ? open : { ...open, unsaved, stale };
}

export function App() {
  const store = useRef<DocumentStore | undefined>(undefined);
  const compiler = useRef<Compiler | undefined>(undefined);
  /** Counts requests to open a document, so that one overtaken by a later one is dropped. */
  const opening = useRef(0);
  /** The documents for the list, newest first; undefined until the store has listed them. */
  const [documents, setDocuments] = useState<Summary[]>();
  /** Why the list shows when a document was asked for, or what could not be done. */
  const [notice, setNotice] = useState<string>();
  const [open, setOpen] = useState<Open>();
  /** The latest page, and whether it is the one the document opened with. */
  const [shown, setShown] = useState<{ latest: Shown; opening: boolean }>();
  const [error, setError] = useState<string>();
  // The PDF's own message, apart from the compile error the page event clears: a failed PDF can
  // start a recompile (the compiler's losePdf), whose page would otherwise wipe the message before
  // it is read. It is cleared only when the next download starts or succeeds, or another document
  // opens, whose PDF it does not speak of; never by a page.
  const [pdfError, setPdfError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clicked, setClicked] = useState<Click>();
  const [downloading, setDownloading] = useState(false);
  /**
   * The fit to one page asked for last (item 18): the document it began on, as it stood, and what
   * it came to when it changed nothing; it runs while `note` is undefined. It is shown only while
   * that document is the present one, since an edit makes what it says moot.
   */
  const [fitting, setFitting] = useState<{ document: EditorDocument; note?: string }>();
  const clicks = useRef(0);
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  /** The TeX Live fonts the pages are drawn from, which a rich field's editor loads fonts from. */
  const [library, setLibrary] = useState<FontLibrary>();
  /** The import under way, as the list's progress line shows it (decision 0038). */
  const [importing, setImporting] = useState<ImportShown>();
  /** The import under way, which the list's Cancel stops; none once it has landed or stopped. */
  const importRun = useRef<Pick<ImportRun, "cancel"> | undefined>(undefined);
  /**
   * The refusal whose notice offers to import a PDF of the same resume instead (milestone 3 second
   * pass, item 16): the offer shows while the notice is that refusal's, and goes with it.
   */
  const [offerFor, setOfferFor] = useState<string>();
  /**
   * Whether a PDF's text may be sent to the reading service, kept in this browser, and the
   * documents screen's setting that changes it (milestone 3 second pass, item 13, decision 0047).
   */
  const consentStore = useMemo(() => browserConsent(), []);
  const [pdfConsent, setPdfConsent] = usePdfConsent(consentStore);
  /**
   * A PDF's import (milestone 3 second pass, item 14): the question the first time, the reading in
   * its worker, and the review, whose draft the compiler sets on the template picked while the list
   * is down. Nothing of it is stored until the person creates the document, which then opens as
   * any document does.
   */
  const pdfImport = usePdfImport({
    consent: consentStore,
    answer: setPdfConsent,
    read: (bytes, options) => readPdfFile(bytes, options),
    open: (pkg, doc) => {
      setShown(undefined);
      setError(undefined);
      compiler.current?.open(pkg, doc);
    },
    update: (doc) => compiler.current?.update(doc),
    create: async (template, resume) => {
      const id = await store.current?.create(template, resume, navigator.language);
      if (id === undefined) throw new Error("the store is closed");
      return id;
    },
    created: (id) => void openDocument(id),
    notice: setNotice,
    locale: navigator.language,
  });
  /**
   * An import that came through partial, with its report, which waits in the list for the person to
   * continue or stop (decision 0039); nothing of it is kept until they continue.
   */
  const [waiting, setWaiting] = useState<{ outcome: Imported; report: Report }>();
  /** The report of the import the open document came from, shown above its page until it closes. */
  const [importedReport, setImportedReport] = useState<{ id: string; report: Report }>();
  /**
   * The open document's structural step that no page has shown yet, which is not saved until one
   * does, and is taken back if its compile stops (decision 0041); and whether the last was.
   */
  const guard = useRef(new StructureGuard());
  const [takenBack, setTakenBack] = useState(false);
  /** Whether the last edit was refused for making a field longer than one may be (`MAX_FIELD`). */
  const [tooLong, setTooLong] = useState(false);
  /**
   * Why Enter at a field's end added no unit, where its group stays as it was imported (decision
   * 0055); and the field of the unit it did add whose input in the side panel takes the focus,
   * since the page cannot open a field while it is empty (the second pass's item 8).
   */
  const [unitNote, setUnitNote] = useState<string>();
  const [focusField, setFocusField] = useState<string>();
  /** The visit to a field, by its click, whose Enter at the end added a unit: it adds no other. */
  const ended = useRef<number | undefined>(undefined);
  /** Whether the compile that just stopped was a step taken back, whose plain message is said. */
  const tookBack = useRef(false);
  /** The fonts the pages are drawn with, which a retype's check reads the outputs with. */
  const fontsFor = useRef<FontLibrary | undefined>(undefined);
  /**
   * The retype of a locked part's words waiting for its page (milestone 3 item 16, decision 0042),
   * which is kept only once the page outside the part is as it was and the part shows what was
   * typed; the comparison loads with the import's reading of an output, on the first retype.
   */
  const retypeGuard = useRef(
    new RetypeGuard(async (before, after, part) => {
      const fonts = fontsFor.current;
      if (fonts === undefined) throw new Error("the page's fonts are not loaded");
      const { outsideCheck } = await import("./editor/retype-check");
      return outsideCheck(fonts)(before, after, part);
    }),
  );
  /**
   * The locked part whose words are being retyped, by its section's id: whether what was typed is
   * being checked, and why the last words were taken back, if they were.
   */
  const [retyping, setRetyping] = useState<{ part: string; checking: boolean; message?: string }>();
  /** The open document as the latest render has it, for a fit that lands after later renders. */
  const openNow = useRef<Open | undefined>(undefined);
  useLayoutEffect(() => {
    openNow.current = open;
  });

  /** The list, fresh from the store, which writes what waits to be saved before it lists. */
  const showList = async (reason?: string) => {
    opening.current++;
    guard.current.forget();
    retypeGuard.current.forget();
    setRetyping(undefined);
    setTakenBack(false);
    setTooLong(false);
    setUnitNote(undefined);
    setFocusField(undefined);
    setOpen(undefined);
    setClicked(undefined);
    setImportedReport(undefined);
    setNotice(reason);
    try {
      setDocuments((await store.current?.list()) ?? []);
    } catch (error) {
      console.error("The documents could not be listed:", error);
      setNotice(NO_STORAGE);
      setDocuments([]);
    }
  };

  /**
   * Open a stored document: read it, drop the choices its template no longer offers, and compile
   * it on the engine already running. One that cannot be opened leaves the list up, saying why.
   */
  const openDocument = async (id: string) => {
    const request = ++opening.current;
    let found: Stored | undefined;
    try {
      found = await store.current?.get(id);
    } catch (error) {
      console.error("The document could not be read:", error);
      if (request === opening.current)
        await showList(error instanceof DocumentRefused ? error.message : NO_STORAGE);
      return;
    }
    if (request !== opening.current) return;
    if (found === undefined) return showList("That document is no longer in this browser.");
    const { revision } = found;
    // Its template: a curated one, or an import's from the store (decision 0038).
    let template: Template | undefined;
    try {
      template = await resolveTemplate(found.document.template, id, store.current);
    } catch (error) {
      console.error("The document's template could not be read:", error);
    }
    if (request !== opening.current) return;
    // A template this editor does not have, or one the store refuses: a newer one wrote it.
    if (template === undefined) {
      console.error(`This editor has no template with the id ${found.document.template}`);
      return showList(CANNOT_OPEN);
    }
    const { package: pkg, job } = template;
    const { document, dropped } = dropRefusedChoices(pkg, found.document);
    if (dropped.length > 0) {
      const choices = dropped.join(" and ");
      console.warn(
        `${pkg.name} no longer offers the document's ${choices}, so it opens on the template's default`,
      );
    }
    setOpen({
      id,
      revision,
      pkg,
      job,
      lockedWords: lockedWordsFrom(template, document),
      history: new History(document, pkg),
      present: document,
      canUndo: false,
      canRedo: false,
      stale: false,
      unsaved: false,
    });
    setNotice(undefined);
    setShown(undefined);
    setError(undefined);
    setPdfError(undefined);
    setClicked(undefined);
    guard.current.forget();
    retypeGuard.current.forget();
    setRetyping(undefined);
    setTakenBack(false);
    setTooLong(false);
    setUnitNote(undefined);
    setFocusField(undefined);
    compiler.current?.open(pkg, document, job);
  };

  // The effect owns the store and the compiler, and the compiler its worker, so React's second run
  // in development closes the first of each and leaves nothing behind. It runs once: what it calls
  // back into, `openDocument` and `showList`, reads only refs and state setters.
  useEffect(() => {
    let live = true;
    const kept = new DocumentStore();
    store.current = kept;
    // What the store learns in the background reaches the open document: a flush the timer or the
    // page going away asked for, and another tab's change. Closing the store stops both.
    kept.onFlushed((result) => setOpen((current) => current && afterFlush(current, result)));
    kept.onChanged((id) =>
      setOpen((current) =>
        current?.id === id && !current.stale ? { ...current, stale: true } : current,
      ),
    );
    let owned: Compiler | undefined;
    /**
     * What became of a retype of a locked part's words (decision 0042): kept, its page shown and
     * the document saved, and its editor closed; or taken back, the document before it compiled
     * again, never saved, and the editor saying why in plain words.
     */
    const settleRetype = (verdict: RetypeVerdict, latest?: Shown) => {
      const now = openNow.current;
      if (now === undefined) return;
      const { history } = now;
      if (verdict.kept) {
        if (latest !== undefined) {
          setShown((before) => ({ latest, opening: before === undefined }));
          setError(undefined);
        }
        kept.save(now.id, history.present, now.revision);
        setRetyping(undefined);
        return;
      }
      const { present, canUndo, canRedo } = history;
      setOpen((current) =>
        current?.history === history ? { ...current, present, canUndo, canRedo } : current,
      );
      owned?.update(present);
      const message = RETYPE_REFUSED[verdict.why];
      setRetyping((current) => current && { part: current.part, checking: false, message });
    };
    const events: CompilerEvents = {
      page: (latest) => {
        // A retype cancelled while it compiled: its page is never shown.
        if (retypeGuard.current.discards(latest.document)) return;
        // A retype's page is shown only once it passes, which its check says.
        const retypes = retypeGuard.current;
        if (retypes.waitsFor(latest.document)) {
          void retypes.paged(latest).then((verdict) => {
            if (verdict !== undefined) settleRetype(verdict, latest);
          });
          return;
        }
        setShown((before) => ({ latest, opening: before === undefined }));
        setError(undefined);
        // A page that shows the structural step held lets it be saved, with what came after it.
        const now = openNow.current;
        if (now !== undefined && guard.current.paged(latest.document))
          kept.save(now.id, now.history.present, now.revision);
      },
      error: (message) => {
        // The step taken back says so itself, and its document compiles again; and so does a
        // retype whose page did not come, which is taken back with it.
        if (tookBack.current) tookBack.current = false;
        else {
          const retyped = retypeGuard.current.failed();
          if (retyped === undefined) setError(message);
          else settleRetype(retyped);
        }
      },
      stopped: (document) => {
        // A cancelled retype's compile that stopped says nothing: the document before it compiles.
        if (retypeGuard.current.discards(document)) {
          tookBack.current = true;
          return;
        }
        // A retype that stopped the compile: taken back, never saved, and the page as it was.
        const retyped = retypeGuard.current.stopped(document);
        if (retyped !== undefined) {
          tookBack.current = true;
          settleRetype(retyped);
          return;
        }
        // The held step stopped the compile: taken back, never saved, and the page as it was.
        const now = openNow.current;
        if (now === undefined || !guard.current.stopped(document)) return;
        tookBack.current = true;
        const { history } = now;
        const { present, canUndo, canRedo } = history;
        setOpen((current) =>
          current?.history === history ? { ...current, present, canUndo, canRedo } : current,
        );
        owned?.update(present);
        // A field open on what was taken back closes: what it shows is no longer the document's.
        setClicked(undefined);
        setTakenBack(true);
      },
      busy: setBusy,
    };
    const loaded = loadTree().then(
      ({ tag, fonts, known }) => {
        if (!live) return;
        setLibrary(fonts);
        fontsFor.current = fonts;
        owned = new Compiler(() => new EngineClient(), fonts, events, {
          formats: kept.formatsFor(tag),
          prefetch: kept.prefetch,
          knownPath: known,
          // The compiler asks only for paths the tree has; this checks again, so that no path the
          // storage holds becomes a request of its own.
          fetchFile: (path) => (known(path) ? fetchAhead(fileUrl(tag, path)) : Promise.resolve()),
        });
        compiler.current = owned;
      },
      (error: unknown) => {
        if (!live) return;
        // The details are for developers; a user never sees them.
        console.error("The page could not be shown:", error);
        setFailed(true);
      },
    );
    // The most recently edited document opens once the engine's tree is known, or the list shows.
    Promise.all([kept.list(), loaded]).then(
      ([listed]) => {
        if (!live) return;
        const latest = listed[0];
        if (latest === undefined) setDocuments(listed);
        else void openDocument(latest.id);
      },
      (error: unknown) => {
        if (!live) return;
        console.error("The documents could not be listed:", error);
        setNotice(NO_STORAGE);
        setDocuments([]);
      },
    );
    return () => {
      live = false;
      owned?.close();
      void kept.close();
      if (compiler.current === owned) compiler.current = undefined;
      if (store.current === kept) store.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), MOMENT);
    return () => clearTimeout(timer);
  }, [busy]);

  /**
   * Render the history of `doc`, the open document, as it stands: its present, and whether it has
   * a step to undo and one to redo. The history is not state, so every change to it comes here,
   * and only the document it belongs to takes it, not one opened since.
   */
  const followHistory = ({ history }: Open) => {
    const { present, canUndo, canRedo } = history;
    setOpen((current) =>
      current?.history !== history ||
      (current.present === present && current.canUndo === canUndo && current.canRedo === canRedo)
        ? current
        : { ...current, present, canUndo, canRedo },
    );
  };

  /**
   * The history of `doc` has a new present, from a command, an undo or a redo, after `before`: it
   * is rendered, compiled and saved, as every change to the document is (decision 0010); but a
   * structural step, and what follows it, is saved only once a page shows it (`StructureGuard`,
   * decision 0041), and taken back if its compile stops.
   */
  const followPresent = (doc: Open, before: EditorDocument) => {
    followHistory(doc);
    const { present } = doc.history;
    setTakenBack(false);
    setUnitNote(undefined);
    compiler.current?.update(present);
    // An imported outline's every change waits for its page (`StructureGuard`).
    const every = outlineOf(present.resume) !== undefined;
    if (guard.current.changed(doc.history, before, every))
      store.current?.save(doc.id, present, doc.revision);
  };

  /**
   * Take back a step of the open document's history, or do again the one last taken back (item
   * 12), from the message line's buttons or from the keys (`useHistoryKeys`). What is being typed
   * in ends first, so that its edit is part of the step taken back rather than left to come after
   * it: an element that takes typing loses the focus, which makes a panel input send what it holds
   * back for a pause and seal its step, and an open field closes; undo and redo end the open step
   * themselves. A document another tab has changed takes neither, as it takes no edit. It comes
   * before the returns below, since the hook that gives it the keys runs on every render, and says
   * whether a document took the key, which then does nothing else.
   */
  const travel = (way: Way): boolean => {
    if (open === undefined || open.stale) return false;
    // A retype waiting for its page takes no undo or redo: the key does nothing until it is done.
    if (retypeGuard.current.holds()) return true;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && holdsTyping(focused)) focused.blur();
    setClicked(undefined);
    // A part's editor open closes: its runs may change under it (decision 0042).
    setRetyping(undefined);
    const before = open.history.present;
    const next = way === "undo" ? open.history.undo() : open.history.redo();
    // With nothing to take back, the step that ended may still have been dropped.
    if (next === undefined) followHistory(open);
    else followPresent(open, before);
    return true;
  };
  // While a document is open, the browser's own undo and redo are refused but in the link
  // popover, whose typing they take back (`refuseNativeUndo`).
  useHistoryKeys(travel, open !== undefined);

  // What each locked part of the document the page shows offers to retype (decision 0042), read
  // from the page and the document it was drawn from, which a retype is checked against.
  const latest = shown?.latest;
  const retypes = useMemo(
    () => (latest === undefined ? undefined : retypesOf(latest.document, latest.pages)),
    [latest],
  );

  /** A new document from the sample of the curated template the list's chooser gives. */
  const startDocument = async (template: string) => {
    let id: string | undefined;
    try {
      id = await store.current?.create(template, curated(template).sample, navigator.language);
    } catch (error) {
      console.error("A new document could not be kept:", error);
      setNotice(NO_STORAGE);
    }
    if (id !== undefined) await openDocument(id);
  };

  /**
   * Delete a document. The last document of an imported template takes its package with it, and
   * the package's formats go from the compiler and its engine too (decision 0038).
   */
  const deleteDocument = async (id: string) => {
    let dropped: string | undefined;
    try {
      dropped = await store.current?.remove(id);
    } catch (error) {
      console.error("The document could not be deleted:", error);
      return showList(NO_STORAGE);
    }
    if (dropped !== undefined) compiler.current?.dropTemplate(dropped);
    await showList();
  };

  /**
   * Keep an import that came through, its package and its document, and open the document, its
   * report's first line above its page (decision 0039).
   */
  const keepImport = async (outcome: Imported, report: Report) => {
    let id: string | undefined;
    try {
      id = await store.current?.importDocument(outcome);
    } catch (error) {
      console.error("The imported resume could not be kept:", error);
      setNotice(COULD_NOT_KEEP);
      return;
    }
    if (id === undefined) return;
    // Before it opens, so that a document that cannot open, which shows the list, takes it away.
    setImportedReport({ id, report });
    await openDocument(id);
  };

  /**
   * Import the files the list was given (decision 0038): on the compiler's engine, while the list
   * shows its progress line; a refusal says why in the list's notice, in its own plain words; a
   * cancel leaves the list as it was. What went wrong otherwise is for developers, as is a refusal's
   * log, which quotes the source. One that came through is read into its report (decision 0039):
   * a success is kept and opened as any document, and a partial one waits in the list, its report
   * shown, for the person to continue with it or stop.
   */
  const importFiles = async (chosen: File[]) => {
    const owned = compiler.current;
    const running = () => importRun.current !== undefined || pdfImport.busy;
    if (owned === undefined || running() || waiting !== undefined) return;
    // A PDF is read in the browser, by a reader loaded only now, and goes to the review.
    const [only] = chosen;
    if (chosen.length === 1 && only !== undefined && isPdfFile(only)) {
      pdfImport.start(only);
      return;
    }
    let files: Upload[];
    try {
      files = await Promise.all(
        chosen.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
    } catch (error) {
      console.error("The files to import could not be read:", error);
      setNotice(COULD_NOT_READ);
      return;
    }
    if (running()) return;
    setNotice(undefined);
    setImporting({ label: IMPORT_STEPS.intake, compiles: 0 });
    const run = owned.importResume(files, ({ label, compiles }) => {
      if (importRun.current === run) setImporting({ label, compiles });
    });
    importRun.current = run;
    let outcome: ImportOutcome;
    try {
      outcome = await run.done;
    } catch (error) {
      if (importRun.current !== run) return;
      importRun.current = undefined;
      setImporting(undefined);
      if (error instanceof EngineCancelled) return;
      console.error("The import could not finish:", error);
      setNotice(IMPORT_FAILED);
      return;
    }
    // Cancelled as it landed: the list stays as it was.
    if (importRun.current !== run) return;
    importRun.current = undefined;
    setImporting(undefined);
    if (isRefusal(outcome)) {
      console.warn(`The import was refused (${outcome.reason})`, outcome.log ?? "");
      setNotice(outcome.message);
      setOfferFor(outcome.message);
      return;
    }
    const report = reportOfImport(outcome);
    if (report.outcome === "partial") setWaiting({ outcome, report });
    else await keepImport(outcome, report);
  };

  /** Continue with a partial import: kept and opened as it is (decision 0039). */
  const continueImport = async () => {
    const pending = waiting;
    if (pending === undefined) return;
    setWaiting(undefined);
    await keepImport(pending.outcome, pending.report);
  };

  /**
   * Stop a partial import: nothing of it is kept. Its package was never stored, and the formats its
   * checks dumped went as they ended (decision 0038), so there is nothing else to drop.
   */
  const stopImport = () => setWaiting(undefined);

  /**
   * Move a partial import's content onto a built-in template (milestone 3 second pass, item 16):
   * the bridge makes a PDF of the page its original compiles to, on the compiler's engine, while
   * the list shows its progress line, and the PDF import takes it from there, its question the
   * first time and its setting after, its reading, its review and "Create document". Nothing of
   * the partial import is kept. A cancel while the PDF is made, or no PDF, leaves the import
   * waiting as it was, the latter with a notice that says so.
   */
  const moveImport = async () => {
    const owned = compiler.current;
    const pending = waiting;
    if (owned === undefined || pending === undefined || importRun.current !== undefined) return;
    setWaiting(undefined);
    setNotice(undefined);
    setImporting({ label: MOVE_STEP });
    const files = pending.outcome.upload.files;
    const run = owned.referencePdf(files, () => {});
    importRun.current = run;
    let made: PagePdf;
    try {
      made = await run.done;
    } catch (error) {
      if (importRun.current !== run) {
        setWaiting(pending);
        return;
      }
      importRun.current = undefined;
      setImporting(undefined);
      if (!(error instanceof EngineCancelled)) console.error("No PDF of the page was made:", error);
      setWaiting(pending);
      setNotice(MOVE_NO_PDF);
      return;
    }
    if (importRun.current !== run) {
      setWaiting(pending);
      return;
    }
    importRun.current = undefined;
    setImporting(undefined);
    if (!made.ok) {
      console.warn(`No PDF of the page was made ()`);
      setWaiting(pending);
      setNotice(MOVE_NO_PDF);
      return;
    }
    pdfImport.start(pageFile(made.pdf, files[0]?.name));
  };

  /** Stop the import under way: its worker is terminated and starts afresh (decision 0038). */
  const cancelImport = () => {
    if (pdfImport.busy) {
      pdfImport.cancel();
      return;
    }
    const run = importRun.current;
    if (run === undefined) return;
    importRun.current = undefined;
    setImporting(undefined);
    run.cancel();
  };

  if (open === undefined) {
    if (documents === undefined) return <p>Loading…</p>;
    const pdf = pdfImport.state;
    if (pdf.step === "review")
      return (
        <PdfReview
          review={pdf.review}
          {...(shown === undefined ? {} : { shown: shown.latest })}
          {...(error === undefined ? {} : { error })}
          {...(library === undefined ? {} : { fonts: library })}
          onTemplate={pdfImport.pickTemplate}
          onCommand={pdfImport.command}
          onSeal={pdfImport.seal}
          onCreate={pdfImport.create}
          onCancel={pdfImport.cancel}
        />
      );
    const importShown = pdfImport.importing ?? importing;
    return (
      <DocumentList
        documents={documents}
        notice={notice}
        onOpen={(id) => void openDocument(id)}
        onNew={(template) => void startDocument(template)}
        onDelete={(id) => void deleteDocument(id)}
        // Imports run on the compiler's engine, which the tree's fonts come with.
        {...(library === undefined ? {} : { onImport: (files: File[]) => void importFiles(files) })}
        {...(importShown === undefined ? {} : { importing: importShown })}
        onCancelImport={cancelImport}
        pdfReading={{ consent: pdfConsent, onChange: setPdfConsent }}
        {...(notice !== undefined && notice === offerFor && library !== undefined
          ? { pdfOffer: { onChoose: (file: File) => void importFiles([file]) } }
          : {})}
        {...(pdf.step === "asking"
          ? { pdfQuestion: { onAnswer: pdfImport.answerQuestion, onCancel: pdfImport.cancel } }
          : {})}
        {...(waiting === undefined
          ? {}
          : {
              waiting: {
                report: waiting.report,
                onContinue: () => void continueImport(),
                onStop: stopImport,
              },
            })}
      />
    );
  }

  const { id, pkg, job, lockedWords, history, present, canUndo, canRedo, stale, unsaved } = open;

  /**
   * Apply a command to the open document. One of a visit to a field, which the overlay and the
   * panel's inputs make, or of a drag of a slider, comes with the group of the visit or the drag,
   * so that it is one step of the history (`History.dispatch`); any other is a step of its own. A
   * command that changes nothing, such as a click on the density already chosen, is no step, and
   * nothing is compiled or saved for it; nor is one the package refuses, as emptying a field an
   * imported template requires (decision 0026), which leaves the document as it was, the side
   * panel's input showing it again and marking why.
   */
  const edit = (command: Command, group?: string) => {
    // A document another tab has changed takes no edit until it is read again: one made here
    // could not be saved over the other tab's, and would be lost on the reload. Nor does one
    // whose retype waits for its page, which is then the retype's alone (decision 0042).
    if (stale || retypeGuard.current.holds()) return;
    const before = history.present;
    let after: EditorDocument;
    try {
      after = history.dispatch(command, group);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      console.warn("The template refused an edit:", error.message);
      // Typed past what a field holds: the field open closes, showing the document's text again.
      if (error instanceof FieldTooLong) {
        setTooLong(true);
        setClicked(undefined);
      }
      // A structural step refused says why in plain words, an outline's unit's its own.
      if (error instanceof UnitRefused) setUnitNote(error.plain);
      else if (command.type === "structure") setUnitNote(REFUSED_STEP);
      return;
    }
    setTooLong(false);
    if (after !== before) followPresent(open, before);
  };

  /**
   * End the history's open step, as a visit or a drag ends: one that ended where it began is
   * dropped, which the buttons then follow.
   */
  const seal = () => {
    history.seal();
    followHistory(open);
  };

  /**
   * Open a field clicked on the page, a visit of its own: the history's step before it ends, if
   * the field that was open went without closing.
   */
  const openField = (field: string, offset: number) => {
    if (retypeGuard.current.holds()) return;
    setFocusField(undefined);
    setUnitNote(undefined);
    seal();
    setRetyping(undefined);
    setClicked({ field, offset, click: ++clicks.current });
  };

  /** Close the open field, which ends the visit to it, and with it the step its edits made. */
  const closeField = () => {
    seal();
    setClicked(undefined);
  };

  /**
   * Enter at the end of an outline's field (the second pass's item 8): where the field ends a unit,
   * a bullet by its text or an entry by its last field before its bullets, never a section
   * (`enterAdds`), a copy of its group's
   * last unit, its fields emptied, goes in after it (`addUnit`), as a step of its own after the
   * visit to the field, held until its page shows as every change to an outline is; the field
   * closes, and the new unit's first field takes the focus in the side panel, since the page shows
   * no empty field to open. A step the outline refuses, in a group that stays as it was imported or
   * after a unit not of the last's shape, adds nothing, and the message line says why.
   */
  const endField = (field: string, click: number) => {
    // A key held down repeats before the field closes: one visit adds one unit.
    if (ended.current === click) return;
    const outline = outlineOf(history.present.resume);
    const id = field.endsWith(".text") ? field.slice(0, -".text".length) : undefined;
    const place = outline && id !== undefined ? enterAdds(outline.parts, id) : undefined;
    const unit = place?.group.units[place.index];
    if (unit === undefined) return;
    // The add is a step of its own, after the visit: one the outline refuses says why, and the
    // field stays open.
    const before = history.present;
    edit({ type: "structure", op: { op: "addUnit", after: unit.id } });
    const after = outlineOf(history.present.resume);
    if (history.present === before || after === undefined) return;
    ended.current = click;
    closeField();
    const now = unitPlace(after.parts, unit.id);
    const added = now?.group.units[now.index + 1];
    const first = added === undefined ? undefined : outlineFields(added.parts).next().value;
    setFocusField(first === undefined ? undefined : markerOf(first.part.id));
  };

  /**
   * Open the small editor of a locked part's words, clicked on the page or opened from its row in
   * the side panel (decision 0042), by its section's id in any case, as the page reads ids; or of a
   * segment of an outline's kept text, by its id (the second pass's item 7). The field open closes
   * first, its visit ending, as a click on another field ends it.
   */
  const openRetype = (part: string) => {
    if (stale || retypeGuard.current.holds()) return;
    const key = [...(retypes?.keys() ?? [])].find(
      (each) => each.toLowerCase() === part.toLowerCase(),
    );
    const retype = key === undefined ? undefined : retypes?.get(key);
    if (key === undefined || retype === undefined || !isRetype(retype)) return;
    seal();
    setClicked(undefined);
    setRetyping({ part: key, checking: false });
  };

  /**
   * Retype the open part's words (decision 0042): the change is one step of the history, compiled
   * as any edit and kept only once its page passes (`RetypeGuard`, whose verdict the compiler's
   * events give); until then it is not saved, and no other edit is taken. Words that change
   * nothing close the editor; ones the part cannot keep say so there.
   */
  const keepRetype = (texts: string[]) => {
    const part = retyping?.part;
    const retype = part === undefined ? undefined : retypes?.get(part);
    if (part === undefined || retype === undefined || !isRetype(retype) || shown === undefined)
      return;
    if (stale) return;
    const started = retypeGuard.current.start(history, retype, texts, shown.latest);
    if (started === "unchanged") {
      setRetyping(undefined);
      return;
    }
    if ("why" in started) {
      setRetyping({ part, checking: false, message: RETYPE_REFUSED[started.why] });
      return;
    }
    followHistory(open);
    setTakenBack(false);
    setRetyping({ part, checking: true });
    compiler.current?.update(started);
  };

  /** Close the part's editor; a retype still being checked is taken back, and nothing saved. */
  const cancelRetype = () => {
    if (retypeGuard.current.cancel()) {
      followHistory(open);
      compiler.current?.update(history.present);
    }
    setRetyping(undefined);
  };

  /**
   * Open the document again after its first page could not be made. The compiler outlives a
   * document it gave up and a page it dropped, and opening compiles at once, on a new worker if
   * the last was lost. An edit in the side panel, which stays under the message, compiles as any
   * edit does; this compiles the document as it stands, for a failure that was not its own.
   */
  const tryAgain = () => {
    setError(undefined);
    compiler.current?.open(pkg, history.present, job);
  };

  /**
   * Back to the list, once the document's saves are written. Until they are, its history holds
   * the only copy of the edits, so the editor stays, and the message line says why (the store's
   * listeners set it from the same flush). The compiler keeps the engine and its formats for the
   * next document, and nothing it does for this one is shown again.
   */
  const leave = async () => {
    const request = opening.current;
    const flushed = await store.current?.flush();
    if (request !== opening.current || (flushed !== undefined && !canLeave(flushed))) return;
    await showList();
  };

  const back = (
    <button type="button" onClick={() => void leave()}>
      Documents
    </button>
  );

  // Why the edits here are not being kept, when they are not: another tab's change, which a
  // reload takes in, and which leaves nothing here worth trying again; or a save that failed,
  // which a flush tries again, as the store also does by itself.
  const saving = stale ? (
    <p role="alert">
      {CHANGED_ELSEWHERE}{" "}
      <button type="button" onClick={() => void openDocument(id)}>
        Reload
      </button>
    </p>
  ) : unsaved ? (
    <p role="alert">
      {NOT_SAVED}{" "}
      <button type="button" onClick={() => void store.current?.flush()}>
        Retry
      </button>
    </p>
  ) : null;

  /**
   * Save the PDF of the page on screen, named after the open document's resume. What went wrong is
   * for developers, and the user reads only that the PDF could not be made.
   */
  const download = async () => {
    const owned = compiler.current;
    if (owned === undefined) return;
    // A retype's page is the compiler's output while it is checked: never in a PDF (decision 0042).
    if (retypeGuard.current.holds()) return;
    setDownloading(true);
    setPdfError(undefined);
    try {
      savePdf(await owned.pdf(), pdfFileName(history.present.resume.header.name));
    } catch (error) {
      console.error(error);
      setPdfError(COULD_NOT_MAKE_PDF);
    } finally {
      setDownloading(false);
    }
  };

  // The side panel's column: the structure, with the style controls under it (item 15). Its
  // commands are edits as the page's are, so a document another tab has changed takes none of them
  // either, and the column is inert until the document is read again. What is typed into one of
  // its inputs, and a drag of a slider or the colour picker, goes in one group, which ends as the
  // input or the control loses the focus; everything else is a step of its own. The column stays
  // when the first page could not be made, since a document can be saved in a state that does not
  // compile (decision 0013): with no page to click, the panel gives each field an input
  // (`shownFieldsOf`), bar a rich one it would strip of its marks, so the edit that stopped the
  // compile can be taken back, or its item removed, and the page that edit makes then shows.
  // Each locked part's row offers to retype its words, or says why not, and is named by its words as
  // the page shows them now, the report's until a retype replaces them (decision 0042).
  const rowNames =
    latest === undefined || retypes === undefined
      ? lockedWords
      : namesOnPage(lockedWords, latest.pages, retypes);
  const retypeRows =
    retypes === undefined
      ? undefined
      : new Map(
          [...retypes].map(([part, found]) => [part, isRetype(found) ? undefined : found.reason]),
        );
  const side = (
    <aside inert={stale} style={{ flex: "none", width: "24rem" }}>
      <Panel
        document={present}
        pkg={pkg}
        shownFields={shownFieldsOf(shown?.latest, present, error !== undefined)}
        lockedWords={rowNames}
        retypes={retypeRows}
        onRetype={openRetype}
        {...(focusField === undefined ? {} : { focus: focusField })}
        onCommand={edit}
        onSeal={() => {
          seal();
          setFocusField(undefined);
        }}
      />
      <Controls
        pkg={pkg}
        values={present.controls}
        onChange={(change, group) => edit({ type: "control", ...change }, group)}
        onSeal={seal}
      />
    </aside>
  );

  /**
   * Fit the open document to one page (item 18): the compiler tries a tighter density, then
   * narrower margins, then a smaller font size, in turn (`fit`), and the first setting that fits
   * becomes one step of the history, which one undo takes back (`applyFit`), and compiles and is
   * saved as any change is. What the fit finds is for the document as it stood when it began, so
   * an edit, an undo or another document opened meanwhile leaves it unused and unsaid, and so does
   * another tab's change, since such a document takes no edit. What went wrong is for developers.
   */
  const fitToPage = async () => {
    const owned = compiler.current;
    if (owned === undefined || stale) return;
    const doc = history.present;
    /** Say what the fit came to, or nothing, as long as it is still the fit of this document. */
    const say = (note?: string) =>
      setFitting((now) => {
        if (now?.document !== doc) return now;
        return note === undefined ? undefined : { document: doc, note };
      });
    setFitting({ document: doc });
    let found: Fitted | undefined;
    let finished = true;
    try {
      found = await fit(owned, pkg, doc);
    } catch (error) {
      console.error("The page could not be fitted:", error);
      finished = false;
    }
    const now = openNow.current;
    if (now?.history !== history || now.stale || history.present !== doc) {
      say();
    } else if (!finished) {
      say(COULD_NOT_FIT);
    } else if (found === undefined) {
      say(DOES_NOT_FIT);
    } else {
      say();
      applyFit(history, pkg, found.values);
      followPresent(open, doc);
    }
  };

  // With no page yet there is nothing to keep showing, so a failure to make the first one is a
  // failure to show any. Fonts that did not load leave no compiler to ask again.
  if (failed)
    return (
      <main>
        {back}
        {saving}
        <p>The page could not be shown.</p>
      </main>
    );
  // The message, with the side panel under it. The two are the main element's children as the
  // page's column and the panel's are below, so that the panel stays as it is, with what is open in
  // it and an input that has had the focus, when an edit there brings the page.
  if (error !== undefined && shown === undefined)
    return (
      <main>
        <div>
          {back}
          {saving}
          <p>
            The page could not be shown.{" "}
            <button type="button" onClick={tryAgain}>
              Try again
            </button>
          </p>
        </div>
        {side}
      </main>
    );
  if (!shown)
    return (
      <main>
        {back}
        {saving}
        <p>Opening…</p>
      </main>
    );
  const { ms, startMs } = shown.latest;
  // Start-up is apart from the page's own time: it is paid once per worker, not per edit.
  const started = startMs === undefined ? "" : ` (engine started in ${startMs.toFixed(0)} ms)`;
  const took = `${shown.opening ? "Opened" : "Updated"} in ${ms.toFixed(0)} ms${started}.`;
  // A fit speaks only of the document it began on, as it stood.
  const fitShown = fitting?.document === present ? fitting : undefined;
  // A fit runs, and has the engine, until it says what it came to, whatever document it began on.
  const fitRuns = fitting !== undefined && fitting.note === undefined;
  // The locked parts a click on the page opens the small editor of, by id as the page reads them,
  // and that editor, under the part's first block, while one is open (decision 0042). It checks a
  // retype against the page on screen, so it takes one only while that page is the document's.
  const retypable = new Set(
    [...(retypes ?? [])].flatMap(([part, found]) => (isRetype(found) ? [part.toLowerCase()] : [])),
  );
  const retype = retyping === undefined ? undefined : retypes?.get(retyping.part);
  const editing =
    retyping === undefined || retype === undefined || !isRetype(retype) || stale
      ? undefined
      : {
          part: retyping.part.toLowerCase(),
          editor: (
            <RetypeEditor
              key={retypeEditorKey(retyping.part, shown.latest.document)}
              pieces={retype.pieces}
              ready={shown.latest.document === present && !busy}
              checking={retyping.checking}
              {...(retyping.message === undefined ? {} : { message: retyping.message })}
              onKeep={keepRetype}
              onCancel={cancelRetype}
            />
          ),
        };
  return (
    <main style={{ display: "flex", alignItems: "flex-start", gap: "1.5rem" }}>
      <div style={{ flex: "none" }}>
        {back}
        {saving}
        {/* The report of the import this document came from: its rate, and what was left out. */}
        {importedReport?.id === id && <ImportReport report={importedReport.report} />}
        <p>
          {error ?? (slow ? "Compiling…" : took)}{" "}
          {/* A document another tab has changed takes no undo, as it takes no edit. */}
          <button
            type="button"
            aria-keyshortcuts="Meta+Z Control+Z"
            onClick={() => travel("undo")}
            disabled={stale || !canUndo}
          >
            Undo
          </button>{" "}
          <button
            type="button"
            aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
            onClick={() => travel("redo")}
            disabled={stale || !canRedo}
          >
            Redo
          </button>{" "}
          {/* A document another tab has changed is not the one stored, so it gives no PDF. A fit
              to one page has the engine while it runs, so the PDF waits until it is done, as the
              fit waits for the PDF (item 18). */}
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy || downloading || stale || fitRuns || retyping?.checking === true}
          >
            Download PDF
          </button>
        </p>
        {takenBack && <p role="status">{TAKEN_BACK}</p>}
        {tooLong && <p role="status">{TOO_LONG}</p>}
        {unitNote && <p role="status">{unitNote}</p>}
        {pdfError && <p>{pdfError}</p>}
        {/* The fit takes the page on screen to be the present document's, so it waits while a
            page is on its way; it waits while a PDF is being made, whose request would otherwise
            share the engine with its trials; and a document another tab has changed takes no fit,
            as it takes no edit (item 18). */}
        {shown.latest.page.pageCount > 1 && (
          <p>
            {runsOnto(shown.latest.page.pageCount)}{" "}
            <button
              type="button"
              onClick={() => void fitToPage()}
              disabled={
                busy ||
                downloading ||
                stale ||
                (fitShown !== undefined && fitShown.note === undefined)
              }
            >
              Fit to one page
            </button>
            {fitShown && ` ${fitShown.note ?? FITTING}`}
          </p>
        )}
        {/* Every page, one under the other (decision 0046), and the overlay, or the date picker,
            over the field clicked, on whichever page shows it, which the latest pages place and
            its commands edit. A document another tab has changed takes no edits, so it closes
            then, and showing the list or opening a document forgets the click. Its commands go in
            the group of a visit to the field, which closing it ends, so that undo takes back the
            whole visit however many keystrokes it took (item 12). */}
        <div ref={setSheet} style={SHEET}>
          <Pages
            pages={shown.latest.pages}
            onField={openField}
            retypable={retypable}
            onLocked={openRetype}
            {...(outlineOf(present.resume) === undefined ? {} : { tips: KEPT_TIPS })}
            {...(editing === undefined ? {} : { editing })}
          />
          {clicked && sheet && !stale && (
            <Overlay
              key={clicked.click}
              field={clicked.field}
              offset={clicked.offset}
              document={present}
              shown={shown.latest}
              page={sheet}
              fonts={library}
              onCommand={(command) => edit(command, `field:${clicked.field}`)}
              onClose={closeField}
              {...(outlineOf(present.resume) === undefined
                ? {}
                : { onEnd: () => endField(clicked.field, clicked.click) })}
            />
          )}
        </div>
      </div>
      {side}
    </main>
  );
}
