import { expect, test } from "vitest";
import { PRIVACY_NOTE } from "./privacy";

test("says, under decision 0047, what leaves the browser and when, in two plain sentences", () => {
  expect(PRIVACY_NOTE).toBe(
    "Your resume stays in this browser unless you ask for something that needs to send it, and you are told what is sent. Reading a PDF with the reading service sends its text, and only once you agree, with the setting below; checking a resume sends its PDF to the checker; importing a .tex file sends only its template's command definitions, with your resume's text replaced.",
  );
  // Two sentences, each ending with a full stop; the file's extension is not one.
  expect(PRIVACY_NOTE.replace(".tex", "tex").match(/[.!?]/g)).toEqual([".", "."]);
  expect(PRIVACY_NOTE.endsWith(".")).toBe(true);
  // No LaTeX: none of its special characters, no command, and no word of its own but the file's
  // extension, which the screen names beside it.
  expect(PRIVACY_NOTE).not.toMatch(/[\\{}$%#&^_~]/);
  expect(PRIVACY_NOTE.toLowerCase().replace(".tex file", "file")).not.toMatch(
    /\b(?:la)?tex\b|\bmacros?\b|newcommand|documentclass|usepackage|preamble|\bdef\b|meaning|hypersetup|pdfauthor/,
  );
  // The rule, and each thing that sends, with what it sends.
  for (const words of [
    "stays in this browser unless you ask",
    "told what is sent",
    "reading service sends its text",
    "only once you agree",
    "sends its PDF to the checker",
    "command definitions",
    "resume's text replaced",
  ])
    expect(PRIVACY_NOTE, words).toContain(words);
});
