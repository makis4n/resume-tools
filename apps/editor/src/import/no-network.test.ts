import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8 } from "fflate";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { JAKE_FORK } from "../test/jake-fork";
import { XETEX_RESUME } from "../test/xetex-resume";
import { readTree } from "./fonts";
import { treeImages } from "./intake";
import { isRefusal } from "./refusal";
import { type ImportDeps, importResume } from "./run";

// Decision 0049, and the privacy rule of decision 0047: a `.tex` import sends nothing, which this
// test holds. Every way a page or a worker could send something is stubbed to fail and to say so,
// and a whole import of invented resumes, one on each engine, must come through without one being
// tried. The naming step's modules, the assembly and the first pass's checks cannot even be
// loaded, and of the naming package only the masking the signatures step applies to definitions
// can be read: an import that reached any of the rest would fail. Every resume here is invented.

const { loaded } = vi.hoisted(() => ({
  loaded: (name: string) => () => {
    throw new Error(`a .tex import loaded ${name}, which it must not reach`);
  },
}));
vi.mock("@resume-tools/naming", async (importOriginal) => ({
  maskDefinition: (await importOriginal<typeof import("@resume-tools/naming")>()).maskDefinition,
}));
vi.mock("./naming", loaded("the naming request's builder"));
vi.mock("./service", loaded("the naming service's client"));
vi.mock("./privacy", loaded("the naming request's privacy gate"));
vi.mock("./assemble", loaded("the first pass's assembly"));
vi.mock("./validate", loaded("the first pass's checks"));

const tex = (name: string, text: string) => ({ name, bytes: strToU8(text) });

describe.skipIf(!engineAvailable())("a .tex import and the network (decision 0049)", () => {
  let deps: ImportDeps;
  beforeAll(async () => {
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    deps = {
      session: await startNodeSession(),
      fonts: new FontLibrary(new TexLiveIndex(manifest), async (path) =>
        readFileSync(join(ENGINE_DIR, "files", path)),
      ),
      tree: readTree(manifest.files, manifest.fonts),
      treeImage: treeImages(
        manifest.files,
        (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
      ),
    };
  }, 60_000);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Every way to send something, stubbed to record its name and fail: `fetch`, `XMLHttpRequest`,
   * `WebSocket`, `EventSource`, `navigator.sendBeacon`, and an image's or a script's address, which
   * a page fetches as soon as it is set.
   */
  function stubNetwork(): string[] {
    const tried: string[] = [];
    const refuse = (name: string) => {
      tried.push(name);
      throw new Error(`${name} was called during an import`);
    };
    const refusing = (name: string) =>
      class {
        constructor() {
          refuse(name);
        }
      };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => refuse("fetch")),
    );
    vi.stubGlobal("XMLHttpRequest", refusing("XMLHttpRequest"));
    vi.stubGlobal("WebSocket", refusing("WebSocket"));
    vi.stubGlobal("EventSource", refusing("EventSource"));
    vi.stubGlobal("Image", refusing("Image"));
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      sendBeacon: () => refuse("navigator.sendBeacon"),
    });
    return tried;
  }

  test("a .tex import makes no network request", async () => {
    const tried = stubNetwork();
    for (const [name, source] of [
      ["resume.tex", JAKE_FORK],
      ["cv.tex", XETEX_RESUME],
    ] as const) {
      const outcome = await importResume([tex(name, source)], deps);
      if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
      expect(outcome.document.resume.sections.map((section) => section.kind)).toEqual(["outline"]);
      expect(outcome.report.outline.fields).toBeGreaterThan(5);
    }
    expect(tried).toEqual([]);
    // The stubs refuse, so that one tried would have shown here as a failure too.
    expect(() => fetch("https://example.invalid/")).toThrow("fetch was called during an import");
    expect(tried).toEqual(["fetch"]);
  }, 60_000);
});
