import type { Section } from "@resume-tools/resume-model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, type Place } from "../account/account";
import { createAccountClient, type SessionStorage } from "../account/client";
import { apply, type Document, newDocument } from "../editor/document";
import type { Imported, ImportReport } from "../import/run";
import { curated } from "../templates/curated";
import { TemplatePackage } from "../templates/package";
import { resolveTemplate } from "../templates/resolve";
import { Originals } from "./originals";
import { BUCKET, IMPORT_FILES, ORIGINAL, pathOf, SupabaseOriginals } from "./originals-bucket";
import { packOriginals } from "./originals-pack";
import { DocumentStore } from "./store";
import { SupabaseServer } from "./supabase-server";
import { SyncQueue } from "./sync";

// An imported `.tex` document's two files on the local Supabase stack (milestone 4 item 8,
// decisions 0090, 0091 and 0093): one account on two devices, each a client with its own session
// storage and a store on an IndexedDB of its own; and a second account, which reaches nothing of
// the first's. No TeX engine runs: the import is invented, its package built as the store's tests
// build one. Every address, file and word is invented. Skips without the stack (`test:integration`).

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mailpit = process.env.MAILPIT_URL;

const EDITOR = "http://localhost:5173/";
const TEMPLATE = "import-0a1b2c3d4e5f";

function memory(): SessionStorage {
  const kept = new Map<string, string>();
  return {
    getItem: (name) => kept.get(name) ?? null,
    setItem: (name, value) => void kept.set(name, value),
    removeItem: (name) => void kept.delete(name),
  };
}

function placeAt(href: string): Place {
  let at = href;
  return { href: () => at, replace: (next) => void (at = next) };
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function eventually(check: () => Promise<boolean> | boolean, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error("what was expected never came about");
}

const { sample } = curated("jake");

/**
 * An invented `.tex` import of a zip: Jake's package under an imported id, the zip as uploaded, and
 * a job holding its entries, a rewritten `.tex` and a picture's stand-in.
 */
function imported(first: string): Imported {
  const outline: Section = {
    kind: "outline",
    id: "outline",
    title: "",
    role: "other",
    parts: [
      { kind: "kept", latex: "\\begin{document}\n\\section*{" },
      { kind: "rich", id: "s1", text: [{ text: "Invented heading" }] },
      { kind: "kept", latex: "}\n\\end{document}" },
    ],
  };
  const pkg = TemplatePackage.parse({
    ...curated("jake").package,
    id: TEMPLATE,
    name: "Invented import",
  });
  const made = {
    ...apply(newDocument("jake", sample), { type: "text", field: "header.first", text: first }),
    template: TEMPLATE,
  } as Document;
  const tex = strToU8(`\\documentclass{invented}\n\\begin{document}${first}\\end{document}\n`);
  const cls = strToU8("% an invented class\n\\ProvidesClass{invented}\n");
  const zip = zipSync({ "cv/main.tex": tex, "cv/invented.cls": cls });
  return {
    package: pkg,
    document: { ...made, resume: { ...made.resume, sections: [outline] } },
    report: { compiles: 5, ms: 321, warnings: ["an invented warning"] } as unknown as ImportReport,
    upload: { files: [{ name: "invented.zip", bytes: zip }] },
    job: {
      files: {
        "main.tex": tex,
        "invented.cls": cls,
        "plain.tex": strToU8("% rewritten by the import\n"),
        "photo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]),
      },
      images: ["photo.png"],
    },
  };
}

describe.skipIf(!url || !key || !mailpit)(
  "an imported .tex document's files on the local stack",
  () => {
    const config = { url: url ?? "", key: key ?? "" };
    const invent = (name: string) =>
      `${name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
    const email = invent("originals");
    const otherEmail = invent("originals-other");
    const clients: SupabaseClient[] = [];
    const closing: (() => Promise<void>)[] = [];
    let devices = 0;

    const clearTo = async (to: string) => {
      const query = encodeURIComponent(`to:"${to}"`);
      await fetch(`${mailpit}/api/v1/search?query=${query}`, { method: "DELETE" });
    };

    async function linkTo(to: string): Promise<string> {
      const query = encodeURIComponent(`to:"${to}"`);
      for (let tries = 0; tries < 50; tries++) {
        const found = await fetch(`${mailpit}/api/v1/search?query=${query}`);
        const { messages } = (await found.json()) as { messages: { ID: string }[] };
        const message = messages[0];
        if (message !== undefined) {
          const read = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
          const { HTML } = (await read.json()) as { HTML: string };
          await clearTo(to);
          const href = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(HTML)?.[1];
          if (href === undefined) throw new Error("the email holds no sign-in link");
          return href.replaceAll("&amp;", "&");
        }
        await pause(200);
      }
      throw new Error(`no email reached ${to}`);
    }

    /** A client with no session: the browser's own, as a signed-out page would make it. */
    async function noSession(): Promise<SupabaseClient> {
      const client = await createAccountClient(config, { storage: memory() });
      clients.push(client);
      return client;
    }

    /** Sign a new device in as `to` by the email link, as the page does; its client and user id. */
    async function signedIn(to: string): Promise<{ client: SupabaseClient; user: string }> {
      const storage = memory();
      const client = await createAccountClient(config, { storage });
      clients.push(client);
      const asking = new Account({ load: async () => client, storage, place: placeAt(EDITOR) });
      let problem = await asking.sendLink(to);
      for (let tries = 0; problem !== undefined && tries < 5; tries++) {
        await pause(1100);
        problem = await asking.sendLink(to);
      }
      expect(problem).toBeUndefined();
      const response = await fetch(await linkTo(to), { redirect: "manual" });
      const back = response.headers.get("location") ?? "";
      const page = new Account({ load: async () => client, storage, place: placeAt(back) });
      page.start();
      await eventually(() => page.state().status !== "checking");
      expect(page.state().status).toBe("signed-in");
      const user = page.userId();
      if (user === undefined) throw new Error("signed in without a user id");
      return { client, user };
    }

    /** A device: a store of its own, its queue, and the originals as its hooks, on the account. */
    function device(client: SupabaseClient, user: string) {
      const idb = { indexedDB: new IDBFactory(), IDBKeyRange };
      const store = new DocumentStore({ name: `originals-integration-${++devices}`, idb });
      const originals = new Originals(store);
      originals.connect(new SupabaseOriginals(client, user));
      const queue = new SyncQueue({ store, locks: null, page: null, hooks: originals });
      closing.push(async () => {
        queue.close();
        await store.close();
      });
      return {
        store,
        queue,
        originals,
        open: async () => {
          await queue.signIn(user, new SupabaseServer(client, user));
          if (queue.asking > 0) await queue.answer("not-now");
        },
        inAccount: async (id: string) => (await store.places()).get(id) === "in-account",
      };
    }

    /** A file of the bucket as `client` downloads it: its bytes, or the error. */
    async function download(client: SupabaseClient, path: string) {
      const { data, error } = await client.storage.from(BUCKET).download(path);
      return { bytes: data === null ? null : new Uint8Array(await data.arrayBuffer()), error };
    }

    let ada: Awaited<ReturnType<typeof signedIn>>;
    let other: Awaited<ReturnType<typeof signedIn>>;

    beforeAll(async () => {
      await clearTo(email);
      await clearTo(otherEmail);
      ada = await signedIn(email);
      other = await signedIn(otherEmail);
    });

    afterAll(async () => {
      for (const close of closing.splice(0).reverse()) await close();
      for (const client of clients) await client.auth.stopAutoRefresh();
      await clearTo(email);
      await clearTo(otherEmail);
    });

    it("brings a .tex import's original and import files to a second device byte for byte, and deletes them with it", async () => {
      const second = await signedIn(email);
      expect(second.user).toBe(ada.user);
      const a = device(ada.client, ada.user);
      const b = device(second.client, ada.user);
      await a.open();
      await b.open();

      const made = imported("Ilse");
      const id = await a.store.importDocument(made);
      await eventually(() => a.inAccount(id));
      const onA = await a.store.templateOf(TEMPLATE, id);
      if (onA?.import === undefined) throw new Error("A keeps no import");

      // B lists it, and downloads nothing until it is opened.
      await b.open();
      expect((await b.store.list()).map((each) => each.id)).toContain(id);
      expect(await b.store.templateOf(TEMPLATE, id)).toBeUndefined();

      // Opened as the app opens it: both files arrive, and the document opens with its package.
      const template = await resolveTemplate(TEMPLATE, id, b.originals);
      expect(template?.package).toEqual(onA.package);
      const onB = await b.store.templateOf(TEMPLATE, id);
      expect(onB?.package).toEqual(onA.package);
      expect(onB?.import).toEqual(onA.import);
      const upload = onB?.import?.upload.files ?? [];
      expect(upload.map((file) => file.name)).toEqual(["invented.zip"]);
      expect([...(upload[0]?.bytes ?? [])]).toEqual([...(made.upload.files[0]?.bytes ?? [])]);
      for (const [path, bytes] of Object.entries(made.job.files))
        expect([...(onB?.import?.job.files[path] ?? [])]).toEqual([...bytes]);
      expect((await b.store.get(id))?.document).toEqual((await a.store.get(id))?.document);

      // Both files are in Ada's folder, as A packed them.
      const packed = packOriginals(onA.package, onA.import);
      const original = await download(ada.client, pathOf(ada.user, id, ORIGINAL));
      expect(original.error).toBeNull();
      expect(original.bytes).toEqual(packed.original);
      expect(unzipSync(original.bytes ?? new Uint8Array())).toEqual({
        "invented.zip": made.upload.files[0]?.bytes,
      });
      const bin = await download(ada.client, pathOf(ada.user, id, IMPORT_FILES));
      expect(bin.bytes).toEqual(packed.import);

      // Deleted on A: both files go, and B loses it.
      await a.queue.remove(id);
      await eventually(async () => (await a.store.syncRow(id)) === undefined);
      for (const name of [ORIGINAL, IMPORT_FILES])
        expect((await download(ada.client, pathOf(ada.user, id, name))).error).not.toBeNull();
      // The bucket says they are gone, rather than failing.
      expect(await new SupabaseOriginals(ada.client, ada.user).get(id)).toBeNull();
      await b.open();
      expect(await b.store.syncRow(id)).toBeUndefined();
      expect(await b.store.templateOf(TEMPLATE, id)).toBeUndefined();
    });

    describe("only its owner reaches an original (decision 0093)", () => {
      it("lets B and a client with no session read, list, select and write nothing of A's, and A read its original byte for byte", async () => {
        const a = device(ada.client, ada.user);
        await a.open();
        const made = imported("Oren");
        const id = await a.store.importDocument(made);
        await eventually(() => a.inAccount(id));
        const kept = await a.store.templateOf(TEMPLATE, id);
        if (kept?.import === undefined) throw new Error("A keeps no import");
        const originalPath = pathOf(ada.user, id, ORIGINAL);

        const strangers = [
          { who: "B", client: other.client },
          { who: "a client with no session", client: await noSession() },
        ];
        for (const { who, client } of strangers) {
          // Download fails.
          const got = await download(client, originalPath);
          expect(got.error, who).not.toBeNull();
          expect(got.bytes, who).toBeNull();
          // Listing A's folder, and the document's within it, shows nothing.
          for (const folder of [ada.user, `${ada.user}/${id}`]) {
            const listed = await client.storage.from(BUCKET).list(folder);
            expect(listed.data ?? [], `${who} lists ${folder}`).toEqual([]);
          }
          // Selecting A's row gives nothing.
          const row = await client.from("documents").select("id").eq("id", id);
          expect(row.data ?? [], who).toEqual([]);
          // Writing under A's folder is refused, as a new file and over A's.
          for (const path of [pathOf(ada.user, id, "planted.zip"), originalPath]) {
            const written = await client.storage
              .from(BUCKET)
              .upload(path, strToU8("invented"), { upsert: true, contentType: "application/zip" });
            expect(written.error, `${who} writes ${path}`).not.toBeNull();
          }
          // Deleting A's file takes nothing.
          await client.storage.from(BUCKET).remove([originalPath]);
        }

        // A reads its original byte for byte, unchanged by any of it.
        const own = await download(ada.client, originalPath);
        expect(own.error).toBeNull();
        expect(own.bytes).toEqual(packOriginals(kept.package, kept.import).original);
        expect(unzipSync(own.bytes ?? new Uint8Array())).toEqual({
          "invented.zip": made.upload.files[0]?.bytes,
        });
        const listed = await ada.client.storage.from(BUCKET).list(`${ada.user}/${id}`);
        expect((listed.data ?? []).map((file) => file.name).sort()).toEqual([
          IMPORT_FILES,
          ORIGINAL,
        ]);
      });
    });
  },
);
