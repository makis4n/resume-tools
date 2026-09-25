import type { Resume, RichText } from "@resume-tools/resume-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { Controls } from "./editor/Controls";
import { COULD_NOT_MAKE_PDF, Compiler, type CompilerEvents, type Shown } from "./editor/compiler";
import { DocumentList } from "./editor/DocumentList";
import {
  type Command,
  dropRefusedChoices,
  type Document as EditorDocument,
  type FieldRef,
  fieldsOf,
  History,
} from "./editor/document";
import { pdfFileName, savePdf } from "./editor/download";
import { Panel, shownFieldsOf } from "./editor/Panel";
import { EngineClient } from "./engine/client";
import type { EngineManifest } from "./engine/manifest";
import { engineTag, fileUrl, manifestUrl } from "./engine/urls";
import { FontLibrary } from "./page/fonts";
import { Page } from "./page/Page";
import { TexLiveIndex } from "./page/texlive";
import {
  CANNOT_OPEN,
  canLeave,
  DocumentRefused,
  DocumentStore,
  type Flushed,
  type Stored,
  type Summary,
} from "./storage/store";
import { CURATED, curated } from "./templates/curated";

/**
 * The editor as far as milestone 2 has come: the documents kept in this browser, and one of them
 * open at a time, whose page recompiles as it changes and which is saved after every command
 * (decision 0010). Only the dev server serves `/engine/`; hosting the engine is milestone 5, so a
 * production build keeps documents but shows the failure message for their pages until then.
 */

/** How long a compile may keep the page waiting before the message line says it is compiling. */
const MOMENT = 500;

/** The template a new document starts from: Jake's Resume, the one curated so far. */
const NEW_TEMPLATE = "jake";

/** What the user reads when the browser's storage fails; the details go to the console. */
const NO_STORAGE = "Documents cannot be read or kept in this browser.";

/** What the user reads while the open document's edits cannot be written; it stays open. */
const NOT_SAVED = "This document could not be saved in this browser.";

/** What the user reads once another tab has changed the open document. */
const CHANGED_ELSEWHERE = "This document was changed in another tab.";

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

/** A rich field's text as the page shows it: its runs joined, which click offsets count in. */
const plain = (runs: RichText) => runs.map((run) => run.text).join("");

/** A glyph that was clicked: its field, and the character in the field's text it stands for. */
interface Click {
  field: string;
  offset: number;
}

/** The document open in the editor. */
interface Open {
  /** Its id in the store. */
  id: string;
  /** The revision it was read at, which its saves name, so none is written over another tab's. */
  revision: number;
  history: History;
  /** The history's present, as state, so that an edit renders. */
  present: EditorDocument;
  /** Whether another tab has changed it since it was read: it takes no edits until read again. */
  stale: boolean;
  /** Whether its newest save could not be written; it stays open until one is. */
  unsaved: boolean;
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

  /** The list, fresh from the store, which writes what waits to be saved before it lists. */
  const showList = async (reason?: string) => {
    opening.current++;
    setOpen(undefined);
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
        await showList(error instanceof DocumentRefused ? CANNOT_OPEN : NO_STORAGE);
      return;
    }
    if (request !== opening.current) return;
    if (found === undefined) return showList("That document is no longer in this browser.");
    const { revision } = found;
    const pkg = CURATED.get(found.document.template)?.package;
    // A template this editor does not have: a newer one wrote the document.
    if (pkg === undefined) {
      console.error(`No curated template has the id ${found.document.template}`);
      return showList(CANNOT_OPEN);
    }
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
      history: new History(document),
      present: document,
      stale: false,
      unsaved: false,
    });
    setNotice(undefined);
    setShown(undefined);
    setError(undefined);
    setPdfError(undefined);
    setClicked(undefined);
    compiler.current?.open(pkg, document);
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
    const events: CompilerEvents = {
      page: (latest) => {
        setShown((before) => ({ latest, opening: before === undefined }));
        setError(undefined);
      },
      error: setError,
      busy: setBusy,
    };
    const loaded = loadTree().then(
      ({ tag, fonts, known }) => {
        if (!live) return;
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

  const startDocument = async () => {
    let id: string | undefined;
    try {
      id = await store.current?.create(
        NEW_TEMPLATE,
        curated(NEW_TEMPLATE).sample,
        navigator.language,
      );
    } catch (error) {
      console.error("A new document could not be kept:", error);
      setNotice(NO_STORAGE);
    }
    if (id !== undefined) await openDocument(id);
  };

  const deleteDocument = async (id: string) => {
    try {
      await store.current?.remove(id);
    } catch (error) {
      console.error("The document could not be deleted:", error);
      return showList(NO_STORAGE);
    }
    await showList();
  };

  if (open === undefined) {
    if (documents === undefined) return <p>Loading…</p>;
    return (
      <DocumentList
        documents={documents}
        notice={notice}
        onOpen={(id) => void openDocument(id)}
        onNew={() => void startDocument()}
        onDelete={(id) => void deleteDocument(id)}
      />
    );
  }

  const { id, revision, history, present, stale, unsaved } = open;

  const edit = (command: Command) => {
    // A document another tab has changed takes no edit until it is read again: one made here
    // could not be saved over the other tab's, and would be lost on the reload.
    if (stale) return;
    const next = history.dispatch(command);
    setOpen((current) => current && { ...current, present: next });
    compiler.current?.update(next);
    store.current?.save(id, next, revision);
  };

  /**
   * Open the document again after its first page could not be made. The compiler outlives a
   * document it gave up and a page it dropped, and opening compiles at once, on a new worker if
   * the last was lost; with no page there is no field to edit, so nothing else would try again.
   */
  const tryAgain = () => {
    setError(undefined);
    const doc = history.present;
    compiler.current?.open(curated(doc.template).package, doc);
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
  if (error !== undefined && shown === undefined)
    return (
      <main>
        {back}
        {saving}
        <p>
          The page could not be shown.{" "}
          <button type="button" onClick={tryAgain}>
            Try again
          </button>
        </p>
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
  const field = clicked && fieldsOf(present.resume).get(clicked.field);
  return (
    <main style={{ display: "flex", alignItems: "flex-start", gap: "1.5rem" }}>
      <div style={{ flex: "none" }}>
        {back}
        {saving}
        <p>
          {error ?? (slow ? "Compiling…" : took)}{" "}
          {/* A document another tab has changed is not the one stored, so it gives no PDF. */}
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy || downloading || stale}
          >
            Download PDF
          </button>
        </p>
        {pdfError && <p>{pdfError}</p>}
        {shown.latest.page.pageCount > 1 && <p>This resume runs onto a second page.</p>}
        {clicked && field && !stale && (
          <FieldBox click={clicked} field={field} resume={present.resume} onEdit={edit} />
        )}
        <Page
          svg={shown.latest.page.svg}
          onField={(field, offset) => setClicked({ field, offset })}
        />
      </div>
      {/* The side panel's column: the structure, with the style controls under it (item 15). Its
          commands are edits as the page's are, so a document another tab has changed takes none
          of them either, and the column is inert until the document is read again. */}
      <aside inert={stale} style={{ flex: "none", width: "24rem" }}>
        <Panel
          document={present}
          shownFields={shownFieldsOf(shown.latest, present)}
          onCommand={edit}
        />
        <Controls
          pkg={curated(present.template).package}
          values={present.controls}
          onChange={(change) => edit({ type: "control", ...change })}
        />
      </aside>
    </main>
  );
}

/**
 * A plain box for the clicked field, standing in for item 9's overlay, which replaces it. It shows
 * the field's text as the document holds it, with the caret where the click landed, and every
 * change is a command that recompiles the page, so an edit can be seen reaching it. A rich field
 * shows its runs' text and is set back as one plain run, losing any bold, italic or link until
 * item 10. Dates open a picker in item 9, so they get no box.
 */
function FieldBox({
  click,
  field,
  resume,
  onEdit,
}: {
  click: Click;
  field: FieldRef;
  resume: Resume;
  onEdit: (command: Command) => void;
}) {
  // A new click is a new object, so the caret moves on each click and stays put while typing.
  const place = useCallback(
    (box: HTMLInputElement | HTMLTextAreaElement | null) => {
      box?.focus();
      box?.setSelectionRange(click.offset, click.offset);
    },
    [click],
  );
  const id = click.field;
  switch (field.kind) {
    case "text":
      return (
        <label>
          {id}{" "}
          <input
            key={id}
            ref={place}
            value={field.get(resume) ?? ""}
            onChange={(event) => onEdit({ type: "text", field: id, text: event.target.value })}
          />
        </label>
      );
    case "rich":
      return (
        <label>
          {id}{" "}
          <textarea
            key={id}
            ref={place}
            value={plain(field.get(resume))}
            onChange={(event) =>
              onEdit({ type: "rich", field: id, runs: [{ text: event.target.value }] })
            }
          />
        </label>
      );
    case "dates":
      return <p>{id}: dates open a picker in item 9.</p>;
  }
}
