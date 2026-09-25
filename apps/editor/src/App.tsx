import type { Resume, RichText } from "@resume-tools/resume-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { Controls } from "./editor/Controls";
import { Compiler, type CompilerEvents, type Shown } from "./editor/compiler";
import { DocumentList } from "./editor/DocumentList";
import {
  type Command,
  dropRefusedChoices,
  type Document as EditorDocument,
  type FieldRef,
  fieldsOf,
  History,
} from "./editor/document";
import { Panel, shownFieldsOf } from "./editor/Panel";
import { EngineClient } from "./engine/client";
import type { EngineManifest } from "./engine/manifest";
import { engineTag, fileUrl, manifestUrl } from "./engine/urls";
import { FontLibrary } from "./page/fonts";
import { Page } from "./page/Page";
import { TexLiveIndex } from "./page/texlive";
import { CANNOT_OPEN, DocumentRefused, DocumentStore, type Summary } from "./storage/store";
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

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** The engine's tree as the main thread needs it: its tag, and the fonts the page is drawn with. */
async function loadTree(): Promise<{ tag: string; fonts: FontLibrary }> {
  const manifest = (await (await get(manifestUrl())).json()) as EngineManifest;
  const tag = engineTag(manifest);
  const fonts = new FontLibrary(
    new TexLiveIndex(manifest),
    async (path) => new Uint8Array(await (await get(fileUrl(tag, path))).arrayBuffer()),
  );
  return { tag, fonts };
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
  history: History;
  /** The history's present, as state, so that an edit renders. */
  present: EditorDocument;
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
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clicked, setClicked] = useState<Click>();

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
    let found: EditorDocument | undefined;
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
    const pkg = CURATED.get(found.template)?.package;
    // A template this editor does not have: a newer one wrote the document.
    if (pkg === undefined) {
      console.error(`No curated template has the id ${found.template}`);
      return showList(CANNOT_OPEN);
    }
    const { document, dropped } = dropRefusedChoices(pkg, found);
    if (dropped.length > 0) {
      const choices = dropped.join(" and ");
      console.warn(
        `${pkg.name} no longer offers the document's ${choices}, so it opens on the template's default`,
      );
    }
    setOpen({ id, history: new History(document), present: document });
    setNotice(undefined);
    setShown(undefined);
    setError(undefined);
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
      ({ tag, fonts }) => {
        if (!live) return;
        owned = new Compiler(() => new EngineClient(), fonts, events, {
          formats: kept.formatsFor(tag),
          prefetch: kept.prefetch,
          fetchFile: (path) => fetchAhead(fileUrl(tag, path)),
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

  const { id, history, present } = open;

  const edit = (command: Command) => {
    const next = history.dispatch(command);
    setOpen((current) => current && { ...current, present: next });
    compiler.current?.update(next);
    store.current?.save(id, next);
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

  // Back to the list, which writes the document's last saves first. The compiler keeps the engine
  // and its formats for the next document, and nothing it does for this one is shown again.
  const back = (
    <button type="button" onClick={() => void showList()}>
      Documents
    </button>
  );

  // With no page yet there is nothing to keep showing, so a failure to make the first one is a
  // failure to show any. Fonts that did not load leave no compiler to ask again.
  if (failed)
    return (
      <main>
        {back}
        <p>The page could not be shown.</p>
      </main>
    );
  if (error !== undefined && shown === undefined)
    return (
      <main>
        {back}
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
        <p>{error ?? (slow ? "Compiling…" : took)}</p>
        {clicked && field && (
          <FieldBox click={clicked} field={field} resume={present.resume} onEdit={edit} />
        )}
        <Page
          svg={shown.latest.page.svg}
          onField={(field, offset) => setClicked({ field, offset })}
        />
      </div>
      {/* The side panel's column: the structure, with the style controls under it (item 15). */}
      <aside style={{ flex: "none", width: "24rem" }}>
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
