import { Resume, type Section, YearMonth } from "@resume-tools/resume-model";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { curated } from "../templates/curated";
import type { TemplatePackage } from "../templates/package";
import type { Field } from "../tex/fields";
import { apply, type Command, fieldsOf, newDocument } from "./document";
import {
  fieldStatus,
  firstWords,
  holdsContent,
  needsInput,
  Panel,
  plainText,
  REQUIRED,
  shownFieldsOf,
  thisMonth,
} from "./Panel";

const { sample } = curated("jake");

describe("firstWords", () => {
  it("keeps a short text whole, and cuts a long one after six words", () => {
    expect(firstWords("Led the migration.")).toBe("Led the migration.");
    expect(firstWords("one two three four five six")).toBe("one two three four five six");
    expect(firstWords("Led the migration of three services to a shared queue.")).toBe(
      "Led the migration of three services…",
    );
  });

  it("reads any run of whitespace as one space", () => {
    expect(firstWords("  Built\ta   pipeline\n")).toBe("Built a pipeline");
  });

  it("cuts a long word short too, since an address is one word", () => {
    const address = `quist.example.com/${"notes/".repeat(8)}`;
    expect(firstWords(address)).toBe(`${address.slice(0, 48)}…`);
    expect(firstWords("Typesetting", 6, 4)).toBe("Type…");
  });
});

describe("fieldStatus", () => {
  it("finds a field empty when the page would show nothing for it, as the generator does", () => {
    // A zero-width space is dropped from the page, so a field of one shows nothing either.
    for (const text of [undefined, "", "  \t", "​"])
      expect(fieldStatus(text, "Title"), JSON.stringify(text)).toBe("empty");
  });

  it("tells a field that holds its placeholder from one filled in", () => {
    expect(fieldStatus("Title", "Title")).toBe("placeholder");
    expect(fieldStatus("Staff Engineer", "Title")).toBe("filled");
    expect(fieldStatus("Title")).toBe("filled");
  });
});

describe("needsInput", () => {
  // Some of what a page of Jake's sample shows. Left off it are a projects entry's place, which
  // the projects variant has no slot for; a last name in a script the fonts lack, which sets no
  // glyph; and a bullet on the second page, which the editor does not draw.
  const shown = new Set(["header.first", "fennel.title", "fennel.place", "marginalia.title"]);

  it("leaves a filled field the page shows to the page, where it is edited", () => {
    expect(needsInput("fennel.title", "Software Engineer", "Title", shown)).toBe(false);
    expect(needsInput("header.first", "Mara", undefined, shown)).toBe(false);
  });

  it("gives a filled field the page does not show an input, whatever keeps it off", () => {
    const bullet = "Describe what you did";
    expect(needsInput("marginalia.place", "Portland, OR", "Place", shown)).toBe(true);
    expect(needsInput("header.last", "漢字", undefined, shown)).toBe(true);
    expect(needsInput("research-2.text", "Ran a pilot.", bullet, shown)).toBe(true);
  });

  it("gives an empty field an input, and one holding its placeholder, on the page or not", () => {
    expect(needsInput("fennel.place", "Place", "Place", shown)).toBe(true);
    expect(needsInput("marginalia.place", "Place", "Place", shown)).toBe(true);
    for (const text of [undefined, "", " "])
      expect(needsInput("fennel.place", text, "Place", shown), JSON.stringify(text)).toBe(true);
  });

  it("gives only an empty field or a placeholder an input before the first page", () => {
    expect(needsInput("marginalia.place", "Portland, OR", "Place", undefined)).toBe(false);
    expect(needsInput("marginalia.place", "Place", "Place", undefined)).toBe(true);
    expect(needsInput("marginalia.place", "", "Place", undefined)).toBe(true);
  });
});

describe("shownFieldsOf", () => {
  const drawnFrom = newDocument("jake", sample, "en-US");
  /** A field of a page, with as many glyphs as `glyphs`. */
  const field = (id: string, glyphs: number): [string, Field] => {
    const each = Array.from({ length: glyphs }, (_, item) => ({ item, text: "x", offset: item }));
    return [id, { id, glyphs: each }];
  };
  // The page drawn from the sample, in part: the last name and a section's title with glyphs, and
  // the first name with none, as if its letters set none.
  const page = {
    fields: new Map([field("header.first", 0), field("header.last", 5), field("exp.title", 10)]),
  };
  const latest = { page, document: drawnFrom };

  it("counts a field new since the page's document as shown, while its page is to come", () => {
    const present = apply(drawnFrom, {
      type: "structure",
      op: { op: "addSection", kind: "list", role: "skills" },
    });
    const title = `${present.resume.sections.at(-1)?.id}.title`;
    const shown = shownFieldsOf(latest, present);
    expect(shown?.has(title)).toBe(true);
    // So the new section's title, which is filled, gets no input for as long as the compile takes.
    expect(needsInput(title, "Skills", undefined, shown)).toBe(false);
  });

  it("goes by the page for a field its document had too", () => {
    const present = apply(drawnFrom, { type: "text", field: "header.first", text: "Maren" });
    const shown = shownFieldsOf(latest, present);
    expect(shown).toEqual(new Set(["header.last", "exp.title"]));
    expect(needsInput("header.first", "Maren", undefined, shown)).toBe(true);
  });

  it("is undefined before the first page, when every field counts as shown", () => {
    expect(shownFieldsOf(undefined, drawnFrom)).toBeUndefined();
  });

  it("counts no field as shown once the first page could not be made, so each needs an input", () => {
    // The side panel stays when the page cannot be shown, and is then the only way to take back
    // the edit that stopped the compile (decision 0013).
    const shown = shownFieldsOf(undefined, drawnFrom, true);
    expect(shown).toEqual(new Set());
    expect(needsInput("header.last", "Quist", undefined, shown)).toBe(true);
    // A page that came before the failure still shows its fields, which it leaves to itself.
    expect(shownFieldsOf(latest, drawnFrom, true)).toEqual(shownFieldsOf(latest, drawnFrom));
  });
});

describe("thisMonth", () => {
  it("is the year and the month, as the model writes a month", () => {
    expect(thisMonth(new Date(2026, 8, 25))).toBe("2026-09");
    expect(thisMonth(new Date(2027, 0, 1))).toBe("2027-01");
    expect(YearMonth.safeParse(thisMonth()).success).toBe(true);
  });
});

describe("holdsContent", () => {
  it("is whether removing a section would lose more than its title", () => {
    const base = { id: "extra", title: "Extra", role: "other" } as const;
    const empty: Section[] = [
      { ...base, kind: "entries", entries: [] },
      { ...base, kind: "list", items: [] },
      { ...base, kind: "labelled", items: [] },
      { ...base, kind: "paragraph", text: [{ text: " " }, { text: "" }] },
    ];
    for (const section of empty) expect(holdsContent(section), section.kind).toBe(false);
    for (const section of sample.sections) expect(holdsContent(section), section.id).toBe(true);
    expect(holdsContent({ ...base, kind: "paragraph", text: [{ text: "Writes." }] })).toBe(true);
    const locked = { id: "lock-a", kind: "locked", title: "", role: "other" } as const;
    expect(holdsContent({ ...locked, latex: "\\section*{Hobbies}" })).toBe(true);
    expect(holdsContent({ ...locked, latex: " \n" })).toBe(false);
    expect(plainText([{ text: "Draws " }, { text: "letters", italic: true }])).toBe(
      "Draws letters",
    );
  });
});

describe("Panel", () => {
  const render = (commands: Command[] = [], shownFields?: ReadonlySet<string>) => {
    const doc = commands.reduce(apply, newDocument("jake", sample, "en-US"));
    return renderToStaticMarkup(
      <Panel document={doc} shownFields={shownFields} onCommand={() => {}} onSeal={() => {}} />,
    );
  };

  it("shows the header's fields, the links and the sections, in plain English", () => {
    const html = render();
    for (const text of [
      "Header",
      "Links",
      "Sections",
      "Education",
      "Experience",
      "Projects",
      "Technical Skills",
      "Labelled list",
      "Add link",
      "Add section",
      'value="mara@example.com"',
      'value="https://quist.example.com"',
    ])
      expect(html).toContain(text);
    // The name is on the page, so it has no input here, and nothing holds a placeholder.
    expect(html).not.toContain("First name");
    expect(html).not.toContain("placeholder");
    expect(html).not.toContain("\\");
  });

  it("gives an empty field an input, and marks one that still holds its placeholder", () => {
    const html = render([
      { type: "text", field: "header.first", text: "" },
      { type: "structure", op: { op: "addLink" } },
    ]);
    expect(html).toContain("First name");
    expect(html).not.toContain("Last name");
    expect(html).toContain('value="example.com"');
    expect(html).toContain(">placeholder</small>");
  });

  it("gives a filled field the page does not show an input, and leaves the rest to it", () => {
    const every = new Set(fieldsOf(sample).keys());
    // A page that shows every field is as good as no page yet.
    expect(render([], every)).toBe(render());
    // A first name whose letters set no glyph, and a section's title on the second page.
    const shown = new Set([...every].filter((id) => id !== "header.first" && id !== "proj.title"));
    const html = render([], shown);
    expect(html).toContain("First name");
    expect(html).toContain('value="Mara"');
    expect(html).toContain('value="Projects"');
    expect(html).not.toContain("Last name");
    expect(html).not.toContain('value="Experience"');
  });

  type Props = Record<string, unknown>;

  /**
   * Every element a tree holds, depth first, with the components named in `expand` rendered in
   * place, as a shallow renderer would; they use no hooks, so each can be called as a function. Any
   * other component stays an element, whose handlers are the ones the browser would call.
   */
  function elementsOf(node: ReactNode, expand: ReadonlySet<string>): ReactElement<Props>[] {
    if (Array.isArray(node)) return node.flatMap((each) => elementsOf(each, expand));
    if (!isValidElement<Props>(node)) return [];
    const { type } = node;
    if (typeof type === "function" && expand.has(type.name))
      return elementsOf((type as (props: Props) => ReactNode)(node.props), expand);
    return [node, ...elementsOf(node.props.children as ReactNode, expand)];
  }

  it("sends what is typed into an input in the group of a visit to it, and nothing else in one", () => {
    const sent: [Command, string | undefined][] = [];
    const tree = Panel({
      document: newDocument("jake", sample, "en-US"),
      onCommand: (command, group) => sent.push([command, group]),
      onSeal: () => {},
    });
    // The header's fields and the links, each input typed into, each menu changed and each button
    // that is not disabled pressed, as the browser would.
    for (const { type, props } of elementsOf(
      tree,
      new Set(["HeaderFields", "Links", "Reorder", "AddButton"]),
    )) {
      const name = typeof type === "function" ? type.name : type;
      if (name === "TypedInput" || name === "FieldInput")
        (props.onChange as (text: string) => void)("Typed");
      if (name === "select")
        (props.onChange as (event: { target: { value: string } }) => void)({
          target: { value: "github" },
        });
      if (name === "button" && props.disabled !== true) (props.onClick as () => void)();
    }
    const setLink = (change: object) => ({
      type: "structure",
      op: { op: "setLink", id: "site", ...change },
    });
    const setHeader = (name: string) => ({
      type: "structure",
      op: { op: "setHeader", [name]: "Typed" },
    });
    expect(sent).toEqual([
      [{ type: "text", field: "header.first", text: "Typed" }, "field:header.first"],
      [{ type: "text", field: "header.last", text: "Typed" }, "field:header.last"],
      [setHeader("headline"), "header:headline"],
      [setHeader("email"), "header:email"],
      [setHeader("phone"), "header:phone"],
      [setHeader("location"), "header:location"],
      [setLink({ kind: "github" }), undefined],
      // The label is a field the page shows, and a visit to it in the panel is one to the field.
      [setLink({ label: "Typed" }), "field:site.label"],
      [setLink({ href: "Typed" }), "link:site"],
      [{ type: "structure", op: { op: "removeLink", id: "site" } }, undefined],
      [{ type: "structure", op: { op: "addLink" } }, undefined],
    ]);
  });

  it("shows a locked section as a row kept as it was, which moves and removes, and nothing of it", () => {
    const latex = "\\section*{Hobbies}\nRowing, chess.";
    const locked = { kind: "locked", id: "lock-q7w2e9", title: "", role: "other", latex } as const;
    const sections = [...sample.sections.slice(0, 1), locked, ...sample.sections.slice(1)];
    const kept = newDocument("jake", Resume.parse({ ...sample, sections }), "en-US");
    const html = renderToStaticMarkup(
      <Panel document={kept} onCommand={() => {}} onSeal={() => {}} />,
    );
    expect(html).toContain("Kept as it was");
    // No title, kind, role or text of it, and never its LaTeX.
    expect(html).not.toContain("Rowing");
    expect(html).not.toContain("\\");
    expect(html).not.toContain("Untitled section");
    const sent: Command[] = [];
    const tree = Panel({
      document: kept,
      onCommand: (command) => sent.push(command),
      onSeal: () => {},
    });
    // Its row, and the buttons the browser would press on it.
    const rows = elementsOf(tree, new Set(["Sections"])).filter(
      ({ type, props }) =>
        typeof type === "function" && type.name === "LockedRow" && props.index === 1,
    );
    expect(rows).toHaveLength(1);
    // Removing it loses what it holds, so the panel asks first, as for any section that holds any.
    const asked: string[] = [];
    vi.stubGlobal("confirm", (question: string) => asked.push(question) > 0);
    try {
      for (const { type, props } of elementsOf(rows, new Set(["LockedRow", "Reorder"])))
        if (type === "button" && props.disabled !== true) (props.onClick as () => void)();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(asked).toEqual(["Remove this section and everything in it?"]);
    expect(sent).toEqual([
      { type: "structure", op: { op: "moveSection", id: "lock-q7w2e9", to: 0 } },
      { type: "structure", op: { op: "moveSection", id: "lock-q7w2e9", to: 2 } },
      { type: "structure", op: { op: "removeSection", id: "lock-q7w2e9" } },
    ]);
  });

  it("gives every field an input when the first page could not be made", () => {
    const html = render([], shownFieldsOf(undefined, newDocument("jake", sample, "en-US"), true));
    for (const text of [
      "First name",
      'value="Mara"',
      "Last name",
      'value="Quist"',
      'value="Education"',
      'value="Technical Skills"',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("\\");
  });

  it("marks a field the package requires, saying why, whether it has an input or not", () => {
    // An imported package's required slots (decision 0026), given here to Jake's.
    const { package: jake } = curated("jake");
    const required = { header: ["location"], link: ["label"], section: ["title"] };
    const pkg = { ...jake, required } as TemplatePackage;
    const doc = newDocument("jake", sample, "en-US");
    const html = renderToStaticMarkup(
      <Panel document={doc} pkg={pkg} onCommand={() => {}} onSeal={() => {}} />,
    );
    const why = `title="${REQUIRED}"`;
    // The location's input and the link's label's, each with its mark.
    expect(html).toMatch(new RegExp(`Location<input [^>]*${why}[^>]*aria-required="true"`));
    expect(html).toContain(
      `<small style="color:#9a5b00;font-style:italic" ${why}>required</small>`,
    );
    // A section's title the page shows has no input here, and is marked by its label.
    expect(html).toContain(`${why}>Title required</small>`);
    expect(html.split("Title required")).toHaveLength(sample.sections.length + 1);
    // Nothing else is, and the curated package marks nothing.
    expect(html).not.toMatch(/Phone<input [^>]*aria-required/);
    const plain = renderToStaticMarkup(
      <Panel document={doc} onCommand={() => {}} onSeal={() => {}} />,
    );
    expect(plain).not.toContain("required");
    expect(html).not.toContain("\\");
  });

  it("gives no input to a slot the document keeps as its upload had it", () => {
    // An import keeps the header's location as the upload had it, where no field is (decision
    // 0026), and the panel, which gives the other contact fields an input, gives it none.
    const kept = structuredClone(sample);
    Object.assign(kept.header, { location: "", kept: ["location"] });
    const doc = { ...newDocument("jake", sample, "en-US"), resume: kept };
    const html = renderToStaticMarkup(
      <Panel document={doc} onCommand={() => {}} onSeal={() => {}} />,
    );
    expect(html).toContain("Phone");
    expect(html).not.toContain("Location");
  });
});
