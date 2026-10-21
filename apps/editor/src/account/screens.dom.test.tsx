// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Section } from "@resume-tools/resume-model";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import Dexie from "dexie";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { apply, type Document, newDocument } from "../editor/document";
import type { FakeAccounts, FakeServer } from "../storage/fake-server";
import { OPEN_WHEN_ONLINE } from "../storage/originals";
import { COPY_SUFFIX, DocumentStore } from "../storage/store";
import { curated } from "../templates/curated";
import { Account } from "./account";
import { STORAGE_KEY } from "./client";
import {
  ADD_QUESTION,
  addDetail,
  CHANGED_ON_DEVICE,
  copiedNotice,
  PLACE_MARKS,
  REFUSED_WHY,
  SAVING_NOTICE,
  SAVING_TITLE,
  SIGN_OUT_ANYWAY,
  SIGN_OUT_NOTE,
  SYNC_NOT_ALL,
  SYNC_OFFLINE,
  SYNC_SAVED,
  SYNC_SAVING,
  unsentNotice,
} from "./messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The account's screens (milestone 4 item 9), as a person meets them in the app: the header's state,
// the list's marks, the first save's notice, the first sign-in's question, the sign-out warning,
// the messages of another device's changes and of a document that cannot be opened offline. The
// app is rendered as it is, over the account's fake client, item 6's fake account in place of the
// table, an in-memory bucket in place of Storage, and a stand-in compiler. Every word and every
// address here is invented.

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("the real client is never made in these tests");
  },
}));

/** The account's side, as the mocks below reach it: the fake table, and how it answers. */
const net = vi.hoisted(() => ({
  accounts: undefined as unknown,
  /** Each server made, one per sign-in. */
  servers: [] as unknown[],
  /** A server is made offline, or refusing every write. */
  offline: false,
  refuse: false,
  /** The bucket cannot be reached. */
  bucketOffline: false,
}));

vi.mock("../storage/supabase-server", () => ({
  SupabaseServer: function SupabaseServer(_client: unknown, user: string) {
    const server = (net.accounts as FakeAccounts).server(user);
    if (net.offline) server.goOffline();
    if (net.refuse) server.refuse("23514");
    net.servers.push(server);
    return server;
  },
}));

vi.mock("../storage/originals-bucket", async () => {
  const { ServerUnavailable } = await import("../storage/server");
  return {
    SupabaseOriginals: function SupabaseOriginals(_client: unknown, user: string) {
      return {
        user,
        put: async () => {
          if (net.bucketOffline) throw new ServerUnavailable();
        },
        get: async () => {
          if (net.bucketOffline) throw new ServerUnavailable();
          return null;
        },
        remove: async () => {},
      };
    },
  };
});

/** A blank page of the document given, as the compiler draws one. */
const blank = (document: unknown) => {
  const page = {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792"></svg>',
    size: { width: 612, height: 792 },
    fields: new Map(),
    locked: new Map(),
    glyphs: [],
    pageCount: 1,
    unmatched: 0,
    missingFonts: new Map(),
  };
  return { page, pages: [page], body: { latex: "", texts: new Map() }, document, ms: 5 };
};

vi.mock("../editor/compiler", async (original) => ({
  ...(await original<typeof import("../editor/compiler")>()),
  Compiler: class {
    private readonly events: { page(shown: unknown): void };
    constructor(_engine: unknown, _fonts: unknown, events: { page(shown: unknown): void }) {
      this.events = events;
    }
    open(_pkg: unknown, document: unknown) {
      this.events.page(blank(document));
    }
    update() {}
    dropTemplate() {}
    close() {}
  },
}));

const USER = "00000000-0000-4000-8000-0000000000a1";
const EMAIL = "quill@example.test";
const TEMPLATE = "import-0123456789ab";

/** What no screen may show: LaTeX, or Supabase's words, codes or ids. */
const FORBIDDEN = [
  /\\[a-zA-Z]/,
  /\\begin/,
  /AuthApiError/,
  /JWT/,
  /PGRST/,
  /violates/i,
  /supabase/i,
  /23514|22P0[25]/,
  new RegExp(USER),
];

const session = () =>
  ({
    access_token: "invented.access.token",
    refresh_token: "invented-refresh",
    expires_at: 4102444800,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: USER, email: EMAIL },
  }) as unknown as Session;

/** The account's fake client, signed in with the stored session; `hold` delays its loading. */
function fakeClient(hold?: Promise<void>) {
  let now: Session | null = session();
  let listener: ((event: string, session: Session | null) => void) | undefined;
  const auth = {
    initialize: async () => ({ error: null }),
    getSession: async () => ({ data: { session: now }, error: null }),
    onAuthStateChange: (callback: typeof listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signOut: async () => {
      localStorage.removeItem(STORAGE_KEY);
      now = null;
      listener?.("SIGNED_OUT", null);
      return { error: null };
    },
  };
  const client = { auth } as unknown as SupabaseClient;
  return async () => {
    await hold;
    return client;
  };
}

let host: HTMLElement;
let root: Root;

/** Every text the page showed, screen by screen, which none of Supabase's or LaTeX's may be in. */
let seen: string[];

beforeEach(async () => {
  const { FakeAccounts } = await import("../storage/fake-server");
  net.accounts = new FakeAccounts();
  net.servers = [];
  net.offline = false;
  net.refuse = false;
  net.bucketOffline = false;
  seen = [];
  vi.stubGlobal("fetch", async (url: string) =>
    url === "/engine/manifest.json"
      ? new Response(JSON.stringify({ release: "invented", layout: 1, bundles: [], files: {} }))
      : new Response(null, { status: 404 }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  // Whatever screen a test reached, none showed LaTeX or Supabase's words.
  for (const text of seen) for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete (navigator as { onLine?: boolean }).onLine;
  await Dexie.delete("resume-tools");
});

const accounts = () => net.accounts as FakeAccounts;
const server = () => net.servers.at(-1) as FakeServer;

const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => new Promise((done) => setTimeout(done, 2)));
  seen.push(host.textContent ?? "");
};

const button = (text: string) =>
  [...host.querySelectorAll("button")].find((each) => each.textContent === text);

const click = async (text: string) => {
  const found = button(text);
  if (found === undefined) throw new Error(`no button "${text}"`);
  await act(async () => found.click());
  await settle();
};

/** The list's row of the document titled `title`, as it reads. */
const row = (title: string) =>
  [...host.querySelectorAll("li")].find((li) => li.querySelector("button")?.textContent === title)
    ?.textContent ?? "";

/** The header's quiet line of where the account's documents are. */
const line = () => host.querySelector("header [role=status]")?.textContent;

/** The app, signed in with a stored session, as a page loaded after an earlier sign-in. */
const signedIn = async (load = fakeClient()) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
  act(() => root.render(<App account={new Account({ load })} />));
  await settle();
};

/** A store of this browser's, before the app opens it, with `account`'s documents shown. */
async function before(
  act_: (store: DocumentStore) => Promise<void>,
  { account, told = true }: { account?: string; told?: boolean } = {},
) {
  const store = new DocumentStore();
  if (account !== undefined) store.setAccount(account);
  if (told) await store.markTold(USER);
  await act_(store);
  await store.flush();
  await store.close();
}

/** A new document from Jake's sample, with an invented first name; returns its id and title. */
async function made(store: DocumentStore, first: string) {
  const id = await store.create("jake", named(first));
  return { id, title: (await store.syncRow(id))?.title ?? "" };
}

const sample = curated("jake").sample;
const named = (first: string) =>
  apply(newDocument("jake", sample), { type: "text", field: "header.first", text: first }).resume;

/** Back to the list from the document the app opened. */
const toList = async () => {
  if (button("Documents") !== undefined) await click("Documents");
};

describe("the header's account state", () => {
  it("offers sign-in when signed out, and marks every document only in this browser", async () => {
    await before(async (store) => void (await made(store, "Ada")));
    act(() => root.render(<App account={new Account({ load: fakeClient() })} />));
    await settle();
    expect(button("Sign in")).toBeDefined();
    expect(host.textContent).not.toContain("Signed in as");
    expect(line()).toBeUndefined();
    await toList();
    expect(host.textContent).toContain(PLACE_MARKS["only-here"]);
    expect(button("Add to account")).toBeUndefined();
  });

  it("says it is checking while the session is read, then shows the account's menu", async () => {
    let ready = () => {};
    const hold = new Promise<void>((done) => {
      ready = done;
    });
    await signedIn(fakeClient(hold));
    expect(host.textContent).toContain("Checking your account…");
    ready();
    await settle();
    expect(host.textContent).not.toContain("Checking your account…");
    const menu = host.querySelector("header details");
    expect(menu?.querySelector("summary")?.textContent).toBe(`Signed in as ${EMAIL}`);
    expect([...(menu?.querySelectorAll("button") ?? [])].map((each) => each.textContent)).toEqual([
      "Change password",
      "Sign out",
    ]);
    expect(menu?.textContent).toContain(SIGN_OUT_NOTE);
  });

  it("says saved, saving and offline, quietly", async () => {
    await before(async (store) => void (await made(store, "Ada")), { account: USER });
    net.offline = true;
    await signedIn();
    // Not sent: the account cannot be reached.
    expect(line()).toBe(SYNC_SAVING);
    server().goOnline();
    await act(async () => window.dispatchEvent(new Event("online")));
    await settle();
    expect(line()).toBe(SYNC_SAVED);
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    await act(async () => window.dispatchEvent(new Event("offline")));
    await settle();
    expect(line()).toBe(SYNC_OFFLINE);
  });
});

describe("the first save's notice", () => {
  it("says what is sent and kept before anything is, and once per account", async () => {
    await before(async (store) => void (await made(store, "Ada")), { told: false });
    await signedIn();
    expect(host.textContent).toContain(SAVING_TITLE);
    expect(host.textContent).toContain(SAVING_NOTICE);
    // Nothing is sent, or even asked, before it is read; nor is the question asked yet.
    expect(net.servers).toEqual([]);
    expect(accounts().calls).toEqual([]);
    expect(host.textContent).not.toContain(ADD_QUESTION);

    await click("Save to my account");
    expect(host.textContent).not.toContain(SAVING_NOTICE);
    expect(accounts().count("list")).toBe(1);
    // Then the question about the document only in this browser, which is still not sent.
    expect(host.textContent).toContain(ADD_QUESTION);
    expect(accounts().count("insert")).toBe(0);

    // Remembered for the account: the next visit does not show it.
    act(() => root.unmount());
    root = createRoot(host);
    await signedIn();
    expect(host.textContent).not.toContain(SAVING_NOTICE);
    const store = new DocumentStore();
    expect(await store.wasTold(USER)).toBe(true);
    await store.close();
  });
});

describe("the first sign-in's question", () => {
  it("asks before sending documents only in this browser, and adds them all", async () => {
    let titles: string[] = [];
    await before(async (store) => {
      titles = [(await made(store, "Ada")).title, (await made(store, "Bo")).title];
    });
    await signedIn();
    expect(host.textContent).toContain(ADD_QUESTION);
    expect(host.textContent).toContain(addDetail(2));
    expect(accounts().count("insert")).toBe(0);

    await click("Add them");
    expect(host.textContent).not.toContain(ADD_QUESTION);
    expect(accounts().count("insert")).toBe(2);
    await toList();
    for (const title of titles) expect(row(title)).toContain(PLACE_MARKS["in-account"]);
  });

  it("leaves them for now, and adds each from the list", async () => {
    let ada = "";
    let bo = "";
    await before(async (store) => {
      ada = (await made(store, "Ada")).title;
      bo = (await made(store, "Bo")).title;
    });
    await signedIn();
    await click("Not now");
    expect(host.textContent).not.toContain(ADD_QUESTION);
    expect(accounts().count("insert")).toBe(0);
    await toList();
    expect(row(ada)).toContain(PLACE_MARKS["only-here"]);
    expect(row(bo)).toContain(PLACE_MARKS["only-here"]);

    const add = [...host.querySelectorAll("li")]
      .find((li) => li.textContent?.includes(ada))
      ?.querySelector<HTMLButtonElement>("button:nth-of-type(2)");
    expect(add?.textContent).toBe("Add to account");
    await act(async () => add?.click());
    await settle();
    expect(accounts().count("insert")).toBe(1);
    expect(row(ada)).toContain(PLACE_MARKS["in-account"]);
    expect(row(bo)).toContain(PLACE_MARKS["only-here"]);
  });
});

describe("the list's marks", () => {
  it("marks a document waiting while the account cannot be reached", async () => {
    let title = "";
    await before(async (store) => void ({ title } = await made(store, "Ada")), { account: USER });
    net.offline = true;
    await signedIn();
    await toList();
    expect(row(title)).toContain(PLACE_MARKS.waiting);
  });

  it("marks a document the account refused, and says why in plain words", async () => {
    let title = "";
    await before(async (store) => void ({ title } = await made(store, "Ada")), { account: USER });
    net.refuse = true;
    await signedIn();
    await toList();
    expect(row(title)).toContain(`${PLACE_MARKS.refused}. ${REFUSED_WHY}`);
    expect(line()).toBe(SYNC_NOT_ALL);
  });
});

describe("the sign-out warning", () => {
  it("names the documents not in the account, and asks", async () => {
    let title = "";
    await before(async (store) => void ({ title } = await made(store, "Ada")), { account: USER });
    net.offline = true;
    await signedIn();
    await click("Sign out");
    expect(host.textContent).toContain(unsentNotice([{ title }]));
    expect(host.textContent).toContain(SIGN_OUT_ANYWAY);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);

    await click("Stay signed in");
    expect(host.textContent).not.toContain(SIGN_OUT_ANYWAY);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);

    await click("Sign out");
    await click("Sign out anyway");
    expect(button("Sign in")).toBeDefined();
    expect(host.textContent).not.toContain(SIGN_OUT_ANYWAY);
    const store = new DocumentStore();
    expect(await store.syncRows()).toEqual([]);
    await store.close();
  });
});

describe("another device's changes", () => {
  /**
   * A document of the account's, in step with it in this browser at revision 1, open in the editor,
   * which another device then changes; with `edit`, this browser has a save the account has not
   * taken, made while the account could not be reached. The queue hears of the change as the
   * connection comes back.
   */
  async function changedElsewhere(edit: boolean): Promise<{ title: string }> {
    let id = "";
    let title = "";
    await before(
      async (store) => {
        ({ id } = await made(store, "Ada"));
        const kept = await store.syncRow(id);
        if (kept === undefined) throw new Error("not kept");
        accounts().anotherDevice(USER).insert({
          id,
          kind: "template",
          templateId: "jake",
          title: kept.title,
          document: kept.document,
        });
        await store.markSent(id, kept.revision, 1);
        if (edit) {
          const read = await store.get(id);
          if (read === undefined) throw new Error("not read");
          store.save(
            id,
            apply(read.document, { type: "text", field: "header.first", text: "Here" }),
            read.revision,
          );
        }
        await store.flush();
        title = (await store.syncRow(id))?.title ?? "";
      },
      { account: USER },
    );
    net.offline = true;
    await signedIn();
    await click(title);
    expect(button("Documents")).toBeDefined();
    accounts()
      .anotherDevice(USER)
      .change(id, ({ document }) => ({
        document: apply(document as Document, {
          type: "text",
          field: "header.first",
          text: "Elsewhere",
        }),
      }));
    server().goOnline();
    await act(async () => window.dispatchEvent(new Event("online")));
    await settle();
    return { title };
  }

  it("offers a Reload when the open document changed on another device", async () => {
    await changedElsewhere(false);
    expect(host.textContent).toContain(CHANGED_ON_DEVICE);
    expect(host.textContent).not.toContain("changed in another tab");
    await click("Reload");
    expect(host.textContent).not.toContain(CHANGED_ON_DEVICE);
  });

  it("says this device's version was kept as a copy when both changed it", async () => {
    const { title } = await changedElsewhere(true);
    const copy = `${title}${COPY_SUFFIX}`;
    const said = copiedNotice(copy, "conflict", true, COPY_SUFFIX);
    expect(said).toBe(
      `This document was changed on another device. Your version here was kept as “${copy}”.`,
    );
    expect(host.textContent).toContain(said);
    await click("Reload");
    await toList();
    expect(row(copy)).not.toBe("");
  });
});

describe("a brought-in import", () => {
  it("cannot be opened until the device is online, and says so", async () => {
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
    const document_ = newDocument("jake", named("Wren"));
    accounts()
      .anotherDevice(USER)
      .insert({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "tex",
        templateId: TEMPLATE,
        title: "Wren Invented",
        document: {
          ...document_,
          template: TEMPLATE,
          resume: { ...document_.resume, sections: [outline] },
        },
      });
    await before(async () => {});
    net.bucketOffline = true;
    await signedIn();
    expect(row("Wren Invented")).toContain(PLACE_MARKS["in-account"]);
    await click("Wren Invented");
    expect(host.querySelector("[role=alert]")?.textContent).toBe(OPEN_WHEN_ONLINE);
  });
});

describe("every account screen", () => {
  it("shows no LaTeX and none of Supabase's words", async () => {
    // Signed out, then the notice, the question, the marks, the sign-out warning.
    await before(
      async (store) => {
        await made(store, "Ada");
        await made(store, "Bo");
      },
      { told: false },
    );
    net.offline = true;
    await signedIn();
    await click("Save to my account");
    await click("Not now");
    await toList();
    const ada = [...host.querySelectorAll("li")]
      .find((li) => li.textContent?.includes(PLACE_MARKS["only-here"]))
      ?.querySelector<HTMLButtonElement>("button:nth-of-type(2)");
    await act(async () => ada?.click());
    await settle();
    expect(host.textContent).toContain(PLACE_MARKS.waiting);
    await click("Change password");
    await click("Sign out");
    expect(host.textContent).toContain(SIGN_OUT_ANYWAY);
    await click("Stay signed in");
    server().goOnline();
    server().refuse("23514");
    await act(async () => window.dispatchEvent(new Event("online")));
    await settle();
    expect(host.textContent).toContain(REFUSED_WHY);
    await click("Sign out");
    await click("Sign out anyway");
    expect(button("Sign in")).toBeDefined();
    await click("Sign in");

    expect(seen.length).toBeGreaterThan(10);
    for (const text of seen) for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
  });
});
