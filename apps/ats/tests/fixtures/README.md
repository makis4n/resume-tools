# Fixtures

`minimal.pdf`: `tests/pdfs.py`'s `minimal_pdf()` output, written to disk once so
`.github/scripts/smoke-ats-image.sh` (a shell script, which cannot import `tests.pdfs`) has a real,
parseable PDF to post. `tests/test_extract.py` asserts this file's bytes equal a fresh call to
`minimal_pdf()`, so it cannot silently drift from the builder that made it; regenerate it by
writing `minimal_pdf()`'s output over this file if that builder ever changes.

`encrypted.pdf`: a one-page PDF with invented text (never real resume content), encrypted with a
user password. pypdfium2 cannot write encrypted PDFs, and qpdf was not installed, so it was built
with a throwaway script run once as `uv run --with pikepdf python <script>`; pikepdf is not a
project dependency. The script built a plain PDF with `tests/pdfs.py`'s `minimal_pdf`, then wrote
it back out through `pikepdf.Pdf.open(...).save(..., encryption=pikepdf.Encryption(...))`.
