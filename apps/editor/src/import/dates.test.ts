import { describe, expect, test } from "vitest";
import { readDate, readDates } from "./dates";

// Every date here is invented for these tests.

describe("reading one date", () => {
  test("reads a month by its English name, full or in three letters, with or without a period", () => {
    expect(readDate("January 2020")).toBe("2020-01");
    expect(readDate("Jan 2020")).toBe("2020-01");
    expect(readDate("Jan. 2020")).toBe("2020-01");
    expect(readDate("Sept. 2019")).toBe("2019-09");
    expect(readDate("sep 2019")).toBe("2019-09");
    expect(readDate("DECEMBER 1999")).toBe("1999-12");
    expect(readDate("May, 2021")).toBe("2021-05");
    expect(readDate("Aug 2018")).toBe("2018-08");
  });

  test("reads a month by its number, and a year alone", () => {
    expect(readDate("01/2020")).toBe("2020-01");
    expect(readDate("3/2020")).toBe("2020-03");
    expect(readDate("2020-01")).toBe("2020-01");
    expect(readDate("2020-12")).toBe("2020-12");
    expect(readDate("2020")).toBe("2020");
  });

  test("reads nothing that is not a date", () => {
    for (const text of [
      "Summer 2020",
      "13/2020",
      "2020-13",
      "0/2020",
      "1850",
      "20200",
      "Mayor 2020",
    ])
      expect(readDate(text), text).toBeUndefined();
  });
});

describe("reading dates and ranges", () => {
  test("reads a single date", () => {
    expect(readDates("Jan 2020")).toEqual({ start: "2020-01" });
    expect(readDates(" 2019 ")).toEqual({ start: "2019" });
  });

  test("reads a range on any dash, or the word to", () => {
    const range = { start: "2018-08", end: "2021-05" };
    expect(readDates("Aug 2018 - May 2021")).toEqual(range);
    expect(readDates("Aug 2018 -- May 2021")).toEqual(range);
    expect(readDates("Aug 2018 --- May 2021")).toEqual(range);
    expect(readDates("Aug 2018 – May 2021")).toEqual(range);
    expect(readDates("Aug 2018—May 2021")).toEqual(range);
    expect(readDates("Aug 2018 to May 2021")).toEqual(range);
    expect(readDates("08/2018 -- 05/2021")).toEqual(range);
    expect(readDates("2018-08 -- 2021-05")).toEqual(range);
    expect(readDates("2018-2021")).toEqual({ start: "2018", end: "2021" });
    expect(readDates("2018 – May 2021")).toEqual({ start: "2018", end: "2021-05" });
  });

  test("reads an academic year as the range of its two years, and a month from 01 to 12", () => {
    expect(readDates("2019-20")).toEqual({ start: "2019", end: "2020" });
    expect(readDates("2010-11")).toEqual({ start: "2010", end: "2011" });
    expect(readDates("2011\u201312")).toEqual({ start: "2011", end: "2012" });
    expect(readDates("1999-00")).toEqual({ start: "1999", end: "2000" });
    expect(readDates("2020-01")).toEqual({ start: "2020-01" });
    expect(readDates("2020-12")).toEqual({ start: "2020-12" });
    for (const text of ["2019-13", "2019-22", "2100-01x"])
      expect(readDates(text), text).toBeUndefined();
  });

  test("reads an end still open, in any case", () => {
    for (const word of ["Present", "present", "CURRENT", "Now", "Ongoing", "today"])
      expect(readDates(`Jan 2020 – ${word}`), word).toEqual({
        start: "2020-01",
        end: "present",
      });
  });

  test("leaves everything else text", () => {
    for (const text of [
      "Invented University",
      "Jan 2020 at Invented Labs",
      "Present - Jan 2020",
      "Jun - Aug 2019",
      "2018 -- sometime",
      "Harbour City, 2020",
      "",
      "1234",
    ])
      expect(readDates(text), text).toBeUndefined();
  });
});
