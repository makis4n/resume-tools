// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { curated } from "../templates/curated";
import type { TemplatePackage } from "../templates/package";
import { type Command, type Document, newDocument } from "./document";
import { Panel } from "./Panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Jake's package, with what an imported package's checks decide (decision 0026): kinds of unit a
// new one of which stops the compile, and an entry snippet with no place for bullets.
const { package: jake, sample } = curated("jake");

describe("the side panel, under an imported package's rules", () => {
  let host: HTMLElement;
  let root: Root;
  let sent: Command[];
  const doc: Document = newDocument("jake", sample, "en-US");

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    sent = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /** The panel for `pkg`, with the section titled `title` opened, as a click on it opens it. */
  function rendered(pkg: TemplatePackage, title: string) {
    act(() =>
      root.render(
        <Panel
          document={doc}
          pkg={pkg}
          onCommand={(command) => sent.push(command)}
          onSeal={() => {}}
        />,
      ),
    );
    const toggle = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === title,
    );
    if (toggle === undefined) throw new Error(`no section ${title}`);
    act(() => toggle.click());
    const item = toggle.closest("li");
    if (item === null) throw new Error("no row");
    return item;
  }

  /** The buttons of a section's row by their text. */
  const buttons = (row: Element, text: string) =>
    [...row.querySelectorAll("button")].filter((button) => button.textContent === text);

  it("disables adding a unit of a kind the template cannot take, and says why", () => {
    const pkg = { ...jake, fixed: ["entry", "section.list"] } as TemplatePackage;
    const row = rendered(pkg, "Experience");
    const [add] = buttons(row, "Add entry");
    expect(add?.disabled).toBe(true);
    expect(add?.title).toBe("The template cannot take another one of these");
    act(() => add?.click());
    expect(sent).toEqual([]);
    // The bullets it can take.
    for (const each of buttons(row, "Add bullet")) expect(each.disabled).toBe(false);
    // And a new section only of a kind it can take.
    const kinds = [...host.querySelectorAll("option")].map((option) => option.textContent);
    expect(kinds).toEqual(expect.arrayContaining(["Entries", "Labelled list", "Paragraph"]));
    expect(kinds).not.toContain("List");
  });

  it("disables adding a bullet to an entry whose snippet shows none, and not elsewhere", () => {
    const entry = jake.snippets.entry as Exclude<TemplatePackage["snippets"]["entry"], string>;
    const pkg = {
      ...jake,
      snippets: {
        ...jake.snippets,
        entry: {
          ...entry,
          default: "\\resumeSubheading\n  {{{title}}}{{{dates}}}\n  {{{subtitle}}}{{{place}}}",
        },
      },
    } as TemplatePackage;
    const experience = rendered(pkg, "Experience");
    const none = buttons(experience, "Add bullet");
    expect(none.length).toBeGreaterThan(0);
    for (const each of none) {
      expect(each.disabled).toBe(true);
      expect(each.title).toBe("The template sets no bullets for an entry of this section");
    }
    // Education's entries have a snippet of their own, with a list.
    const education = rendered(pkg, "Education");
    for (const each of buttons(education, "Add bullet")) expect(each.disabled).toBe(false);
    expect(buttons(education, "Add entry")[0]?.disabled).toBe(false);
  });
});
