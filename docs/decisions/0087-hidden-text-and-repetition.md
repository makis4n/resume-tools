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
  - invisible: render mode 3 (invisible) or 7 (clip), or a paint alpha of 0 (an ExtGState `/ca 0`).
    The paint is the stroke colour for stroke modes, else the fill colour.
  - background-coloured: painted with every channel within 16 of white, and not over any cover.
  - tiny: the character's loose box (`FPDFText_GetLooseCharBox`, page space with every matrix
    applied) has `max(width, height)` under 3 pt. Plain font size is not used: it ignores
    text-matrix and `cm` scaling.
  - off page: the loose box does not intersect the crop box.
- **Cover rule.** A cover is a top-level image, shading, form, or filled path whose fill is not
  near-white (`_covers`, at most 500 per page). Near-white text whose box centre lies inside any
  cover is not hidden (a dark sidebar template). Invisible text over an image-like cover (an
  image, or a form with an image inside) is not hidden either, since an OCR text layer over a scan
  hides nothing. A form without an image is a cover for the colour check only, so that it cannot
  excuse invisible text drawn inside it.
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
  page over it has all counts 0). Rectangle tests are limited to 100,000 per document; once spent
  every lookup answers "covered", so a hostile upload gets no hidden count rather than quadratic
  work.
- **Rubric unchanged.** `RUBRIC_VERSION` stays `readiness-1` (decision 0083: new checks silent on
  existing fixtures). The analyser version moves to 0.2.0.

## Consequences

- Two new stable finding ids, `hidden-text` and `repeated-terms`; no contract change.
- Per-character cost is roughly four times the old pass (0.20 s extra over 201,598 characters, from
  measurements), bounded by the character budget.
- Known limits: text hidden under an opaque shape drawn on top of it; clipping paths; soft masks and
  blend modes; coloured text on a same-coloured panel (only near-white text, against the assumed
  white page, is compared); coloured panels drawn inside forms (the form is a cover, so the check
  is missed); covers beyond 500 per page or after the test budget; pages past the character budget
  (stuffing after 200,000 visible characters is missed); repetition read from only the first
  200,000 characters; frequency thresholds not calibrated on a corpus. Hidden text is still part
  of the extracted text, so milestone 3 job matching should exclude it.
