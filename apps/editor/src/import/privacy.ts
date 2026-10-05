/**
 * What the documents screen says of what leaves the browser (decision 0047). A `.tex` import sends
 * nothing (decision 0049, held by `no-network.test.ts`); the first pass's naming request, its
 * privacy gate and its leak check went with the naming step (decision 00XX). A PDF's text is sent
 * only once the person agrees (`src/pdf/consent.ts`), and a PDF goes to the checker only when the
 * person sends it there (the ATS feature, AGENTS.md).
 */

/**
 * What the documents screen says, under the way in: the privacy rule of decision 0047, that a
 * resume stays in the browser unless the person asks for something that needs to send it and is
 * told what is sent, and the three things that send. Plain English, no LaTeX, and no command named.
 */
export const PRIVACY_NOTE =
  "Your resume stays in this browser unless you ask for something that needs to send it, and you are told what is sent. Reading a PDF with the reading service sends its text, and only once you agree, with the setting below; checking a resume sends its PDF to the checker; importing a .tex file sends nothing.";
