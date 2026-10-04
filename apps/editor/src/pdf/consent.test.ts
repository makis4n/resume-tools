import { describe, expect, it } from "vitest";
import {
  browserConsent,
  CONSENT_DETAIL,
  CONSENT_KEY,
  CONSENT_QUESTION,
  memoryConsent,
  needsAsking,
  SENDING_NOTICE,
  SETTING_LABEL,
  type StorageLike,
  whoRead,
} from "./consent";

/** A storage in memory, as the browser's local storage behaves. */
function storage(): StorageLike & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe("the person's answer, kept in the browser", () => {
  it("is asked once: no answer until one is given, then the answer, read afresh each time", () => {
    const local = storage();
    const store = browserConsent(() => local);
    expect(store.get()).toBeUndefined();
    expect(needsAsking(store)).toBe(true);
    store.set("yes");
    expect(local.items.get(CONSENT_KEY)).toBe("yes");
    expect(needsAsking(store)).toBe(false);
    // Another page of the same browser, or a later visit, reads the same answer.
    expect(browserConsent(() => local).get()).toBe("yes");
    // The setting changes it, and the change holds at once.
    browserConsent(() => local).set("no");
    expect(store.get()).toBe("no");
  });

  it("takes no stored value but the two answers", () => {
    for (const value of ["", "Yes", "true", "maybe", '"yes"']) {
      const local = storage();
      local.items.set(CONSENT_KEY, value);
      expect(browserConsent(() => local).get(), value).toBeUndefined();
    }
  });

  it("keeps the answer for the page's life where the storage is missing or refuses", () => {
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    for (const store of [browserConsent(() => undefined), browserConsent(() => refusing)]) {
      expect(store.get()).toBeUndefined();
      store.set("yes");
      expect(store.get()).toBe("yes");
      store.set("no");
      expect(store.get()).toBe("no");
    }
  });

  it("is kept in memory for the tests", () => {
    const store = memoryConsent();
    expect(store.get()).toBeUndefined();
    store.set("no");
    expect(store.get()).toBe("no");
    expect(store.sets).toEqual(["no"]);
  });
});

describe("what the person is told", () => {
  it("says what is sent, where, and that nothing is kept, in plain words with no LaTeX", () => {
    expect(CONSENT_QUESTION).toMatch(/reading service/);
    expect(CONSENT_DETAIL).toMatch(/text of each line/);
    // Who receives it: the editor's service, and the hosted model it passes the lines to.
    expect(CONSENT_DETAIL).toMatch(/passes the lines to a hosted language model/);
    expect(CONSENT_DETAIL).toMatch(
      /The editor's service keeps none of your text, in a store or in a log/,
    );
    // What is promised of keeping is the editor's service's alone, not the model's host's.
    for (const words of [CONSENT_DETAIL, SENDING_NOTICE, SETTING_LABEL]) {
      expect(words).not.toMatch(/(?:model|its host)\S* keeps? none/i);
      expect(words).not.toMatch(/service and its model/i);
    }
    expect(SENDING_NOTICE).toMatch(/language model/);
    expect(SETTING_LABEL).toMatch(/language model/);
    expect(CONSENT_DETAIL).toMatch(/change it/);
    expect(SENDING_NOTICE).toMatch(/being sent/);
    expect(SENDING_NOTICE).toMatch(/keeps none/);
    expect(SETTING_LABEL).toMatch(/reading service/);
    for (const words of [CONSENT_QUESTION, CONSENT_DETAIL, SENDING_NOTICE, SETTING_LABEL])
      expect(words).not.toMatch(/\\|\{|\}|LaTeX|TeX/);
  });

  it("says who read a PDF, and why the rules did where they stood in", () => {
    expect(whoRead({ by: "model" })).toMatch(/model/);
    expect(whoRead({ by: "rules", fallback: "no consent" })).toMatch(/not sent/);
    expect(whoRead({ by: "rules", fallback: "timeout" })).toMatch(/in time/);
    expect(whoRead({ by: "rules", fallback: "failed" })).toMatch(/could not be reached/);
    expect(whoRead({ by: "rules", fallback: "wrong form" })).toMatch(/could not be used/);
    expect(whoRead({ by: "rules" })).toMatch(/in your browser/);
  });
});
