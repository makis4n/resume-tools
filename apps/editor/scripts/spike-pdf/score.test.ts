import { Resume } from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import { address, scoreResume } from "./score.ts";

/** An invented truth: a header with a link, and a section of one entry with two bullets. */
const truth = Resume.parse({
  version: 1,
  header: {
    name: { first: "Wren", last: "Halloway" },
    email: "wren@example.com",
    phone: "+44 555 0142",
    links: [
      {
        id: "site",
        kind: "website",
        label: "halloway.example.com",
        href: "https://halloway.example.com",
      },
    ],
  },
  sections: [
    {
      id: "work",
      kind: "entries",
      role: "experience",
      title: "Experience",
      entries: [
        {
          id: "press",
          title: "Compositor",
          subtitle: "Lantern Press",
          place: "Leeds, UK",
          dates: { start: "2019-03", end: "present" },
          bullets: [
            { id: "press-1", text: [{ text: "Set the type for forty books a year -- by hand." }] },
            { id: "press-2", text: [{ text: "Kept the press's cases in order." }] },
          ],
        },
      ],
    },
  ],
});

describe("fields right", () => {
  it("counts every field right for a reading equal to the truth up to TeX's typography", () => {
    const read = structuredClone(truth);
    const section = read.sections[0];
    if (section?.kind !== "entries") throw new Error("not entries");
    // What TeX sets for what was typed, the title set in capitals, and a link's closing slash.
    section.title = "EXPERIENCE";
    const [bullet, other] = section.entries[0]?.bullets ?? [];
    if (!bullet || !other) throw new Error("no bullets");
    bullet.text = [{ text: "Set the type for forty books a year – by hand." }];
    other.text = [{ text: "Kept the press’s cases in order." }];
    const link = read.header.links[0];
    if (link) link.href = "https://halloway.example.com/";
    read.header.phone = "+44 (555) 0142";
    const score = scoreResume(truth, read);
    expect(score.all).toEqual({ total: 11, right: 11 });
    expect(score.headerExact && score.sectionsExact && score.bulletsExact).toBe(true);
    expect(score.entries).toEqual({ total: 1, right: 1 });
  });

  it("counts what a reading got wrong, field by field", () => {
    const read = structuredClone(truth);
    read.header.email = undefined;
    const section = read.sections[0];
    if (section?.kind !== "entries") throw new Error("not entries");
    section.role = "other";
    const entry = section.entries[0];
    if (!entry) throw new Error("no entry");
    // A title and its company swapped, as Awesome-CV sets them.
    entry.title = "Lantern Press";
    entry.subtitle = "Compositor";
    entry.bullets = entry.bullets.slice(0, 1);
    const score = scoreResume(truth, read);
    expect(score.byKind.email).toEqual({ total: 1, right: 0 });
    expect(score.byKind["section role"]).toEqual({ total: 1, right: 0 });
    expect(score.byKind["entry title"]).toEqual({ total: 1, right: 0 });
    expect(score.byKind.bullet).toEqual({ total: 2, right: 1 });
    expect(score.entries).toEqual({ total: 1, right: 0 });
    expect(score.entriesSwapped).toEqual({ total: 1, right: 1 });
    expect(score.all).toEqual({ total: 11, right: 7 });
  });

  it("compares addresses without their scheme, `www.` or closing slash", () => {
    expect(address("https://www.Example.com/work/")).toBe(address("example.com/work"));
  });
});
