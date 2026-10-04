// @vitest-environment jsdom
import { Resume } from "@resume-tools/resume-model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { outlinePackage, outlineResume } from "../import/outline";
import { curated } from "../templates/curated";
import type { TemplatePackage } from "../templates/package";
import { inventedOutline, outlineParts } from "../test/invented-outline";
import { type Command, type Document, fieldsOf, newDocument } from "./document";
import { keptSegments, outlineOf } from "./outline";
import { KEPT_AS_WRITTEN, NO_WORDS, OUTLINE, Panel } from "./Panel";

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
  function rendered(pkg: TemplatePackage, title: string, shown: Document = doc) {
    act(() =>
      root.render(
        <Panel
          document={shown}
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

  it("disables removing a unit of a kind the template cannot lose, and says why", () => {
    // Entries and sections of entries kept as they are: neither the Experience section nor its
    // entries can go, and its bullets can (decision 0038).
    const pkg = { ...jake, fixed: ["entry", "section.entries"] } as TemplatePackage;
    const row = rendered(pkg, "Experience");
    const experience = sample.sections.find((section) => section.title === "Experience");
    if (experience?.kind !== "entries") throw new Error("no experience");
    const bullets = experience.entries.reduce((sum, entry) => sum + entry.bullets.length, 0);
    const removes = buttons(row, "Remove");
    const refused = removes.filter((button) => button.disabled);
    // The section's own and each entry's.
    expect(refused).toHaveLength(1 + experience.entries.length);
    for (const each of refused)
      expect(each.title).toBe("The template cannot do without one of these");
    for (const each of refused) act(() => each.click());
    expect(sent).toEqual([]);
    expect(removes.filter((button) => !button.disabled)).toHaveLength(bullets);
    // A section of another kind, and its items, can go.
    const skills = rendered(pkg, "Technical Skills");
    const kept = buttons(skills, "Remove");
    expect(kept.length).toBeGreaterThan(1);
    for (const each of kept) expect(each.disabled).toBe(false);
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

  it("disables adding a unit to a list kept as it was imported, and says why", () => {
    // What an import keeps whole (decision 0026): the header's links, one entry's bullets and the
    // skills' items.
    const resume = structuredClone(doc.resume);
    resume.header.kept = ["links"];
    const [, experience, , skills] = resume.sections;
    if (experience?.kind !== "entries" || skills?.kind !== "labelled")
      throw new Error("the sample's sections");
    const [fennel] = experience.entries;
    if (fennel === undefined) throw new Error("the sample's entry");
    fennel.kept = ["bullets"];
    skills.kept = ["items"];
    const kept = "These were kept as they were imported, so none can be added here";
    const row = rendered(jake, "Experience", { ...doc, resume });
    const [first, second] = buttons(row, "Add bullet");
    expect(first?.disabled).toBe(true);
    expect(first?.title).toBe(kept);
    expect(second?.disabled).toBe(false);
    const [link] = [...host.querySelectorAll("button")].filter(
      (button) => button.textContent === "Add link",
    );
    expect(link?.disabled).toBe(true);
    expect(link?.title).toBe(kept);
    const items = rendered(jake, "Technical Skills", { ...doc, resume });
    expect(buttons(items, "Add item")[0]?.title).toBe(kept);
    act(() => first?.click());
    expect(sent).toEqual([]);
  });

  it("disables a locked part's steps the template stops after, and says why (decision 0041)", () => {
    // A part kept as it was, invented, as one that closes the list of the section above it.
    const id = "lock-q7w2e9";
    const locked = { kind: "locked", id, title: "", role: "other", latex: "\\section{Hobbies}" };
    const resume = Resume.parse({
      ...sample,
      sections: [...sample.sections.slice(0, 2), locked, ...sample.sections.slice(2)],
    });
    const pkg = { ...jake, pinned: { [id]: ["remove", "up"] } } as TemplatePackage;
    act(() =>
      root.render(
        <Panel
          document={{ ...doc, resume }}
          pkg={pkg}
          onCommand={(command) => sent.push(command)}
          onSeal={() => {}}
        />,
      ),
    );
    const row = [...host.querySelectorAll("li")].find(
      (item) => item.firstElementChild?.textContent === "Kept as it was",
    );
    if (row === undefined) throw new Error("no row of the part");
    const [up, down, remove] = [...row.querySelectorAll("button")];
    expect([up?.disabled, down?.disabled, remove?.disabled]).toEqual([true, false, true]);
    expect(up?.title).toBe("The template stops if this part moves up");
    expect(remove?.title).toBe("The template stops without this part, so it stays");
    expect(down?.title).toBe("Move down");
    act(() => up?.click());
    act(() => remove?.click());
    expect(sent).toEqual([]);
    act(() => down?.click());
    expect(sent).toEqual([{ type: "structure", op: { op: "moveSection", id, to: 3 } }]);
  });

  it("offers an imported outline's document none of the shared structure's fields or units", async () => {
    // A `.tex` import's package and document, invented: what the panel would add or change of a
    // header, a link, a section or an entry never reaches its page (decision 0049).
    const pkg = await outlinePackage({
      engine: "pdftex",
      preamble: "\\documentclass{article}\n",
      files: {},
      reference: { log: "" },
    });
    const resume = outlineResume([
      { kind: "kept", latex: "\\begin{document}\n\\section*{" },
      { kind: "rich", id: "s1", text: [{ text: "Invented heading" }] },
      { kind: "kept", latex: "}\n\\end{document}" },
    ]);
    if (resume === undefined) throw new Error("refused");
    const imported: Document = { version: 1, template: pkg.id, resume, controls: {} };
    act(() =>
      root.render(
        <Panel
          document={imported}
          pkg={pkg}
          onCommand={(command) => sent.push(command)}
          onSeal={() => {}}
        />,
      ),
    );
    const labels = [...host.querySelectorAll("label")].map((label) => label.textContent ?? "");
    expect(labels.filter((label) => /name|Kind|Role/.test(label))).toEqual([]);
    const texts = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(texts.filter((text) => /^Add /.test(text ?? ""))).toEqual([]);
    expect(host.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(host.textContent).toContain("Your resume as you imported it");
    expect(sent).toEqual([]);
  });

  it("shows an imported outline's parts in order, by their first words, in place of the form", async () => {
    // The invented outline (the second pass's item 7): its heading kept whole, a section's title,
    // its roles and their bullets, a paragraph kept whole, and a second section.
    const parts = outlineParts();
    // The last bullet emptied: the page shows nothing of it, so the panel gives it an input.
    parts[7] = { kind: "rich", id: "orrery", text: [] };
    const { pkg, document: imported } = await inventedOutline(parts);
    const outline = outlineOf(imported.resume);
    if (outline === undefined) throw new Error("no outline");
    const [heading] = keptSegments(outline);
    if (heading === undefined) throw new Error("no kept text");
    const opened: string[] = [];
    act(() =>
      root.render(
        <Panel
          document={imported}
          pkg={pkg}
          shownFields={
            new Set([...fieldsOf(imported.resume).keys()].filter((id) => id !== "orrery.text"))
          }
          retypes={new Map([[heading.id, undefined]])}
          onRetype={(part) => opened.push(part)}
          onCommand={(command, group) => sent.push(command) && group !== undefined}
          onSeal={() => {}}
        />,
      ),
    );
    expect(host.querySelector("legend")?.textContent).toBe(OUTLINE);
    const rows = [...host.querySelectorAll("fieldset > ol > li")].map((row) =>
      (row.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    expect(rows[0]).toBe(`Quill Wrenfield Harbour City, Eastmere${KEPT_AS_WRITTEN}Change words`);
    expect(rows[1]).toBe("Experience");
    // The roles, each a unit named by its first words.
    expect(rows[2]).toBe("Lantern Works 2021 -- 2024 Set…Mill and Sons 2019 Cut half…");
    expect(rows[3]).toBe(`Hobbies Rowing on the river most…${KEPT_AS_WRITTEN}Change words`);
    expect(rows[4]).toBe("Projects");
    // No form of the shared structure, and nothing of the LaTeX.
    expect(host.textContent).not.toMatch(/[\\{}]/);
    expect([...host.querySelectorAll("label")].map((label) => label.textContent)).toEqual(["Text"]);
    // The heading's kept text opens its editor on the page; the paragraph's, which the page has
    // not offered, waits for it.
    const buttons = [...host.querySelectorAll("button")];
    const change = buttons.filter((button) => button.textContent === "Change words");
    expect(change.map((button) => button.disabled)).toEqual([false, true]);
    act(() => change[0]?.click());
    expect(opened).toEqual([heading.id]);
    // A unit opens to show its parts: its fields, and its bullets, by their first words.
    const lantern = buttons.find((button) => button.textContent?.startsWith("Lantern Works"));
    act(() => lantern?.click());
    expect(lantern?.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain(
      "Lantern Works2021 -- 2024Set careful type for forty journals",
    );
    // The emptied bullet's input sends what is typed into it as its field's text.
    const input = host.querySelector("input");
    if (input === null) throw new Error("no input");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      set?.call(input, "Built a brass orrery");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      input.blur();
    });
    expect(sent).toEqual([
      { type: "rich", field: "orrery.text", runs: [{ text: "Built a brass orrery" }] },
    ]);
    // A unit with no words is named so.
    expect(NO_WORDS).toBe("No words");
  });
});
