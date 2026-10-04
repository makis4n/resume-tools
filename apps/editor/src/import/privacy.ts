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

/**
 * What the documents screen says, under the way in: the privacy rule of decision 0047, that a
 * resume stays in the browser unless the person asks for something that needs to send it and is
 * told what is sent, and the three things that send. Plain English, no LaTeX, and no command named.
 */
export const PRIVACY_NOTE =
  "Your resume stays in this browser unless you ask for something that needs to send it, and you are told what is sent. Reading a PDF with the reading service sends its text, and only once you agree, with the setting below; checking a resume sends its PDF to the checker; importing a .tex file sends nothing.";
