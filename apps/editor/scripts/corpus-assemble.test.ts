import { NAMING_VERSION } from "@resume-tools/naming";
import { describe, expect, test } from "vitest";
import type { AssemblyChecks } from "../src/import/assemble";
import { NOTES, UNCHECKED } from "../src/import/validate";
import {
  type AssembleRow,
  answersFor,
  assembleRow,
  assembleTable,
  CHECK_NOTES,
  comparePlaces,
  fieldsFound,
  placesTable,
  portPlaces,
  UNCHECKED_WHY,
} from "./corpus-assemble";

// Every row, answer and resume here is invented for these tests; SECRET stands for a document's
// text, which nothing the runner prints may show.

const SECRET = "Quillwort";

const row = (id: string, family: AssembleRow["family"], changes: Partial<AssembleRow>) =>
  ({ id, family, outcome: "assembled", wall: 1000, ...changes }) as AssembleRow;

describe("the table", () => {
  const rows: AssembleRow[] = [
    row("jake-0001", "jake", {
      engine: "pdftex",
      answered: 6,
      unanswered: 2,
      fields: { editable: 10, raw: 0, required: 1, locked: { date: 2, unmapped: 3 } },
      words: { editable: 60, locked: { date: 4, unmapped: 36 } },
      sections: { mapped: 3, locked: 2 },
      controls: { proven: ["pageSize", "fontSize"], dropped: ["margins"] },
      redefinitions: { applied: [], dropped: ["cvevent", `evil\n${SECRET}`] },
      findings: { pages: 1 },
      unrepeatable: [],
      compiles: 20,
      probeMs: 1000,
      validateMs: 5000,
    }),
    row("awesome-cv-0001", "awesome-cv", {
      outcome: "partial",
      engine: "xetex",
      difference: "position",
      fields: { editable: 4, raw: 2, required: 0, locked: { misaligned: 1 } },
      words: { editable: 20, locked: { misaligned: 20 } },
      findings: { dump: 1 },
      unrepeatable: ["link"],
      answered: 5,
      unanswered: 1,
      answersRefused: 1,
      redefinitions: { applied: ["cvsection"], dropped: [], placement: "preamble" },
      compiles: 30,
      validateMs: 50_000,
    }),
    row("jake-0002", "jake", { outcome: "refused", refused: "font", font: "tcrm1000" }),
    row("jake-0003", "jake", { outcome: "refused", refused: "font", font: `${SECRET} font` }),
    row("other-0001", "other", { outcome: "no answer", answered: 0, unanswered: 9 }),
    row("other-0002", "other", { outcome: "no reference" }),
    row("altacv-0001", "altacv", { outcome: "timeout" }),
  ];
  const table = assembleTable(rows);
  const cells = (label: string) =>
    table
      .split("\n")
      .find((line) => line.startsWith(`| ${label} |`))
      ?.split("|")
      .slice(2, -1)
      .map((cell) => cell.trim());

  test("counts documents per family and in all, and why the others went no further", () => {
    // Columns: jake, awesome-cv, altacv, moderncv, europecv, other, all.
    expect(cells("Documents whose body parsed")).toEqual(["3", "1", "1", "0", "0", "1", "6"]);
    expect(cells("Assembled and checked")).toEqual(["1", "1", "0", "0", "0", "0", "2"]);
    expect(cells("Partial: the first check differs")).toEqual(["0", "1", "0", "0", "0", "0", "1"]);
    expect(cells("Partial, the first difference: `position`")?.at(-1)).toBe("1");
    expect(cells("Refused: font")?.at(-1)).toBe("2");
    expect(cells("Refused: font `tcrm1000`")?.at(-1)).toBe("1");
    expect(cells("No answer for any macro the body calls")?.at(-1)).toBe("1");
    expect(cells("Timed out or died")?.at(-1)).toBe("1");
  });

  test("sums fields, words and controls, and names the checks' findings by check", () => {
    expect(cells("Editable")?.at(-1)).toBe("14");
    expect(cells("Raw: set, and edited in the panel alone")?.at(-1)).toBe("2");
    expect(cells("Parts locked: `unmapped`")?.at(-1)).toBe("3");
    expect(cells("Words in editable fields")?.at(-1)).toBe("57%");
    expect(cells("`margins` dropped")?.at(-1)).toBe("1");
    expect(cells("Dropped: `\\cvevent`")?.at(-1)).toBe("1");
    expect(cells("Applied after `\\documentclass`")?.at(-1)).toBe("0");
    expect(
      cells("Applied before `\\begin{document}`: a compile after the class stopped")?.at(-1),
    ).toBe("1");
    expect(
      cells(
        "Template macros with none: the answer held is another kind's, or its partner is not theirs",
      )?.at(-1),
    ).toBe("1");
    expect(cells("`dump`")?.at(-1)).toBe("1");
    expect(cells("A unit added or removed stops the compile")?.at(-1)).toBe("1");
    expect(cells("Assembly and checks, slowest")?.at(-1)).toBe("50000 ms");
  });

  test("shows no text of a document, a name that is not plainly one left out", () => {
    expect(table).not.toContain(SECRET);
    expect(table.split("\n").every((line) => !/\p{Cc}/u.test(line))).toBe(true);
  });
});

describe("the checks' own findings in the table", () => {
  const table = assembleTable([
    row("jake-0001", "jake", {
      outcome: "partial",
      difference: "stopped",
      controls: {
        proven: [],
        dropped: ["pageSize", "fontSize"],
        unchecked: ["pageSize", "fontSize"],
      },
      findings: { stopped: 1 },
    }),
    row("awesome-cv-0001", "awesome-cv", {
      findings: { untested: 1, unproven: 1, pages: 1 },
      unrepeatable: ["entry"],
      fixed: ["entry", "section.paragraph", `evil ${SECRET}`],
    }),
    row("altacv-0001", "altacv", { findings: {}, latinModern: true }),
  ]);
  const cells = (label: string) =>
    table
      .split("\n")
      .find((line) => line.startsWith(`| ${label} |`))
      ?.split("|")
      .slice(2, -1)
      .map((cell) => cell.trim());

  test("counts each note, the controls never tried, and the kinds the editor cannot add", () => {
    // Columns: jake, awesome-cv, altacv, moderncv, europecv, other, all.
    expect(cells("`stopped`")).toEqual(["1", "0", "0", "0", "0", "0", "1"]);
    expect(cells("`untested`")?.at(-1)).toBe("1");
    expect(cells("`unproven`")?.at(-1)).toBe("1");
    expect(cells("`pages`")?.at(-1)).toBe("1");
    expect(cells("Dropped unchecked: the checks stopped before the fourth")?.at(-1)).toBe("1");
    expect(cells("`fontSize` dropped")?.at(-1)).toBe("1");
    expect(cells("No finding, the harness's or the checks'")).toEqual([
      "0",
      "0",
      "1",
      "0",
      "0",
      "0",
      "1",
    ]);
    expect(cells("The editor neither adds nor removes: `entry`")?.at(-1)).toBe("1");
    expect(cells("The editor neither adds nor removes: `section.paragraph`")?.at(-1)).toBe("1");
    expect(
      cells("Set in Latin Modern: Computer Modern in T1 or TS1, which the page cannot draw"),
    ).toEqual(["0", "0", "1", "0", "0", "0", "1"]);
    expect(table).not.toContain(SECRET);
  });

  test("names the notes and the unchecked controls as the checks do", () => {
    expect(CHECK_NOTES).toEqual(NOTES);
    expect(UNCHECKED_WHY).toBe(UNCHECKED);
  });
});

describe("the answers", () => {
  /** An invented key of 64 hex digits. */
  const key = (n: number) => n.toString(16).padStart(64, "0");
  /** An invented model's stored answer, filed under `at`. */
  const stored = (at: string, of: "command" | "environment", name: string, answer: object) =>
    JSON.stringify({
      version: NAMING_VERSION,
      key: at,
      hash: key(99),
      of,
      name,
      answer: { arguments: [], repeatable: false, ...answer },
      reviewed: false,
      source: "model:invented",
    });

  test("are found by key as the document's macros, and the body's macros counted", async () => {
    const store: Record<string, string> = {
      [key(1)]: stored(key(1), "command", "inventedentry", {
        kind: "entry",
        arguments: [{ index: 1, meaning: "title", slot: "title" }],
        repeatable: true,
      }),
      [key(2)]: "not an answer",
      // Filed for an environment, asked for by a command.
      [key(3)]: stored(key(3), "environment", "inventedbox", { kind: "layout" }),
      // A list's opener and closer, each naming the other by its key.
      [key(4)]: JSON.stringify({
        ...JSON.parse(
          stored(key(4), "command", "inventedStart", {
            kind: "bulletList",
            list: { does: "opens", closedBy: "inventedEnd", holds: "bullet" },
          }),
        ),
        partnerKeys: { closedBy: key(5) },
      }),
      [key(5)]: JSON.stringify({
        ...JSON.parse(
          stored(key(5), "command", "inventedEnd", {
            kind: "bulletList",
            list: { does: "closes", openedBy: "inventedStart" },
          }),
        ),
        partnerKeys: { openedBy: key(4) },
      }),
    };
    const cache = { get: (asked: string) => store[asked] };
    const found = await answersFor(
      [
        // A fork's own names for the macros the answers were filed under.
        { of: "command", name: "forkentry", key: key(1), calls: 2 },
        { of: "command", name: "broken", key: key(2), calls: 1 },
        { of: "command", name: "unknown", key: key(9), calls: 3 },
        { of: "command", name: "data", calls: 1 },
        { of: "command", name: "unused", key: key(1), calls: 0 },
        { of: "command", name: "box", key: key(3), calls: 1 },
        { of: "command", name: "forkStart", key: key(4), calls: 1 },
        { of: "command", name: "forkEnd", key: key(5), calls: 1 },
      ],
      cache,
    );
    // Each answer named as the document names its macro, the list's partners as it names them.
    expect(found.found.map((each) => [each.of, each.name])).toEqual([
      ["command", "forkentry"],
      ["command", "unused"],
      ["command", "forkStart"],
      ["command", "forkEnd"],
    ]);
    expect(found.found[2]?.answer.list).toMatchObject({ closedBy: "forkEnd" });
    expect(found.found[3]?.answer.list).toMatchObject({ openedBy: "forkStart" });
    // An environment's answer asked for by a command is refused: that macro has no answer.
    expect(found).toMatchObject({ answered: 3, unanswered: 3, refused: 1 });

    // An opener whose closer the document has not, by key, is refused for its partner.
    const alone = await answersFor(
      [{ of: "command", name: "forkStart", key: key(4), calls: 1 }],
      cache,
    );
    expect(alone).toMatchObject({ found: [], answered: 0, unanswered: 1, refused: 1 });
  });
});

describe("the oracle's places", () => {
  const resume = {
    header: { links: [{ id: "lnk-1" }] },
    sections: [
      {
        kind: "entries" as const,
        id: "sec-1",
        entries: [{ id: "ent-1", bullets: [{ id: "bul-1" }] }],
      },
      { kind: "paragraph" as const, id: "sec-2" },
      { kind: "locked" as const, id: "lock-1" },
    ],
  };
  const all = [
    { field: "header.first", mode: "typeset" as const },
    { field: "lnk-1.label", mode: "raw" as const },
    { field: "sec-1.title", mode: "typeset" as const },
    { field: "ent-1.dates", mode: "locked" as const, reason: "date" as const },
    { field: "bul-1.text", mode: "typeset" as const },
    { field: "sec-2.title", mode: "typeset" as const },
    { field: "sec-2.text", mode: "locked" as const, reason: "differs" as const },
  ];

  test("count each field by the model's place it fills", () => {
    expect(fieldsFound(resume, all)).toEqual({
      "header.first": { editable: 1, raw: 0, locked: {} },
      "link.label": { editable: 0, raw: 1, locked: {} },
      "section.title": { editable: 2, raw: 0, locked: {} },
      "entry.dates": { editable: 0, raw: 0, locked: { date: 1 } },
      "bullet.text": { editable: 1, raw: 0, locked: {} },
      "paragraph.text": { editable: 0, raw: 0, locked: { differs: 1 } },
    });
  });

  test("file a field whose node the resume does not hold under its own kind, never an entry's", () => {
    // A link the resume keeps whole in its header's extras, as a check locks a run of them.
    const found = fieldsFound(resume, [
      { field: "lnk-2.label", mode: "typeset" as const },
      { field: "itm-9.text", mode: "typeset" as const },
      { field: "odd.text", mode: "typeset" as const },
    ]);
    expect(Object.keys(found).sort()).toEqual(["item.text", "link.label", "odd.text"]);
  });

  test("set against the places a port's typeset slots mark", () => {
    const port = portPlaces({
      snippets: {
        header: "\\invented{{{first}} {{last}}}{{contacts}}",
        contact: { email: "\\mail{{{text}}}", phone: "\\phone{{{&text}}}" },
        link: { other: "\\href{{{&href}}}{{{label}}}" },
        section: { entries: "\\section{{{title}}}{{entries}}", paragraph: "{{text}}" },
        entry: "\\entry{{{title}}}{{{dates}}}",
        bullet: "\\item {{text}}",
        item: "\\item {{text}}",
        labelledItem: "\\item[{{label}}] {{text}}",
      },
    });
    expect([...port].sort()).toEqual([
      "bullet.text",
      "entry.dates",
      "entry.title",
      "header.email",
      "header.first",
      "header.last",
      "item.text",
      "labelledItem.label",
      "labelledItem.text",
      "link.label",
      "paragraph.text",
      "section.title",
    ]);
    const lines = comparePlaces("invented", port, fieldsFound(resume, all));
    expect(lines.find((line) => line.place === "header.last")?.found).toBe("absent");
    expect(lines.find((line) => line.place === "entry.dates")?.found).toBe("1 locked (date)");
    const table = placesTable([
      {
        template: "invented",
        row: row("invented-0000", "other", { findings: { pages: 1 }, compiles: 9 }),
        lines,
      },
    ]);
    expect(table).toContain(
      "| invented | **outcome** | | assembled; harness: pages 1; 9 compiles |",
    );
    expect(table).toContain("| invented | `link.label` | marks | 1 raw |");
  });
});

describe("a validation's row", () => {
  test("holds its counts and names, the harness's findings by check, and never a field's text", () => {
    const checks: AssemblyChecks = {
      outcome: "partial",
      difference: { kind: "position", text: "page 1, item 3" },
      fields: { editable: 2, raw: 0, required: 1, locked: { text: 1 } },
      words: { editable: 5, locked: { text: 2 } },
      sections: { mapped: 1, locked: 0 },
      required: ["command|inventedentry|1"],
      controls: {
        offered: ["pageSize"],
        proven: ["pageSize"],
        dropped: [
          { control: "margins", why: "sets the same page at every value" },
          { control: "fontSize", why: UNCHECKED },
        ],
      },
      redefinitions: { applied: [], dropped: [], placement: "class" },
      repeatable: [
        { kind: "entry", added: true, removed: true },
        { kind: "link", added: false, removed: true },
      ],
      findings: [
        { check: "pages", message: "the resume sets 2 pages, not one" },
        { check: "pages", message: `${SECRET} runs past the page's edge`, field: "sec-1.title" },
      ],
      compiles: 12,
      ms: 1234.5,
      decisions: { fixed: ["link"] },
      latinModern: ["ecrm1000"],
      all: [],
    };
    const made = assembleRow(checks, "pdftex", { answered: 3, unanswered: 1 });
    expect(made).toMatchObject({
      outcome: "partial",
      difference: "position",
      controls: { proven: ["pageSize"], dropped: ["margins", "fontSize"], unchecked: ["fontSize"] },
      findings: { pages: 2 },
      unrepeatable: ["link"],
      fixed: ["link"],
      latinModern: true,
      compiles: 12,
      validateMs: 1235,
    });
    expect(JSON.stringify(made)).not.toContain(SECRET);
  });
});
