import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import { fileLines, splitHead, trailingPlace, UNFILED_ID, wordsIn } from "./file.ts";
import { layOut } from "./layout.ts";
import { OTHER_DIR } from "./print.ts";
import { type ReadPdf, readPdf, type TextRun } from "./read.ts";
import { labelByRules, type Role, trailingDate } from "./roles.ts";

function run(text: string, x: number, baseline: number, options: Partial<TextRun> = {}): TextRun {
  const size = options.size ?? 10;
  return {
    text,
    x,
    baseline,
    size,
    width: options.width ?? 0.5 * size * text.length,
    font: options.font ?? "Invented-Regular",
    bold: options.bold ?? false,
    italic: options.italic ?? false,
  };
}

const pdf = (runs: TextRun[]): ReadPdf => ({
  pages: [{ number: 1, width: 612, height: 792, runs, links: [], marks: [] }],
  ms: 0,
});

/** An invented resume, as a page lays it out: a name, contacts, and two sections. */
const invented = () =>
  layOut(
    pdf([
      run("Wren Halloway", 200, 60, { size: 22, bold: true }),
      run("wren@example.com | 555-0142 | Leeds, UK", 180, 85),
      run("EXPERIENCE", 50, 120, { size: 12, bold: true }),
      run("Compositor", 50, 140, { bold: true }),
      run("Mar 2019 – Present", 480, 140),
      run("Lantern Press", 50, 154, { italic: true }),
      run("Leeds, UK", 515, 154, { italic: true }),
      run("•", 55, 170),
      run("Set the type for forty books a year.", 65, 170),
      run("Summer 2018", 480, 190),
      run("SKILLS", 50, 220, { size: 12, bold: true }),
      run("Tools:", 50, 240, { bold: true }),
      run("presses, kerning", 85, 240),
    ]),
  );

describe("labelling by rules", () => {
  it("says what each line of an invented resume is", () => {
    const layout = invented();
    const roles = labelByRules(layout);
    const of = (text: string) => roles[layout.lines.findIndex((line) => line.text === text)];
    expect(of("Wren Halloway")).toBe("name");
    expect(of("wren@example.com | 555-0142 | Leeds, UK")).toBe("contact");
    expect(of("EXPERIENCE")).toBe("section heading");
    expect(of("SKILLS")).toBe("section heading");
    expect(of("Compositor")).toBe("entry head");
    expect(of("Mar 2019 – Present")).toBe("date");
    expect(of("Lantern Press")).toBe("entry head");
    expect(of("Leeds, UK")).toBe("place");
    expect(of("Set the type for forty books a year.")).toBe("bullet");
    expect(of("Summer 2018")).toBe("date");
    expect(of("Tools: presses, kerning")).toBe("running text");
  });
});

describe("filing", () => {
  it("files the lines into the resume model, and every word read lands", () => {
    const layout = invented();
    const { resume, flags, words } = fileLines(layout, labelByRules(layout));
    expect(Resume.parse(resume)).toEqual(resume);
    expect(resume.header).toMatchObject({
      name: { first: "Wren", last: "Halloway" },
      email: "wren@example.com",
      phone: "555-0142",
      location: "Leeds, UK",
    });
    const [experience, skills] = resume.sections;
    expect(experience).toMatchObject({ kind: "entries", title: "EXPERIENCE", role: "experience" });
    if (experience?.kind !== "entries") throw new Error("not entries");
    expect(experience.entries[0]).toMatchObject({
      title: "Compositor",
      subtitle: "Lantern Press",
      place: "Leeds, UK",
      dates: { start: "2019-03", end: "present" },
      bullets: [{ text: [{ text: "Set the type for forty books a year." }] }],
    });
    // A date the model cannot hold stays as text in its entry, and is flagged.
    expect(experience.entries[1]?.subtitle).toBe("Summer 2018");
    expect(flags.map((flag) => flag.kind)).toEqual(["date-as-text"]);
    expect(skills).toMatchObject({
      kind: "labelled",
      role: "skills",
      items: [{ label: "Tools", text: [{ text: "presses, kerning" }] }],
    });
    expect(words).toMatchObject({ read: words.landed, unfiled: 0 });
    expect(words.chars).toEqual({
      read: words.chars.landed,
      landed: words.chars.landed,
      unfiled: 0,
    });
  });

  it("files what fits nowhere in a last section, flagged, and still counts its words", () => {
    const layout = invented();
    // A second name, which the header has no room for.
    const twice: Role[] = labelByRules(layout).map((role, index) =>
      layout.lines[index]?.text === "Lantern Press" ? "name" : role,
    );
    const { resume, flags, words } = fileLines(layout, twice);
    const last = resume.sections.at(-1);
    expect(last).toMatchObject({ id: UNFILED_ID, items: [{ text: [{ text: "Lantern Press" }] }] });
    expect(flags.some((flag) => flag.kind === "unfiled")).toBe(true);
    expect(words.unfiled).toBe(2);
    expect(words.landed).toBe(words.read);
    expect(wordsIn(resume) > 0).toBe(true);
  });

  it("cuts a head line into its title, its company, its place and its date", () => {
    expect(splitHead("Charge Nurse — Westfold General Hospital")).toEqual({
      title: "Charge Nurse",
      subtitle: "Westfold General Hospital",
    });
    expect(splitHead("Operations Manager, Kettleby Foods")).toEqual({
      title: "Operations Manager",
      subtitle: "Kettleby Foods",
    });
    expect(splitHead("B.S. in Statistics, minor in Economics")).toBeUndefined();
    expect(splitHead("Front-End Engineer")).toBeUndefined();
    // `at` is a word, which a cut there would drop.
    expect(splitHead("Compositor at the Press")).toBeUndefined();
    expect(trailingPlace("Institute of Marine Botany, Galway, Ireland")).toEqual({
      rest: "Institute of Marine Botany",
      place: "Galway, Ireland",
    });
    expect(trailingPlace("Lumen Grove Studio · Lisbon, Portugal")).toEqual({
      rest: "Lumen Grove Studio",
      place: "Lisbon, Portugal",
    });
    expect(trailingPlace("Fjordside Upper School, Bergen")).toEqual({
      rest: "Fjordside Upper School",
      place: "Bergen",
    });
    expect(trailingPlace("Kettleby Foods")).toBeUndefined();
    expect(trailingDate("Teacher, Fjordside Upper School, Bergen (2016–2024)")).toEqual({
      rest: "Teacher, Fjordside Upper School, Bergen",
      date: "2016–2024",
    });
    expect(trailingDate("Analyst | 2019 – 2021")).toEqual({ rest: "Analyst", date: "2019 – 2021" });
    expect(trailingDate("Paediatric Immediate Life Support, renewed 2024")).toBeUndefined();
  });
});

describe("nothing dropped", () => {
  it("keeps what stands beside an email under its link, and counts letters whatever the cuts", () => {
    const layout = layOut({
      pages: [
        {
          number: 1,
          width: 612,
          height: 792,
          runs: [
            run("Wren Halloway", 200, 60, { size: 22, bold: true }),
            run("wren@example.com (home)|555-0142", 180, 85),
          ],
          links: [{ x0: 180, y0: 76, x1: 340, y1: 88, url: "mailto:wren@example.com" }],
          marks: [],
        },
      ],
      ms: 0,
    });
    const { resume, words } = fileLines(layout, labelByRules(layout));
    expect(resume.header.email).toBe("wren@example.com");
    expect(resume.sections.at(-1)).toMatchObject({ items: [{ text: [{ text: "(home)" }] }] });
    // Cut at `|`, one word read is two filed; its letters and digits are as many as were read.
    expect(words.landed).toBe(words.read + 1);
    expect(words.chars.landed).toBe(words.chars.read);
  });
});

describe("a date kept as text", () => {
  it("stays in its entry whatever head lines come after it", () => {
    const layout = layOut(
      pdf([
        run("Wren Halloway", 200, 60, { size: 22, bold: true }),
        run("EXPERIENCE", 50, 120, { size: 12, bold: true }),
        run("Summer 2018", 50, 140),
        run("Compositor", 50, 154, { bold: true }),
        run("Lantern Press", 50, 168, { italic: true }),
        run("•", 55, 184),
        run("Set the type for forty books a year.", 65, 184),
      ]),
    );
    const roles = labelByRules(layout);
    const { resume, words } = fileLines(layout, roles);
    const [experience] = resume.sections;
    if (experience?.kind !== "entries") throw new Error("not entries");
    expect(experience.entries[0]?.subtitle).toContain("Summer 2018");
    expect(words.chars.landed).toBe(words.chars.read);
  });
});

describe("an invented resume from another tool", () => {
  it("reads the RTF TextEdit-style fixture into its truth's fields", async () => {
    const folder = join(OTHER_DIR, "textedit-rtf");
    const read = await readPdf(new Uint8Array(readFileSync(join(folder, "resume.pdf"))));
    if ("refused" in read) throw new Error("refused");
    const layout = layOut(read);
    const { resume, words } = fileLines(layout, labelByRules(layout));
    const truth = Resume.parse(JSON.parse(readFileSync(join(folder, "truth.json"), "utf8")));
    expect(resume.header.name).toEqual(truth.header.name);
    expect(resume.header.email).toBe(truth.header.email);
    expect(resume.sections.map((section) => [section.title, section.role])).toEqual(
      truth.sections.map((section) => [section.title, section.role]),
    );
    expect(words.landed).toBe(words.read);
  }, 60_000);
});
