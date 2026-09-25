import { type Section, YearMonth } from "@resume-tools/resume-model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { curated } from "../templates/curated";
import { apply, type Command, newDocument } from "./document";
import { fieldStatus, firstWords, holdsContent, Panel, plainText, thisMonth } from "./Panel";

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
    expect(plainText([{ text: "Draws " }, { text: "letters", italic: true }])).toBe(
      "Draws letters",
    );
  });
});

describe("Panel", () => {
  const render = (commands: Command[] = []) => {
    const doc = commands.reduce(apply, newDocument("jake", sample, "en-US"));
    return renderToStaticMarkup(<Panel document={doc} onCommand={() => {}} />);
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
});
