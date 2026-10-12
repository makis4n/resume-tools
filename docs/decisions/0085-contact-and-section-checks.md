# 0085. Contact and section checks

Date: 2026-10-12 · Status: accepted

## Context

Milestone 1 (`docs/ats-prd.md` §6.1, §8.3) asks the analyser to notice a resume with no way to
contact its owner and no conventional sections. Decision 0083 shipped the text-layer, page-count
and glyph checks; these are the next slice. They read resume text, which §11 says must never be
stored, logged or returned.

## Decision

- **Seven finding ids**, all document-level (no `page`) with origin `content`, so they fit the
  existing v1 `finding` shape and no contract change is needed:
  `missing-contact-email` (warning), `unrecognised-contact-email` (warning),
  `missing-contact-phone` (info), `missing-profile-link` (info), `missing-section-experience`
  (warning), `missing-section-education` (info, since §8.3 says "where applicable") and
  `missing-section-skills` (info). They sort after `page-count` and before `blank-page`.
- **Detection** lives in `ats/structure.py::detect`, by heuristics: an email regex, with an
  "unrecognised" state for an address someone tried to write that cannot be read (no TLD, spaces
  around `@` or `.`, or `[at]`); a phone regex counting 8 to 15 digits, rejecting year ranges and
  dates, and accepting an unseparated number only with a `+` or a label such as "Phone"; a profile
  link (a scheme, `www.`, a known profile host, or a bare domain with a common TLD, `.net`, `.edu` or a two-letter country code (not file-extension-like names such as `node.js`), not part of an
  email); and section headings, matched on short lines (at most 6 words and 50 characters) against
  the documented synonym lists `EXPERIENCE_*`, `EDUCATION_*` and `SKILLS_*`, after NFKC
  normalisation and with letter-spacing collapsed. A line is also searched for 1 to 3 words at
  either end (lines up to 400 characters), because a two-column layout puts a heading beside the
  other column's text, a phone number, an email or a link; ambiguous openers such as "Work" and
  "Tools" do not count there. `_matches` accepts a heading joined by `and`, `&` or `/` when either
  side matches, and a keyword inside a longer heading only when the surrounding words are ones
  headings use ("Work Experience"), so "User Experience Designer" is not a section. A bare domain
  counts as a profile link only in lowercase, so "JaneDoe.com" is not seen: a known limit.
- **Text only.** Link annotations are not read, so a clickable word with no visible address is not
  seen. That is why the profile-link finding is info and its message conditional.
- **Only when the document has readable text.** With no text layer, the critical text-layer finding
  is the one that matters, as with the glyph checks. The contact and section findings are also
  skipped when more than 20% of the document's characters are unmapped, since that text is garbage
  and `unmapped-glyphs` already says so. `detect` reads only the first 100,000 characters of the
  joined page text.
- **Privacy (§11).** `detect` returns a frozen dataclass of booleans. It never keeps, returns, logs
  or raises with a matched substring, and messages quote no resume text. Tests enforce it: the
  fact fields are all `bool`, and the serialised analysis of a resume with an email, phone and link
  contains none of them.
- **Suggestions** are producer-neutral. These are content findings and the same fix applies in
  every tool, so there are no `_BY_PRODUCER` entries.
- **Rubric.** `RUBRIC_VERSION` stays `readiness-1`. This clarifies decision 0083: adding new
  finding ids keeps the promise that the same findings score the same way, even though it lowers
  the score of some existing documents, such as ones with no contact details. The analyser version,
  now 0.2.0, tells those results apart.

## Consequences

- Heuristics have false positives and negatives, most of all for phone formats, which is why phone
  and profile link are info.
- Headings are English only.
- Evidence or positions per section, and a per-field breakdown, are later work.
- Fixtures that carried no contact details now score below 100.
