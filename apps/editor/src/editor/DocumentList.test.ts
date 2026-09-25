import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Summary } from "../storage/store";
import { DocumentList, editedAgo } from "./DocumentList";

const NOW = Date.UTC(2026, 8, 25, 12);
const ago = (ms: number) => editedAgo(NOW - ms, NOW);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("editedAgo", () => {
  it("says how long ago in the largest whole unit", () => {
    expect(ago(5 * MINUTE + 59_000)).toBe("5 minutes ago");
    expect(ago(HOUR)).toBe("1 hour ago");
    expect(ago(3 * HOUR)).toBe("3 hours ago");
    expect(ago(26 * HOUR)).toBe("yesterday");
    expect(ago(3 * DAY)).toBe("3 days ago");
    expect(ago(8 * DAY)).toBe("last week");
    expect(ago(40 * DAY)).toBe("last month");
    expect(ago(400 * DAY)).toBe("last year");
    expect(ago(1_000 * DAY)).toBe("2 years ago");
  });

  it("says just now under a minute, and for a time a clock put in the future", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59_999)).toBe("just now");
    expect(ago(-HOUR)).toBe("just now");
    expect(ago(MINUTE)).toBe("1 minute ago");
  });

  it("says a time that is not one is unknown, rather than fail", () => {
    expect(editedAgo(Number.NEGATIVE_INFINITY, NOW)).toBe("at an unknown time");
    expect(editedAgo(Number.POSITIVE_INFINITY, NOW)).toBe("at an unknown time");
    expect(editedAgo(Number.NaN, NOW)).toBe("at an unknown time");
  });
});

describe("DocumentList", () => {
  /** The list as the server renders it, without the markers React puts between texts. */
  const render = (documents: Summary[]) =>
    renderToString(
      createElement(DocumentList, { documents, onOpen() {}, onNew() {}, onDelete() {} }),
    ).replaceAll("<!-- -->", "");

  it("renders a title as text, a template it lacks by its id, and a time it cannot tell", () => {
    const html = render([
      {
        id: "a",
        title: "<img src=x onerror=alert(1)>",
        template: "jake",
        createdAt: 0,
        updatedAt: NOW,
      },
      { id: "b", title: "Bo Lind", template: "later-template", createdAt: 0, updatedAt: -Infinity },
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Jake&#x27;s Resume, edited ");
    expect(html).toContain("later-template, edited at an unknown time");
  });
});
