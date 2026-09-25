import { useEffect, useState } from "react";
import { EngineClient } from "./engine/client";
import type { EngineManifest } from "./engine/manifest";
import { type DrawnPage, drawPage } from "./page/draw";
import { FontLibrary } from "./page/fonts";
import { Page } from "./page/Page";
import { TexLiveIndex } from "./page/texlive";
import { curated } from "./templates/curated";
import { generateBody, generateFormat } from "./templates/generate";
import { defaultControls } from "./templates/package";

/**
 * Until the editor has documents (milestone 2, item 8), the app shows the curated Jake's Resume
 * sample through the generator, so the package, the engine, the fonts and field clicks can be
 * seen working. Only the dev server serves `/engine/`; hosting the engine is milestone 5, so a
 * production build shows the failure message until then.
 */
async function load(
  engine: EngineClient,
): Promise<{ page: DrawnPage; texts: Map<string, string>; ms: number }> {
  const started = performance.now();
  const get = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  };
  const manifest = (await get("/engine/manifest.json").then((r) => r.json())) as EngineManifest;
  const { package: pkg, sample } = curated("jake");
  const values = defaultControls(pkg, navigator.language);
  const format = generateFormat(pkg, values);
  const dumped = await engine.dump(pkg.engine, format.name, format.preamble, format.files);
  if (!dumped.ok) throw new Error(dumped.error);
  const body = generateBody(pkg, sample, values);
  const compiled = await engine.compile(pkg.engine, format.name, body.latex);
  if (!compiled.output) throw new Error(compiled.error);
  const fonts = new FontLibrary(
    new TexLiveIndex(manifest),
    async (path) => new Uint8Array(await (await get(`/engine/files${path}`)).arrayBuffer()),
  );
  const page = await drawPage(compiled.output, fonts, body.texts);
  return { page, texts: body.texts, ms: performance.now() - started };
}

export function App() {
  const [state, setState] = useState<Awaited<ReturnType<typeof load>>>();
  const [failed, setFailed] = useState(false);
  const [clicked, setClicked] = useState<string>();
  useEffect(() => {
    // The effect owns its worker, so React's second run in development stops the first one.
    const engine = new EngineClient();
    let live = true;
    load(engine).then(
      (loaded) => live && setState(loaded),
      (error: unknown) => {
        if (!live) return;
        // The details are the engine's and TeX's, for developers; a user never sees LaTeX.
        console.error("The page could not be shown:", error);
        setFailed(true);
      },
    );
    return () => {
      live = false;
      engine.terminate();
    };
  }, []);
  if (failed) return <p>The page could not be shown.</p>;
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
