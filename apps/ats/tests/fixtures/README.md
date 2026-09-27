# Fixtures

`encrypted.pdf`: a one-page PDF with invented text (never real resume content), encrypted with a
user password. pypdfium2 cannot write encrypted PDFs, and qpdf was not installed, so it was built
with a throwaway script run once as `uv run --with pikepdf python <script>`; pikepdf is not a
project dependency. The script built a plain PDF with `tests/pdfs.py`'s `minimal_pdf`, then wrote
it back out through `pikepdf.Pdf.open(...).save(..., encryption=pikepdf.Encryption(...))`.
