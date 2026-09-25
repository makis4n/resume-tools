import {
  type Entry,
  Id,
  Resume,
  type RichText,
  SECTION_KINDS,
  type Section,
  type SectionKind,
} from "@resume-tools/resume-model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { curated } from "../templates/curated";
import { generateBody } from "../templates/generate";
import { controlValuesFor, defaultControls, parsePackage } from "../templates/package";
import {
  apply,
  type Command,
  CommandError,
  Document,
  dropRefusedChoices,
  fieldsOf,
  HISTORY_LIMIT,
  History,
  mintId,
  newDocument,
  type StructureOp,
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
  it("keeps only the page size the locale chooses, and leaves the rest to the defaults", () => {
    const us = newDocument("jake", sample, "en-US");
    expect(us).toEqual({
      version: 1,
      template: "jake",
      resume: sample,
      controls: { pageSize: "letter" },
    });
    expect(newDocument("jake", sample, "de-DE").controls).toEqual({ pageSize: "a4" });
    expect(newDocument("jake", sample).controls).toEqual({});
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
    expect(reset.controls).toEqual({ pageSize: "a4" });
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

describe("dropRefusedChoices", () => {
  /** A stored document for `template`, with the choices given. */
  const stored = (template: string, controls: object): Document =>
    Document.parse({ version: 1, template, resume: sample, controls });

  it("drops a choice for a control the template no longer offers, and keeps the rest", () => {
    // A package that offers no font or font size, as Jake's Resume did before item 17.
    const fewer = parsePackage({
      ...EVERY,
      id: "fewer",
      controls: {
        pageSize: { default: "letter", apply: { letter: "", a4: "" } },
        margins: { default: 0.5, apply: "" },
        density: { default: "normal", apply: { compact: "", normal: "", relaxed: "" } },
        dateFormat: { default: "MMM yyyy" },
      },
    });
    const doc = stored("fewer", {
      pageSize: "a4",
      margins: 0.7,
      fontSize: 11,
      font: "lato",
      density: "compact",
      dateFormat: "yyyy",
    });
    const before = structuredClone(doc);
    const { document, dropped } = dropRefusedChoices(fewer, doc);
    expect(dropped).toEqual(["fontSize", "font"]);
    expect(document.controls).toEqual({
      pageSize: "a4",
      margins: 0.7,
      density: "compact",
      dateFormat: "yyyy",
    });
    expect(controlValuesFor(fewer).parse(document.controls)).toEqual(document.controls);
    expect(document.resume).toBe(doc.resume);
    expect(doc).toStrictEqual(before);
  });

  it("drops a font the template no longer lists", () => {
    const fonts = parsePackage({
      ...EVERY,
      controls: {
        font: {
          default: "serif",
          choices: [
            { id: "serif", name: "Serif", apply: "\\rmfamily" },
            { id: "sans", name: "Sans", apply: "\\sffamily" },
          ],
        },
      },
    });
    const { document, dropped } = dropRefusedChoices(
      fonts,
      stored("every", { font: "mono", dateFormat: "MM/yyyy" }),
    );
    expect(dropped).toEqual(["font"]);
    expect(document.controls).toEqual({ dateFormat: "MM/yyyy" });
    expect(dropRefusedChoices(fonts, stored("every", { font: "sans" })).dropped).toEqual([]);
  });

  it("gives back the document itself when the template refuses nothing", () => {
    const doc = newDocument("jake", sample, "en-GB");
    expect(dropRefusedChoices(jake, doc)).toEqual({ document: doc, dropped: [] });
    expect(dropRefusedChoices(jake, doc).document).toBe(doc);
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

  describe("a step of several commands", () => {
    // The group the editor gives a visit to the title (item 12).
    const visit = "field:fennel.title";
    const placed = (text: string): Command => ({ type: "text", field: "fennel.place", text });

    it("takes back three commands in one group in one undo, and redo gives back its end", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      history.dispatch(titled("O"), visit);
      history.dispatch(titled("On"), visit);
      const end = history.dispatch(titled("One"), visit);
      expect(history.canUndo).toBe(true);
      expect(history.undo()).toBe(start);
      expect(history.canUndo).toBe(false);
      expect(history.redo()).toBe(end);
      expect(titleOf(history.present)).toBe("One");
      expect(history.canRedo).toBe(false);
    });

    it("begins a step for a command in another group, and in the same one after a seal", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      history.dispatch(titled("O"), visit);
      const title = history.dispatch(titled("One"), visit);
      history.dispatch(placed("O"), "field:fennel.place");
      const place = history.dispatch(placed("Oslo"), "field:fennel.place");
      history.seal();
      history.dispatch(placed("Oslo, N"), "field:fennel.place");
      history.dispatch(placed("Oslo, NO"), "field:fennel.place");
      expect(history.undo()).toBe(place);
      expect(history.undo()).toBe(title);
      expect(history.undo()).toBe(start);
      expect(history.canUndo).toBe(false);
    });

    it("gives a command without a group a step of its own, which ends the step before it", () => {
      // A structure op and a control's change, which the editor dispatches with no group.
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      const one = history.dispatch(titled("One"), visit);
      const added = history.dispatch({
        type: "structure",
        op: { op: "addBullet", entry: "fennel" },
      });
      const compact = history.dispatch({ type: "control", name: "density", value: "compact" });
      history.dispatch(titled("One two"), visit);
      const end = history.dispatch(titled("One two three"), visit);
      expect(history.undo()).toBe(compact);
      expect(history.undo()).toBe(added);
      expect(history.undo()).toBe(one);
      expect(history.undo()).toBe(start);
      expect(history.redo()).toBe(one);
      expect(history.redo()).toBe(added);
      expect(history.redo()).toBe(compact);
      expect(history.redo()).toBe(end);
      expect(history.canRedo).toBe(false);
    });

    it("ends a step at an undo or a redo, so that its group's next command begins another", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      history.dispatch(titled("One"), visit);
      expect(history.undo()).toBe(start);
      const two = history.dispatch(titled("Two"), visit);
      // A new command after an undo clears what was undone, in a group or not.
      expect(history.canRedo).toBe(false);
      expect(history.undo()).toBe(start);
      expect(history.redo()).toBe(two);
      history.dispatch(titled("Two three"), visit);
      expect(history.undo()).toBe(two);
      expect(history.undo()).toBe(start);
    });

    it("keeps a step open past a command that throws, which changes nothing", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      const one = history.dispatch(titled("One"), visit);
      const nowhere: Command = { type: "text", field: "nowhere.title", text: "x" };
      expect(() => history.dispatch(nowhere, visit)).toThrow(CommandError);
      expect(history.present).toBe(one);
      history.dispatch(titled("One two"), visit);
      expect(history.undo()).toBe(start);
      expect(history.canUndo).toBe(false);
    });

    it(`counts steps against the bound of ${HISTORY_LIMIT}, however many commands each took`, () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      for (let i = 1; i <= 2 * HISTORY_LIMIT; i++) history.dispatch(titled(`Title ${i}`), visit);
      expect(history.undo()).toBe(start);
      for (let step = 1; step <= HISTORY_LIMIT + 10; step++) {
        for (const text of [`${step}`, `Title ${step}`]) history.dispatch(titled(text), visit);
        history.seal();
      }
      let steps = 0;
      while (history.undo() !== undefined) steps++;
      expect(steps).toBe(HISTORY_LIMIT);
      // The ten oldest steps went, so the oldest kept begins where the tenth ended.
      expect(titleOf(history.present)).toBe("Title 10");
    });
  });

  describe("only a change is a step", () => {
    const visit = "field:fennel.title";
    // The sample's own title for the entry, which a command can set again.
    const title = "Software Engineer";
    const compact: Command = { type: "control", name: "density", value: "compact" };
    const datesOf = (doc: Document) => fieldsOf(doc.resume).get("fennel.dates")?.get(doc.resume);

    it("makes no step for a command that leaves the document as it was, and gives back the present", () => {
      // As a click on the density button already pressed sends.
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      const once = history.dispatch(compact);
      expect(history.dispatch(compact)).toBe(once);
      expect(history.dispatch(titled(title))).toBe(once);
      expect(history.undo()).toBe(start);
      expect(history.canUndo).toBe(false);
    });

    it("keeps what could be redone past a command that changes nothing", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      const one = history.dispatch(titled("One"));
      const two = history.dispatch(compact);
      history.undo();
      history.undo();
      expect(history.dispatch(titled(title), visit)).toBe(start);
      history.seal();
      expect(history.canUndo).toBe(false);
      expect(history.redo()).toBe(one);
      expect(history.redo()).toBe(two);
    });

    it("drops a visit that ends where it began, and gives back what it had cleared", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      const one = history.dispatch(titled("One"));
      history.undo();
      // Typed, then deleted again: while the visit is open, what was undone cannot be redone.
      history.dispatch(titled(`${title}s`), visit);
      const back = history.dispatch(titled(title), visit);
      expect(history.canRedo).toBe(false);
      history.seal();
      expect(history.present).toBe(back);
      expect(history.canUndo).toBe(false);
      expect(history.redo()).toBe(one);
      expect(history.undo()?.resume).toEqual(start.resume);
    });

    it("drops a visit to the dates that ends where it began, though the dates' key has moved", () => {
      // The present box ticked off and on again: the dates are set anew, after the entry's
      // bullets, and are the same.
      const history = new History(newDocument("jake", sample));
      const field = "fennel.dates";
      const dates = datesOf(history.present);
      expect(dates).toEqual({ start: "2020-07", end: "present" });
      history.dispatch({ type: "dates", field, dates: { start: "2020-07" } }, `field:${field}`);
      history.dispatch(
        { type: "dates", field, dates: { start: "2020-07", end: "present" } },
        `field:${field}`,
      );
      history.seal();
      expect(history.canUndo).toBe(false);
      expect(datesOf(history.present)).toEqual(dates);
    });

    it("undoes the step before a visit that ends where it began, when undo ends the visit", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      history.dispatch(compact);
      history.dispatch(titled(`${title}s`), visit);
      history.dispatch(titled(title), visit);
      expect(history.undo()).toBe(start);
      expect(history.canUndo).toBe(false);
    });

    it("lets a visit that ends where it began push no step out of the bound", () => {
      const history = new History(newDocument("jake", sample));
      const start = history.present;
      for (let i = 1; i <= HISTORY_LIMIT; i++) history.dispatch(titled(`Title ${i}`));
      history.dispatch(titled("Title"), visit);
      history.dispatch(titled(`Title ${HISTORY_LIMIT}`), visit);
      history.seal();
      let steps = 0;
      while (history.undo() !== undefined) steps++;
      expect(steps).toBe(HISTORY_LIMIT);
      expect(history.present).toBe(start);
    });
  });
});

describe("mintId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives the prefix, a hyphen and six lowercase letters and digits, an id the model takes", () => {
    for (const prefix of ["sec", "ent", "bul", "itm", "lnk"]) {
      const id = mintId(prefix, new Set());
      expect(id).toMatch(new RegExp(`^${prefix}-[a-z0-9]{6}$`));
      expect(Id.safeParse(id).success, id).toBe(true);
    }
  });

  it("never gives a taken id, and draws again until it has one that is free", () => {
    // Each draw fills the six bytes with its own number, so the draws are aaaaaa, bbbbbb, cccccc.
    let draws = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (array instanceof Uint8Array) array.fill(draws);
      draws++;
      return array;
    });
    expect(mintId("ent", new Set(["ent-aaaaaa", "ent-bbbbbb"]))).toBe("ent-cccccc");
    expect(draws).toBe(3);
    // The first draw again, under a prefix that has none of the taken ids.
    draws = 0;
    expect(mintId("bul", new Set(["ent-aaaaaa"]))).toBe("bul-aaaaaa");
    expect(draws).toBe(1);
  });
});

describe("structure", () => {
  const doc = newDocument("jake", sample, "en-US");
  const full = newDocument("jake", FULL, "en-US");
  const structural = (op: StructureOp): Command => ({ type: "structure", op });

  /**
   * Apply a structure op and check what every op keeps: the document given is untouched, and the
   * one made reads back as a document, so its ids are still unique across it. Returns the new one.
   */
  function restructured(from: Document, op: StructureOp): Document {
    const before = structuredClone(from);
    const after = apply(from, structural(op));
    expect(Document.parse(after)).toStrictEqual(after);
    expect(from).toStrictEqual(before);
    return after;
  }

  const ids = (nodes: readonly { id: string }[]) => nodes.map((node) => node.id);

  /** An id `mintId` made, which a test cannot know, under its prefix. */
  const minted = (prefix: string) => expect.stringMatching(new RegExp(`^${prefix}-[a-z0-9]{6}$`));

  /** The section `id` of a resume, which must be of `kind`. */
  function sectionOf<K extends SectionKind>(resume: Resume, id: string, kind: K) {
    const section = resume.sections.find((each) => each.id === id);
    if (section?.kind !== kind) throw new Error(`the resume has no ${kind} section ${id}`);
    return section as Extract<Section, { kind: K }>;
  }

  function entryOf(resume: Resume, id: string): Entry {
    for (const section of resume.sections) {
      const entry = section.kind === "entries" && section.entries.find((each) => each.id === id);
      if (entry) return entry;
    }
    throw new Error(`the resume has no entry ${id}`);
  }

  it("adds a section of each kind, titled for its role and empty, at the end or an index", () => {
    const empty = {
      entries: { entries: [] },
      list: { items: [] },
      labelled: { items: [] },
      paragraph: { text: [] },
    };
    for (const kind of SECTION_KINDS) {
      const after = restructured(doc, { op: "addSection", kind, role: "awards" });
      expect(ids(after.resume.sections).slice(0, -1)).toEqual(ids(doc.resume.sections));
      expect(after.resume.sections.at(-1)).toEqual({
        id: minted("sec"),
        kind,
        title: "Awards",
        role: "awards",
        ...empty[kind],
      });
    }
    const first = restructured(doc, { op: "addSection", kind: "list", role: "skills", at: 0 });
    expect(first.resume.sections[0]?.title).toBe("Skills");
    expect(ids(first.resume.sections).slice(1)).toEqual(ids(doc.resume.sections));
  });

  it("removes a section with everything in it, and moves one, leaving the rest as they were", () => {
    const removed = restructured(doc, { op: "removeSection", id: "exp" });
    expect(ids(removed.resume.sections)).toEqual(["edu", "proj", "skills"]);
    expect(fieldsOf(removed.resume).has("fennel-1.text")).toBe(false);
    const up = restructured(doc, { op: "moveSection", id: "skills", to: 0 });
    expect(ids(up.resume.sections)).toEqual(["skills", "edu", "exp", "proj"]);
    const down = restructured(doc, { op: "moveSection", id: "edu", to: 1 });
    expect(ids(down.resume.sections)).toEqual(["exp", "edu", "proj", "skills"]);
    // The section moves whole, and the ones it passes are the same objects.
    expect(up.resume.sections[0]).toBe(doc.resume.sections[3]);
    expect(up.resume.sections[1]).toBe(doc.resume.sections[0]);
  });

  it("throws for an index outside the list, where a node is added or moved", () => {
    for (const to of [-1, 4, 1.5, Number.NaN])
      expect(() => apply(doc, structural({ op: "moveSection", id: "edu", to })), `${to}`).toThrow(
        CommandError,
      );
    expect(() => apply(doc, structural({ op: "moveSection", id: "edu", to: 4 }))).toThrow(
      "edu cannot move to 4 in a list of 4",
    );
    const past = structural({ op: "addSection", kind: "list", role: "skills", at: 5 });
    expect(() => apply(doc, past)).toThrow("a list of 4 has no place 5 for a new node");
    // The end is a place for a new node, though not for one that moves.
    const end = restructured(doc, { op: "addSection", kind: "list", role: "skills", at: 4 });
    expect(end.resume.sections).toHaveLength(5);
    for (const op of [
      { op: "addEntry", section: "exp", at: -1 },
      { op: "moveEntry", id: "fennel", to: 2 },
      { op: "addBullet", entry: "fennel", at: 4 },
      { op: "moveBullet", id: "fennel-1", to: 3 },
      // The research entry's bullets are a list of their own, whatever fennel's holds.
      { op: "moveBullet", id: "research-1", to: 2 },
      { op: "addItem", section: "skills", at: 3 },
      { op: "moveItem", id: "tools", to: -1 },
      { op: "addLink", at: 2 },
      { op: "moveLink", id: "site", to: 1 },
    ] satisfies StructureOp[])
      expect(() => apply(doc, structural(op)), op.op).toThrow(CommandError);
  });

  it("sets a section's role and nothing else, and refuses a role or kind the model lacks", () => {
    const after = restructured(doc, { op: "setSection", id: "proj", role: "other" });
    expect(after.resume.sections[2]).toEqual({ ...doc.resume.sections[2], role: "other" });
    expect(after.resume.sections[1]).toBe(doc.resume.sections[1]);
    expect(restructured(doc, { op: "setSection", id: "proj" }).resume).toBe(doc.resume);
    const hobbies = { op: "setSection", id: "proj", role: "hobbies" } as unknown as StructureOp;
    expect(() => apply(doc, structural(hobbies))).toThrow("a section's role cannot be hobbies");
    const table = { op: "addSection", kind: "table", role: "other" } as unknown as StructureOp;
    expect(() => apply(doc, structural(table))).toThrow("a section's kind cannot be table");
  });

  it("adds an entry with its placeholders, and removes and moves one within its section", () => {
    const added = restructured(doc, { op: "addEntry", section: "exp" });
    const { entries } = sectionOf(added.resume, "exp", "entries");
    expect(ids(entries).slice(0, 2)).toEqual(["fennel", "research"]);
    // No dates and no bullets: the page's picker and the panel add those.
    expect(entries[2]).toEqual({
      id: minted("ent"),
      title: "Title",
      subtitle: "Organisation",
      place: "Place",
      bullets: [],
    });
    expect(added.resume.sections[0]).toBe(doc.resume.sections[0]);
    const first = restructured(doc, { op: "addEntry", section: "edu", at: 0 });
    const edu = sectionOf(first.resume, "edu", "entries");
    expect(ids(edu.entries)).toEqual([minted("ent"), "northgate"]);
    const removed = restructured(doc, { op: "removeEntry", id: "fennel" });
    expect(ids(sectionOf(removed.resume, "exp", "entries").entries)).toEqual(["research"]);
    const moved = restructured(doc, { op: "moveEntry", id: "research", to: 0 });
    const exp = sectionOf(moved.resume, "exp", "entries");
    expect(ids(exp.entries)).toEqual(["research", "fennel"]);
    expect(() => apply(doc, structural({ op: "addEntry", section: "skills" }))).toThrow(
      "the labelled section skills holds no entries",
    );
  });

  it("adds, removes and moves the bullets of an entry", () => {
    const added = restructured(doc, { op: "addBullet", entry: "northgate" });
    expect(entryOf(added.resume, "northgate").bullets).toEqual([
      { id: minted("bul"), text: [{ text: "Describe what you did" }] },
    ]);
    const between = restructured(doc, { op: "addBullet", entry: "fennel", at: 1 });
    expect(ids(entryOf(between.resume, "fennel").bullets)).toEqual([
      "fennel-1",
      minted("bul"),
      "fennel-2",
      "fennel-3",
    ]);
    const removed = restructured(doc, { op: "removeBullet", id: "fennel-2" });
    expect(ids(entryOf(removed.resume, "fennel").bullets)).toEqual(["fennel-1", "fennel-3"]);
    const moved = restructured(doc, { op: "moveBullet", id: "fennel-3", to: 0 });
    expect(ids(entryOf(moved.resume, "fennel").bullets)).toEqual([
      "fennel-3",
      "fennel-1",
      "fennel-2",
    ]);
    expect(entryOf(moved.resume, "research")).toBe(entryOf(doc.resume, "research"));
  });

  it("adds, removes and moves the items of list and labelled sections, and of no other", () => {
    const listed = restructured(full, { op: "addItem", section: "honours" });
    expect(sectionOf(listed.resume, "honours", "list").items).toEqual([
      { id: "medal", text: [{ text: "Silver at a lettering show" }] },
      { id: minted("itm"), text: [{ text: "Item" }] },
    ]);
    const labelled = restructured(doc, { op: "addItem", section: "skills", at: 0 });
    const [first, ...rest] = sectionOf(labelled.resume, "skills", "labelled").items;
    expect(first).toEqual({ id: minted("itm"), label: "Label", text: [{ text: "Item" }] });
    expect(ids(rest)).toEqual(["languages", "tools"]);
    const removed = restructured(full, { op: "removeItem", id: "medal" });
    expect(sectionOf(removed.resume, "honours", "list").items).toEqual([]);
    const moved = restructured(doc, { op: "moveItem", id: "tools", to: 0 });
    const skills = sectionOf(moved.resume, "skills", "labelled");
    expect(ids(skills.items)).toEqual(["tools", "languages"]);
    expect(() => apply(full, structural({ op: "addItem", section: "work" }))).toThrow(
      "the entries section work holds no items",
    );
    expect(() => apply(full, structural({ op: "addItem", section: "about" }))).toThrow(
      "the paragraph section about holds no items",
    );
  });

  it("adds, moves, sets and removes links", () => {
    const added = restructured(doc, { op: "addLink" });
    const link = added.resume.header.links[1];
    expect(link).toEqual({ id: minted("lnk"), kind: "website", label: "example.com", href: "" });
    const id = link?.id ?? "";
    const moved = restructured(added, { op: "moveLink", id, to: 0 });
    expect(ids(moved.resume.header.links)).toEqual([id, "site"]);
    const href = "https://quist.example.com/code";
    const set = restructured(moved, { op: "setLink", id, kind: "github", href });
    expect(set.resume.header.links[0]).toEqual({ id, kind: "github", label: "example.com", href });
    expect(set.resume.header.links[1]).toBe(moved.resume.header.links[1]);
    const unlabelled = restructured(set, { op: "setLink", id, label: "" });
    expect(unlabelled.resume.header.links[0]).toEqual({ id, kind: "github", label: "", href });
    const removed = restructured(set, { op: "removeLink", id: "site" });
    expect(ids(removed.resume.header.links)).toEqual([id]);
    const first = restructured(doc, { op: "addLink", at: 0 });
    expect(ids(first.resume.header.links)).toEqual([minted("lnk"), "site"]);
    const myspace = { op: "setLink", id: "site", kind: "myspace" } as unknown as StructureOp;
    expect(() => apply(doc, structural(myspace))).toThrow("a link's kind cannot be myspace");
  });

  it("sets the header's fields an op names, and leaves the rest", () => {
    const after = restructured(doc, {
      op: "setHeader",
      headline: "Engineer",
      location: "Portland, OR",
    });
    expect(after.resume.header).toEqual({
      ...doc.resume.header,
      headline: "Engineer",
      location: "Portland, OR",
    });
    expect(after.resume.header.links).toBe(doc.resume.header.links);
    expect(after.resume.sections).toBe(doc.resume.sections);
    const cleared = restructured(after, { op: "setHeader", email: "" });
    expect(cleared.resume.header).toEqual({ ...after.resume.header, email: "" });
    const number = { op: "setHeader", phone: 4155550132 } as unknown as StructureOp;
    expect(() => apply(doc, structural(number))).toThrow("header.phone takes text, not number");
  });

  it("throws for a node the document does not have, or one of another kind than the op's", () => {
    expect(() => apply(doc, structural({ op: "removeEntry", id: "nowhere" }))).toThrow(
      new CommandError("the document has no entry nowhere"),
    );
    for (const [op, message] of [
      [{ op: "removeBullet", id: "fennel" }, "fennel is an entry, not a bullet"],
      [{ op: "addBullet", entry: "exp" }, "exp is a section, not an entry"],
      [{ op: "addEntry", section: "fennel" }, "fennel is an entry, not a section"],
      [{ op: "moveLink", id: "fennel-1", to: 0 }, "fennel-1 is a bullet, not a link"],
      [{ op: "setLink", id: "languages", label: "x" }, "languages is an item, not a link"],
      [{ op: "removeItem", id: "site" }, "site is a link, not an item"],
    ] satisfies [StructureOp, string][])
      expect(() => apply(doc, structural(op))).toThrow(message);
    const fly = { op: "flySection", id: "exp" } as unknown as StructureOp;
    expect(() => apply(doc, structural(fly))).toThrow("there is no structure op flySection");
  });

  it("gives each new node placeholders the page marks, so that it can be clicked at once", () => {
    let after = restructured(doc, { op: "addSection", kind: "list", role: "awards" });
    after = restructured(after, { op: "addSection", kind: "labelled", role: "languages" });
    const [awards = "", languages = ""] = ids(after.resume.sections.slice(-2));
    for (const op of [
      { op: "addItem", section: awards },
      { op: "addItem", section: languages },
      { op: "addEntry", section: "exp" },
      { op: "addBullet", entry: "fennel" },
      { op: "addLink" },
    ] satisfies StructureOp[])
      after = restructured(after, op);
    // Every field of the new nodes, but the new entry's dates, which it does not have yet.
    const before = fieldsOf(doc.resume);
    const added = [...fieldsOf(after.resume)].filter(
      ([id, field]) => !before.has(id) && field.kind !== "dates",
    );
    const { texts } = generateBody(jake, after.resume, defaultControls(jake));
    expect(added.map(([id]) => texts.get(id)).sort()).toEqual(
      [
        "Awards",
        "Languages",
        "Item",
        "Label",
        "Item",
        "Title",
        "Organisation",
        "Place",
        "Describe what you did",
        "example.com",
      ].sort(),
    );
  });

  it("keeps ids unique however many nodes are added, and undoes an op as one step", () => {
    let after = doc;
    for (let i = 0; i < 30; i++)
      after = restructured(after, { op: "addBullet", entry: "northgate" });
    expect(new Set(ids(entryOf(after.resume, "northgate").bullets)).size).toBe(30);
    const history = new History(doc);
    history.dispatch(structural({ op: "removeSection", id: "exp" }));
    expect(history.undo()).toBe(doc);
  });
});
