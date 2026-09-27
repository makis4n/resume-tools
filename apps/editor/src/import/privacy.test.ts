import { expect, test } from "vitest";
import { PRIVACY_NOTE } from "./privacy";

test("says what leaves the browser in two plain sentences that name no command", () => {
  expect(PRIVACY_NOTE).toBe(
    "To learn your template, the editor sends only its command definitions, with the names, emails, phone numbers, links and addresses your page shows replaced, the shape of a few places that use them, with their letters and digits replaced and the template's command names kept, and the page's style settings; your resume's text and your header never leave your browser, and its PDF leaves only when you send it to the checker. Text that never reaches your page, such as the author and title a document keeps in its details, cannot be checked, so the editor replaces it rather than sending it.",
  );
  // Two sentences, each ending with a full stop, and no other.
  expect(PRIVACY_NOTE.match(/[.!?]/g)).toEqual([".", "."]);
  expect(PRIVACY_NOTE.endsWith(".")).toBe(true);
  // No LaTeX: none of its special characters, no command, and no word of its own.
  expect(PRIVACY_NOTE).not.toMatch(/[\\{}$%#&^_~]/);
  expect(PRIVACY_NOTE.toLowerCase()).not.toMatch(
    /\b(?:la)?tex\b|\bmacros?\b|newcommand|documentclass|usepackage|preamble|\bdef\b|meaning|hypersetup|pdfauthor/,
  );
  // What goes, as far as the page shows it, what never does, and the one limit.
  for (const words of [
    "command definitions",
    "names, emails, phone numbers, links and addresses your page shows replaced",
    "letters and digits replaced",
    "command names kept",
    "style settings",
    "resume's text",
    "header never leave your browser",
    "PDF leaves only when you send it to the checker",
    "never reaches your page",
    "cannot be checked",
  ])
    expect(PRIVACY_NOTE, words).toContain(words);
});
