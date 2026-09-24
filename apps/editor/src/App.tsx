import { useEffect, useState } from "react";
import { EngineClient } from "./engine/client";
import type { EngineManifest } from "./engine/manifest";
import { type DrawnPage, drawPage } from "./page/draw";
import { FontLibrary } from "./page/fonts";
import { Page } from "./page/Page";
import { TexLiveIndex } from "./page/texlive";

/**
 * Until the editor has documents (milestone 2, item 8), the app compiles the spike's marked-up
 * Jake's Resume and shows its page, so the engine, the fonts and field clicks can be seen working.
 */
async function load(
  engine: EngineClient,
): Promise<{ page: DrawnPage; texts: Map<string, string>; ms: number }> {
  const started = performance.now();
  const text = (url: string) => fetch(url).then((r) => r.text());
  const [manifest, preamble, body] = await Promise.all([
    fetch("/engine/manifest.json").then((r) => r.json() as Promise<EngineManifest>),
    text("/spike/jake-preamble.tex"),
    text("/spike/body.tex"),
  ]);
  const dumped = await engine.dump("pdftex", "jake", preamble);
  if (!dumped.ok) throw new Error(dumped.error);
  const compiled = await engine.compile("pdftex", "jake", body);
  if (!compiled.output) throw new Error(compiled.error);
  const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) => {
    const response = await fetch(`/engine/files${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  const texts = new Map<string, string>();
  for (const m of body.matchAll(/\\rtfield\{([^}]*)\}\{([^{}]*)\}/g))
    texts.set(m[1] ?? "", m[2] ?? "");
  const page = await drawPage(compiled.output, fonts, texts);
  return { page, texts, ms: performance.now() - started };
}

export function App() {
  const [state, setState] = useState<Awaited<ReturnType<typeof load>>>();
  const [error, setError] = useState<string>();
  const [clicked, setClicked] = useState<string>();
  useEffect(() => {
    // The effect owns its worker, so React's second run in development stops the first one.
    const engine = new EngineClient();
    let live = true;
    load(engine).then(
      (loaded) => live && setState(loaded),
      (e: unknown) => live && setError(String(e)),
    );
    return () => {
      live = false;
      engine.terminate();
    };
  }, []);
  if (error) return <p>Could not show the page: {error}</p>;
  if (!state) return <p>Loading the engine…</p>;
  return (
    <main>
      <p>
        Opened in {state.ms.toFixed(0)} ms. {clicked ?? "Click a word on the page."}
      </p>
      <Page
        svg={state.page.svg}
        onField={(field, offset) => {
          const text = state.texts.get(field) ?? "";
          setClicked(`${field} at ${offset}: “${text.slice(0, offset)}|${text.slice(offset)}”`);
        }}
      />
    </main>
  );
}
