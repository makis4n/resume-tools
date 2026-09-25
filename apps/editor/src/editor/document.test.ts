import { Resume, type RichText } from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import { curated } from "../templates/curated";
import { generateBody } from "../templates/generate";
import { controlValuesFor, defaultControls, parsePackage } from "../templates/package";
import {
  apply,
  type Command,
  CommandError,
  Document,
  fieldsOf,
  HISTORY_LIMIT,
  History,
  newDocument,
} from "./document";

const { package: jake, sample } = curated("jake");

/**
 * A package invented for these tests that sets every slot a field can fill, so that its body
 * marks every field of a resume that has text in each.
 */
const EVERY = parsePackage({
  version: 1,
  id: "every",
  name: "Every field",
  engine: "pdftex",
  source: { url: "https://example.com/every", license: "MIT", attribution: "Invented for tests" },
  preamble: "\\documentclass{article}",
  controls: {},
  snippets: {
    document: "\\begin{document}\n{{header}}\n{{sections}}\n\\end{document}",
    header: "{{first}} {{last}} {{headline}}\n{{contacts}}",
    contact: { phone: "{{text}}", email: "{{text}}", location: "{{text}}" },
    link: { other: "{{label}}" },
    section: {
      entries: "{{title}}\n{{entries}}",
      list: "{{title}}\n{{items}}",
      labelled: "{{title}}\n{{items}}",
      paragraph: "{{title}}\n{{text}}",
    },
    entry: "{{title}} {{subtitle}} {{place}} {{dates}}\n{{bullets}}",
    bullet: "{{text}}",
    item: "{{text}}",
    labelledItem: "{{label}} {{text}}",
  },
});

/** An invented resume with every kind of node the model has, and every field filled in. */
const FULL = Resume.parse({
  version: 1,
  header: {
    name: { first: "Oriel", last: "Vantongeren" },
    headline: "Type designer",
    email: "oriel@example.com",
    phone: "+1 555 0147",
    location: "Duluth, MN",
    links: [{ id: "folio", kind: "website", label: "folio.example", href: "folio.example" }],
  },
  sections: [
    {
      id: "about",
      kind: "paragraph",
      role: "summary",
      title: "About",
      text: [{ text: "Draws " }, { text: "letters", italic: true }, { text: " for a living." }],
    },
    {
      id: "work",
      kind: "entries",
      role: "experience",
      title: "Work",
      entries: [
        {
          id: "kestrel",
          title: "Designer",
          subtitle: "Kestrel Foundry",
          place: "Remote",
          dates: { start: "2021-02", end: "present" },
          bullets: [{ id: "kestrel-1", text: [{ text: "Drew three text families." }] }],
        },
      ],
    },
    {
      id: "honours",
      kind: "list",
      role: "awards",
      title: "Honours",
      items: [{ id: "medal", text: [{ text: "Silver at a lettering show" }] }],
    },
    {
      id: "tools",
      kind: "labelled",
      role: "skills",
      title: "Tools",
      items: [{ id: "drawing", label: "Drawing", text: [{ text: "Glyphs, pencil" }] }],
    },
  ],
});

/** A map's keys in order, to compare the field ids of an index and of a body. */
const sortedKeys = (map: ReadonlyMap<string, unknown>) => [...map.keys()].sort();

describe("newDocument", () => {
  it("starts on the template's defaults, the page size following the locale", () => {
    const us = newDocument("jake", sample, "en-US");
    expect(us).toEqual({
      version: 1,
      template: "jake",
      resume: sample,
      controls: { pageSize: "letter", margins: 0.5, dateFormat: "MMM yyyy" },
    });
    expect(newDocument("jake", sample, "de-DE").controls.pageSize).toBe("a4");
    expect(newDocument("jake", sample).controls).toEqual(defaultControls(jake));
    // A copy, so nothing done to the document can reach the curated sample.
    expect(us.resume).not.toBe(sample);
  });

  it("throws for a template no curated package has", () => {
    expect(() => newDocument("nope", sample)).toThrow("no curated template has the id nope");
  });
});

describe("fieldsOf", () => {
  it("holds every field Jake's body marks for the sample, and the ones it leaves out", () => {
    const fields = fieldsOf(sample);
    const { texts } = generateBody(jake, sample, defaultControls(jake));
    for (const id of texts.keys()) expect(fields.has(id), id).toBe(true);
    // The sample has no headline or location, and its project no place, which Jake's projects
    // would not set anyway: fields a user may still fill in.
    expect(sortedKeys(fields).filter((id) => !texts.has(id))).toEqual([
      "header.headline",
      "header.location",
      "marginalia.place",
    ]);
  });

  it("holds exactly the fields a body marks, for a resume with every construct filled in", () => {
    expect(sortedKeys(fieldsOf(FULL))).toEqual(sortedKeys(generateBody(EVERY, FULL, {}).texts));
  });

  it("reads each kind of field where the resume keeps it", () => {
    const fields = fieldsOf(FULL);
    const read = (id: string) => fields.get(id)?.get(FULL);
    expect(read("header.first")).toBe("Oriel");
    expect(read("header.location")).toBe("Duluth, MN");
    expect(read("folio.label")).toBe("folio.example");
    expect(read("work.title")).toBe("Work");
    expect(read("kestrel.subtitle")).toBe("Kestrel Foundry");
    expect(read("kestrel.dates")).toEqual({ start: "2021-02", end: "present" });
    expect(read("kestrel-1.text")).toEqual([{ text: "Drew three text families." }]);
    expect(read("drawing.label")).toBe("Drawing");
    expect(read("about.text")).toHaveLength(3);
    expect(fields.get("kestrel.dates")?.kind).toBe("dates");
    expect(fields.get("medal.text")?.kind).toBe("rich");
    expect(fields.get("header.headline")?.kind).toBe("text");
  });

  it("refuses to write into a resume whose nodes have moved since the index was built", () => {
    const title = fieldsOf(sample).get("fennel.title");
    if (title?.kind !== "text") throw new Error("fennel.title is a text field");
    const moved = Resume.parse({ ...sample, sections: [...sample.sections].reverse() });
    expect(() => title.set(moved, "Staff Engineer")).toThrow("has moved");
  });
});

describe("apply", () => {
  const doc = newDocument("jake", sample, "en-US");

  /**
   * Apply a command and check that the field it names is all that changed: every other field
   * reads as before, the field set back to its old value gives the document it started from, and
   * the document given is untouched. Returns the new document.
   */
  function applyOnly(command: Command & { field: string }, value: unknown): Document {
    const before = structuredClone(doc);
    const after = apply(doc, command);
    const fields = fieldsOf(doc.resume);
    const field = fields.get(command.field);
    if (field === undefined) throw new Error(`no field ${command.field}`);
    expect(field.get(after.resume)).toEqual(value);
    for (const [id, other] of fields)
      if (id !== command.field) expect(other.get(after.resume), id).toEqual(other.get(doc.resume));
    // Deep-equal, not strict: a field the document left out comes back as undefined.
    const back = field.set(after.resume, field.get(doc.resume) as never);
    expect({ ...after, resume: back }).toEqual(doc);
    expect(doc).toStrictEqual(before);
    return after;
  }

  /** The document reads back as a document, and its controls as its template's. */
  function readsBack(after: Document) {
    expect(Document.parse(after)).toStrictEqual(after);
    expect(controlValuesFor(jake).parse(after.controls)).toStrictEqual(after.controls);
  }

  it("sets a text field and nothing else", () => {
    const after = applyOnly(
      { type: "text", field: "fennel.title", text: "Staff Engineer" },
      "Staff Engineer",
    );
    readsBack(after);
    // Only the path to the field is copied; the sections beside it are the same objects.
    expect(after.resume.sections[0]).toBe(doc.resume.sections[0]);
    // An optional field the sample leaves out, and an empty one.
    readsBack(applyOnly({ type: "text", field: "header.headline", text: "Engineer" }, "Engineer"));
    readsBack(applyOnly({ type: "text", field: "site.label", text: "" }, ""));
  });

  it("sets a rich field and nothing else", () => {
    const runs = [{ text: "Led " }, { text: "two", bold: true }, { text: " teams." }];
    const after = applyOnly({ type: "rich", field: "fennel-2.text", runs }, runs);
    readsBack(after);
    // The document keeps a copy of the runs, not the caller's.
    runs[0] = { text: "Changed " };
    expect(fieldsOf(after.resume).get("fennel-2.text")?.get(after.resume)).toEqual([
      { text: "Led " },
      { text: "two", bold: true },
      { text: " teams." },
    ]);
    readsBack(applyOnly({ type: "rich", field: "languages.text", runs: [] }, []));
  });

  it("sets an entry's dates and nothing else, and clears them without leaving a key", () => {
    const dates = { start: "2022", end: "2024-03" };
    readsBack(applyOnly({ type: "dates", field: "research.dates", dates }, dates));
    const cleared = applyOnly(
      { type: "dates", field: "research.dates", dates: undefined },
      undefined,
    );
    readsBack(cleared);
    const [, experience] = cleared.resume.sections;
    const research = experience?.kind === "entries" ? experience.entries[1] : undefined;
    expect(research?.id).toBe("research");
    expect(research && "dates" in research).toBe(false);
  });

  it("sets a control, and takes one back to the template's default", () => {
    const wide = apply(doc, { type: "control", name: "margins", value: 0.8 });
    expect(wide.controls).toEqual({ ...doc.controls, margins: 0.8 });
    expect(wide.resume).toBe(doc.resume);
    readsBack(wide);
    const a4 = apply(wide, { type: "control", name: "pageSize", value: "a4" });
    expect(a4.controls.pageSize).toBe("a4");
    readsBack(a4);
    const reset = apply(a4, { type: "control", name: "margins", value: undefined });
    expect(reset.controls).toEqual({ pageSize: "a4", dateFormat: "MMM yyyy" });
    expect("margins" in reset.controls).toBe(false);
    readsBack(reset);
  });

  it("throws for a field the document does not have, or one of another kind", () => {
    expect(() => apply(doc, { type: "text", field: "nowhere.title", text: "x" })).toThrow(
      new CommandError("the document has no field nowhere.title"),
    );
    // A link's address is not a field: the page never marks it.
    expect(() => apply(doc, { type: "text", field: "site.href", text: "x" })).toThrow(CommandError);
    expect(() => apply(doc, { type: "text", field: "fennel-1.text", text: "x" })).toThrow(
      "fennel-1.text is a rich field, not text",
    );
    expect(() => apply(doc, { type: "rich", field: "fennel.title", runs: [] })).toThrow(
      CommandError,
    );
    expect(() => apply(doc, { type: "dates", field: "fennel.title", dates: undefined })).toThrow(
      CommandError,
    );
  });

  it("throws for a control the template does not offer, or a value it refuses", () => {
    expect(() => apply(doc, { type: "control", name: "font", value: "sans" })).toThrow(
      CommandError,
    );
    expect(() => apply(doc, { type: "control", name: "margins", value: 1.5 })).toThrow(
      CommandError,
    );
    expect(() => apply(doc, { type: "control", name: "margins", value: 0.45 })).toThrow(
      CommandError,
    );
    const a5 = { type: "control", name: "pageSize", value: "a5" } as unknown as Command;
    expect(() => apply(doc, a5)).toThrow(CommandError);
  });

  it("throws for runs or dates the model refuses", () => {
    const coloured = [{ text: "x", colour: "red" }] as unknown as RichText;
    expect(() => apply(doc, { type: "rich", field: "fennel-1.text", runs: coloured })).toThrow(
      CommandError,
    );
    expect(() =>
      apply(doc, { type: "dates", field: "fennel.dates", dates: { start: "2020-13" } }),
    ).toThrow(CommandError);
  });
});

describe("History", () => {
  const titled = (text: string): Command => ({ type: "text", field: "fennel.title", text });
  const titleOf = (doc: Document | undefined) =>
    doc && fieldsOf(doc.resume).get("fennel.title")?.get(doc.resume);

  it("undoes and redoes along the stack, and a new command clears what was undone", () => {
    const history = new History(newDocument("jake", sample));
    const start = history.present;
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBeUndefined();
    const one = history.dispatch(titled("One"));
    const two = history.dispatch(titled("Two"));
    expect(history.present).toBe(two);
    expect(history.undo()).toBe(one);
    expect(history.undo()).toBe(start);
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe(one);
    expect(history.present).toBe(one);
    expect(history.canRedo).toBe(true);
    const three = history.dispatch(titled("Three"));
    expect(titleOf(three)).toBe("Three");
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeUndefined();
    expect(history.undo()).toBe(one);
    expect(history.undo()).toBe(start);
  });

  it("changes nothing for a command that throws", () => {
    const history = new History(newDocument("jake", sample));
    const start = history.present;
    expect(() => history.dispatch(titled("One"))).not.toThrow();
    history.undo();
    expect(() => history.dispatch({ type: "text", field: "nowhere.title", text: "x" })).toThrow(
      CommandError,
    );
    expect(history.present).toBe(start);
    expect(history.canRedo).toBe(true);
  });

  it(`keeps ${HISTORY_LIMIT} steps to undo, and lets the oldest go`, () => {
    const history = new History(newDocument("jake", sample));
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) history.dispatch(titled(`Title ${i}`));
    let steps = 0;
    while (history.undo() !== undefined) steps++;
    expect(steps).toBe(HISTORY_LIMIT);
    expect(titleOf(history.present)).toBe("Title 50");
    while (history.redo() !== undefined) steps--;
    expect(steps).toBe(0);
    expect(titleOf(history.present)).toBe(`Title ${HISTORY_LIMIT + 50}`);
  });
});
