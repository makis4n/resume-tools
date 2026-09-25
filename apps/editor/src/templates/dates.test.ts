import { describe, expect, it } from "vitest";
import { formatDate, formatDates } from "./dates";
import { DateFormat } from "./package";

describe("formatDate", () => {
  it("formats a month in each format", () => {
    expect(formatDate("2020-06", "MMM yyyy")).toBe("Jun 2020");
    expect(formatDate("2020-06", "MMMM yyyy")).toBe("June 2020");
    expect(formatDate("2020-06", "MM/yyyy")).toBe("06/2020");
    expect(formatDate("2020-06", "yyyy")).toBe("2020");
  });

  it("gives a year alone in every format", () => {
    for (const format of DateFormat.options) expect(formatDate("2020", format)).toBe("2020");
  });

  it("names every month in English", () => {
    const months = Array.from({ length: 12 }, (_, i) => `2021-${String(i + 1).padStart(2, "0")}`);
    expect(months.map((month) => formatDate(month, "MMM yyyy").slice(0, 3))).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    expect(formatDate("2021-09", "MMMM yyyy")).toBe("September 2021");
  });

  it("throws for a date the model refuses", () => {
    for (const date of ["2020-13", "2020-00", "June 2020", "20-06"])
      expect(() => formatDate(date, "MMM yyyy"), date).toThrow(RangeError);
  });
});

describe("formatDates", () => {
  it("joins a range with an en dash between spaces", () => {
    expect(formatDates({ start: "2019-09", end: "2021-06" }, "MMM yyyy")).toBe(
      "Sep 2019 – Jun 2021",
    );
    expect(formatDates({ start: "2019", end: "2021-06" }, "MM/yyyy")).toBe("2019 – 06/2021");
  });

  it("ends an ongoing range in Present", () => {
    expect(formatDates({ start: "2021-03", end: "present" }, "MMMM yyyy")).toBe(
      "March 2021 – Present",
    );
  });

  it("gives a single date alone", () => {
    expect(formatDates({ start: "2020-11" }, "MMM yyyy")).toBe("Nov 2020");
    expect(formatDates({ start: "2020" }, "MMM yyyy")).toBe("2020");
  });
});
