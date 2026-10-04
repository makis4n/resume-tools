import { describe, expect, it } from "vitest";
import {
  countWords,
  headingRole,
  isEmail,
  isPhone,
  isPlace,
  isUrl,
  looksLikeDate,
  normalise,
  parseDates,
} from "./text.ts";

describe("dates", () => {
  it("reads dates and ranges the model can hold", () => {
    expect(parseDates("Mar 2021 – Present")).toEqual({ start: "2021-03", end: "present" });
    expect(parseDates("Sept. 2016 - June 2020")).toEqual({ start: "2016-09", end: "2020-06" });
    expect(parseDates("2019 – 2021")).toEqual({ start: "2019", end: "2021" });
    expect(parseDates("06/2019 to 08/2020")).toEqual({ start: "2019-06", end: "2020-08" });
    expect(parseDates("2018-04 — current")).toEqual({ start: "2018-04", end: "present" });
    expect(parseDates("(2016–2024)")).toEqual({ start: "2016", end: "2024" });
    expect(parseDates("May 2018")).toEqual({ start: "2018-05" });
    expect(parseDates("2023")).toEqual({ start: "2023" });
  });

  it("knows a date it cannot hold, and text that is no date", () => {
    expect(parseDates("Summer 2019")).toBeUndefined();
    expect(looksLikeDate("Summer 2019")).toBe(true);
    expect(looksLikeDate("Expected May 2026")).toBe(true);
    expect(looksLikeDate("Spring 2019 – Fall 2020")).toBe(true);
    expect(looksLikeDate("Present")).toBe(true);
    for (const text of ["Rotterdam, Netherlands", "12: 44–58", "Built 40 tools in 2020", "Q"])
      expect(looksLikeDate(text), text).toBe(false);
  });
});

describe("contacts and places", () => {
  it("tells emails, phones and addresses", () => {
    expect(isEmail("wren.halloway@example.com")).toBe(true);
    expect(isEmail("Email: wren@example.com")).toBe(true);
    expect(isPhone("+44 20 7946 0958")).toBe(true);
    expect(isPhone("(555) 014-2271")).toBe(true);
    expect(isPhone("Phone: 555-0142")).toBe(true);
    expect(isPhone("2019 - 2021")).toBe(false);
    expect(isUrl("people.example.com/wren-halloway")).toBe(true);
    expect(isUrl("https://halloway.example.org")).toBe(true);
    expect(isUrl("wren@example.com")).toBe(false);
    expect(isUrl("2.4")).toBe(false);
  });

  it("tells a place from a title or a list", () => {
    for (const place of ["Portland, OR", "Leeds, UK", "Rio de Janeiro, Brazil", "Remote"])
      expect(isPlace(place), place).toBe(true);
    for (const other of [
      "First Place, Lowlands Open Infrastructure Hackathon",
      "Attendees’ Choice, Platform Days Europe",
      "Software Engineer",
      "python, rust",
    ])
      expect(isPlace(other), other).toBe(false);
  });
});

describe("headings", () => {
  it("gives a section its role by its heading's words", () => {
    expect(headingRole("Work Experience")).toBe("experience");
    expect(headingRole("RESEARCH POSITIONS")).toBe("experience");
    expect(headingRole("Technical Skills")).toBe("skills");
    expect(headingRole("Programming Languages")).toBe("skills");
    expect(headingRole("Languages")).toBe("languages");
    expect(headingRole("Honors & Awards")).toBe("awards");
    expect(headingRole("Selected Publications")).toBe("publications");
    expect(headingRole("Profile")).toBe("summary");
    expect(headingRole("Interests")).toBe("other");
    expect(headingRole("Lighthouse Mills")).toBeUndefined();
  });
});

describe("words and text", () => {
  it("counts words, never a separator", () => {
    expect(countWords("wren@example.com | 555-0142 | Leeds, UK")).toBe(4);
    expect(countWords("Mar 2021 – Present")).toBe(3);
    expect(countWords("")).toBe(0);
  });

  it("compares what was typed with what TeX set", () => {
    expect(normalise("the office’s turnaround -- in “days”")).toBe(
      normalise('the office\'s turnaround – in "days"'),
    );
    expect(normalise("ﬁrst  on‑call")).toBe("first on-call");
    expect(normalise("Đurva")).toBe(normalise("Ðurva"));
  });
});
