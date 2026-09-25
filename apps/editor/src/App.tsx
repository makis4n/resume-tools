import type { Resume, RichText } from "@resume-tools/resume-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { Compiler, type Shown } from "./editor/compiler";
import { type Command, type FieldRef, fieldsOf, History, newDocument } from "./editor/document";
import { EngineClient } from "./engine/client";
import type { EngineManifest } from "./engine/manifest";
import { FontLibrary } from "./page/fonts";
import { Page } from "./page/Page";
import { TexLiveIndex } from "./page/texlive";
import { curated } from "./templates/curated";

/**
 * The editor as far as milestone 2 has come: one document, Jake's Resume with its invented
 * sample, whose page recompiles as the document changes. The document is not kept, so a reload
 * starts from the sample again until item 13. Only the dev server serves `/engine/`; hosting the
 * engine is milestone 5, so a production build shows the failure message until then.
 */

/** How long a compile may keep the page waiting before the message line says it is compiling. */
const MOMENT = 500;

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** The fonts the page is drawn with, found in TeX Live through the engine's manifest. */
async function loadFonts(): Promise<FontLibrary> {
  const manifest = (await (await get("/engine/manifest.json")).json()) as EngineManifest;
  return new FontLibrary(
    new TexLiveIndex(manifest),
    async (path) => new Uint8Array(await (await get(`/engine/files${path}`)).arrayBuffer()),
  );
}

/** A rich field's text as the page shows it: its runs joined, which click offsets count in. */
const plain = (runs: RichText) => runs.map((run) => run.text).join("");

/** A glyph that was clicked: its field, and the character in the field's text it stands for. */
interface Click {
  field: string;
  offset: number;
}

export function App() {
  const [history] = useState(
    () => new History(newDocument("jake", curated("jake").sample, navigator.language)),
  );
  const [present, setPresent] = useState(history.present);
  /** The latest page, and whether it is the one the document opened with. */
  const [shown, setShown] = useState<{ latest: Shown; opening: boolean }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clicked, setClicked] = useState<Click>();
  const compiler = useRef<Compiler | undefined>(undefined);

  useEffect(() => {
    // The effect owns its compiler, and the compiler its worker, so React's second run in
    // development closes the first and leaves no worker behind.
    let live = true;
    let owned: Compiler | undefined;
    loadFonts().then(
      (fonts) => {
        if (!live) return;
        owned = new Compiler(() => new EngineClient(), fonts, {
          page: (latest) => {
            setShown((before) => ({ latest, opening: before === undefined }));
            setError(undefined);
          },
          error: setError,
          busy: setBusy,
        });
        compiler.current = owned;
        const doc = history.present;
        owned.open(curated(doc.template).package, doc);
      },
      (error: unknown) => {
        if (!live) return;
        // The details are for developers; a user never sees them.
        console.error("The page could not be shown:", error);
        setFailed(true);
      },
    );
    return () => {
      live = false;
      owned?.close();
      if (compiler.current === owned) compiler.current = undefined;
    };
  }, [history]);

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), MOMENT);
    return () => clearTimeout(timer);
  }, [busy]);

  const edit = (command: Command) => {
    const next = history.dispatch(command);
    setPresent(next);
    compiler.current?.update(next);
  };

  // With no page yet there is nothing to keep showing, so a failure to make the first one is a
  // failure to show any.
  if (failed || (error !== undefined && shown === undefined))
    return <p>The page could not be shown.</p>;
  if (!shown) return <p>Loading the engine…</p>;
  const took = `${shown.opening ? "Opened" : "Updated"} in ${shown.latest.ms.toFixed(0)} ms.`;
  const field = clicked && fieldsOf(present.resume).get(clicked.field);
  return (
    <main>
      <p>{error ?? (slow ? "Compiling…" : took)}</p>
      {clicked && field && (
        <FieldBox click={clicked} field={field} resume={present.resume} onEdit={edit} />
      )}
      <Page
        svg={shown.latest.page.svg}
        onField={(field, offset) => setClicked({ field, offset })}
      />
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
