# 0087. Hidden text and keyword stuffing

Date: 2026-10-12 · Status: accepted

## Context

PRD §8.3 asks the analyser to find excessive repetition and invisible text, §12.1 lists adversarial
fixtures for them and §15 carries the risk that a resume gaming keyword matching is rewarded. An
ATS reads text a person cannot see, so such text both helps a resume unfairly and, once a recruiter
sees the extracted text, harms the candidate. Decision 0083 left both checks for later.

## Decision

- **Four signals, read per character from PDFium** (pypdfium2 5.13.0) in the same single pass as
  the glyph counts (`ats/extract.py`). `FPDFText_GetTextObject` gives the character's text object
  (also inside a Form XObject); results are cached per object.
  - invisible: render mode 3 (invisible) or 7 (clip), or every paint that draws the text has an
    alpha of 0 (an ExtGState `/ca 0`). The paints are the fill for modes 0 and 4, the stroke for
    1 and 5, and both for 2 and 6, so outlined text is hidden only if fill and stroke both are.
    Clip text (7) is visible if the render shows something other than near-white inside the
    character's box (a gradient or fill painted through it).
  - background-coloured: every paint that draws the text is within 16 of white, and the page as
    PDFium renders it (one lazy render per page, longest side at most 600 px) shows nothing but
    near-white inside the character's loose box. The render is the ground truth for what a reader
    sees, so gradient and tiling patterns (which PDFium reports as a white fill), stroked bars,
    images and dark panels are all handled without reading their paint.
  - tiny: the character's loose box (`FPDFText_GetLooseCharBox`, page space with every matrix
    applied) has `max(width, height)` under 3 pt. Plain font size is not used: it ignores
    text-matrix and `cm` scaling.
  - off page: the loose box does not intersect the crop box.
- **Cover rule.** Only invisible text uses covers. A cover is a top-level image of real
  resolution (at least 0.5 pixel per point each way, so a 1x1 image stretched over the page is not
  one) or a form with such an image inside (`_covers`, at most 500 per page). Invisible text whose
  box centre lies inside a cover is not hidden, since an OCR text layer over a scan hides
  nothing. The test is made per character. The crop box is read with its corners ordered, since a
  PDF rectangle may name any two opposite corners.
- **Counts only.** `Page` gains `hidden_count` (the union) and four per-reason counts, all within
  `char_count`. No text is read or stored.
- **`hidden-text`**: one finding per page with at least 20 hidden characters (ignoring a stray
  white bullet or one invisible anchor). Critical, so a manipulated resume is not rewarded, and
  origin content, because the person put the text there. The message lists the reasons from a
  fixed table and never quotes page text.
- **`repeated-terms`**: one document-level warning, origin content. The first 200,000 characters
  are tokenised (keeping c++, c#, node.js). It fires when a non-stopword, non-numeric token of two
  or more characters occurs at least 25 times and makes up at least 5% of all tokens, or when the
  same 1 to 3 token sequence repeats back to back at least 5 times (sequences of only stopwords,
  digits or single characters ignored). The message does not name the word, keeping to the rule
  that nothing quotes resume text.
- **Budgets fail open.** The existing 200,000 character budget also bounds the hidden checks (a
  page over it has all counts 0). Cover rectangle tests are limited to 100,000 per document; once spent
  every invisible-text lookup answers "covered", so a hostile upload gets no hidden count rather than quadratic
  work.
- **Rubric unchanged.** `RUBRIC_VERSION` stays `readiness-1` (decision 0083: new checks silent on
  existing fixtures). The analyser version moves to 0.2.0.

## Consequences

- Two new stable finding ids, `hidden-text` and `repeated-terms`; no contract change.
- Per-character cost is roughly four times the old pass (0.20 s extra over 201,598 characters, from
  measurements), bounded by the character budget.
- Known limits: text hidden under an opaque shape drawn on top of it; soft masks and blend modes
  (the render shows them, but the text colour is still read as drawn); coloured text on a
  same-coloured panel (only near-white text is compared); white text next to visible dark ink
  inside the same character box at render resolution; invisible text over a full-size image of any
  colour, including a white one, counts as an OCR layer; covers beyond 500 per page or after the test budget; pages past the character budget
  (stuffing after 200,000 visible characters is missed); repetition read from only the first
  200,000 characters; frequency thresholds not calibrated on a corpus. Hidden text is still part
  of the extracted text, so milestone 3 job matching should exclude it.
