import { describe, expect, it } from "vitest";
import { pdfFileName } from "./download";

describe("pdfFileName", () => {
  it("names the PDF after the resume, first name then last, in lower case", () => {
    expect(pdfFileName({ first: "Mara", last: "Quist" })).toBe("mara-quist.pdf");
    expect(pdfFileName({ first: "Mara", last: "" })).toBe("mara.pdf");
  });

  it("makes each run of anything but letters and digits one hyphen, and keeps other scripts", () => {
    expect(pdfFileName({ first: "  Ines ", last: "Calloway, Jr." })).toBe("ines-calloway-jr.pdf");
    expect(pdfFileName({ first: "Zoë-Anne", last: "O'Dwyer 📈" })).toBe("zoë-anne-o-dwyer.pdf");
    expect(pdfFileName({ first: "Đurva", last: "李雷" })).toBe("đurva-李雷.pdf");
    // Nothing in a name reaches outside the file's own name.
    expect(pdfFileName({ first: "../../x", last: "y\\z" })).toBe("x-y-z.pdf");
  });

  it("falls back to resume.pdf when the name leaves nothing", () => {
    expect(pdfFileName({ first: "", last: "" })).toBe("resume.pdf");
    expect(pdfFileName({ first: " ", last: "--" })).toBe("resume.pdf");
  });
});
