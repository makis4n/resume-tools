/**
 * What the import screen says of what leaves the browser (milestone 3 item 11, decision 0033), in
 * two plain sentences, which item 12 shows where a resume is imported. The naming request
 * (`naming.ts`) holds the template's command definitions, the names, emails, phone numbers, links
 * and addresses the page shows in them masked; the shape of a few calls, their letters and digits
 * placeholders and the template's command names kept; and the page's style settings. The resume's
 * text and the header's values stay in the browser, and the PDF leaves it only when the person
 * sends it to the checker (the ATS feature, AGENTS.md). What never reaches the page, a document's
 * metadata, the detector cannot read, so the builder sends such settings' text as placeholders
 * rather than as they are (`maskedMetadata`), and the gate refuses a request the check finds any
 * text of the document's in (`assertNoText`).
 */

/** What the import screen says: plain English, no LaTeX, and no command named. */
export const PRIVACY_NOTE =
  "To learn your template, the editor sends only its command definitions, with the names, emails, phone numbers, links and addresses your page shows replaced, the shape of a few places that use them, with their letters and digits replaced and the template's command names kept, and the page's style settings; your resume's text and your header never leave your browser, and its PDF leaves only when you send it to the checker. Text that never reaches your page, such as the author and title a document keeps in its details, cannot be checked, so the editor replaces it rather than sending it.";
