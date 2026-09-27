/**
 * What the import screen says of what leaves the browser (milestone 3 item 11, decision 0029), in
 * one plain sentence, which item 12 shows where a resume is imported. The naming request
 * (`naming.ts`) holds the template's command definitions, their names, emails, phone numbers,
 * links and addresses masked; the shape of a few calls, every letter and digit a placeholder; and
 * the page's style settings. The resume's text, the PDF and the header's values stay in the
 * browser, and the leak check (`findLeaks`) refuses a request that holds any of them, or any text
 * the page shows.
 */

/** The sentence the import screen shows: plain English, no LaTeX, and no command named. */
export const PRIVACY_SENTENCE =
  "To learn your template, the editor sends only its command definitions, with any names, emails, phone numbers, links and addresses replaced, the shape of a few places that use them, with every letter and digit replaced, and the page's style settings; your resume's text, its PDF and your header never leave your browser.";
