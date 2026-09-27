# 0032. One PDF extractor

Date: 2026-09-27 · Status: accepted

## Context

`docs/ats-prd.md` §8.3 asked for two permissively licensed PDF extractors, chosen by benchmarking
pdfminer.six against pypdfium2, with disagreement between the two as a readiness signal. Decision
0030 left extraction unresolved, deferring the choice to a milestone-1 benchmark. That benchmark
has not been useful enough to justify running: it settles which library to prefer, not whether the
project needs two of them at all.

## Decision

- pypdfium2 is the ATS's only PDF extractor. No benchmark is run.
- pdfminer.six is not adopted.
- This settles decision 0030's bullet that left extraction to be "chosen by benchmark in
  milestone 1". Decision 0030 itself is not edited.

## Consequences

- The "two extractors disagree" readiness signal from §8.3 is gone. Reading-order checks must
  instead come from pypdfium2's own character and text-rectangle positions.
- PDFium is the rendering engine Chrome uses, so the ATS reads a PDF the way a browser does. That
  is not necessarily how any given real-world ATS parser reads it, which is a limitation to keep in
  mind when interpreting findings.
- pypdfium2 bundles a prebuilt PDFium binary, adding a few MB to the service's image. The installed
  package's metadata states its own code as dual-licensed Apache-2.0 / BSD-3-Clause, and its bundled
  PDFium binary as BSD-3-Clause; both are permissive licences, consistent with §8.3's requirement.
- PDFium is not thread-safe. The service calls into it from a thread pool (decision 0030), so
  `ats.extract` serialises every call that touches a document, page or text page behind a single
  process-wide lock.
- Adding a second extractor later needs a new decision record.
