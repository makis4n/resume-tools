import { expect, test } from "vitest";
import { PRIVACY_SENTENCE } from "./privacy";

test("says what leaves the browser in one plain sentence that names no command", () => {
  expect(PRIVACY_SENTENCE).toBe(
    "To learn your template, the editor sends only its command definitions, with any names, emails, phone numbers, links and addresses replaced, the shape of a few places that use them, with every letter and digit replaced, and the page's style settings; your resume's text, its PDF and your header never leave your browser.",
  );
  // One sentence, which ends with its only full stop.
  expect(PRIVACY_SENTENCE.match(/[.!?]/g)).toEqual(["."]);
  expect(PRIVACY_SENTENCE.endsWith(".")).toBe(true);
  // No LaTeX: none of its special characters, no command, and no word of its own.
  expect(PRIVACY_SENTENCE).not.toMatch(/[\\{}$%#&^_~]/);
  expect(PRIVACY_SENTENCE.toLowerCase()).not.toMatch(
    /\b(?:la)?tex\b|\bmacros?\b|newcommand|documentclass|usepackage|preamble|\bdef\b|meaning/,
  );
  // What goes, and what never does.
  for (const words of [
    "command definitions",
    "names",
    "emails",
    "phone numbers",
    "links",
    "addresses",
    "every letter and digit",
    "style settings",
    "resume's text",
    "PDF",
    "header",
    "never leave your browser",
  ])
    expect(PRIVACY_SENTENCE, words).toContain(words);
});
