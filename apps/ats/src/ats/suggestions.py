"""Suggestion text for a finding, chosen by `(finding id, producer)` (PRD §7.4, §8.3).

This is the only place suggestion text lives; `ats.readiness` calls `suggestion_for` while
building each finding. Every string is plain, practical and short, and none names a LaTeX command:
in the panel, a layout finding on a curated template must read as a template limitation, not a
lesson in the tool that made it (PRD §7.4).
"""

from ats.producer import Producer

# Shown instead of naming LaTeX or any of its commands, for every layout finding on a LaTeX PDF.
_LATEX_TEMPLATE_SUGGESTION = "This comes from the template's design."

# The producer-neutral suggestion for a finding id, used when `_BY_PRODUCER` has nothing more
# specific. `page-count` and `blank-page` have none: there is nothing a specific tool does
# differently for them.
_DEFAULTS: dict[str, str] = {
    "no-text-layer": (
        "Export your resume so its text stays selectable, rather than flattening it to an image."
    ),
    "text-as-outlines": (
        "Export your resume so its text stays selectable, rather than converting it to shapes."
    ),
    "image-only": "Export your resume as a PDF with real text, rather than as a scanned image.",
    "unmapped-glyphs": "Use a standard, widely supported font and export the PDF again.",
    "icon-font-glyphs": "Replace icon or symbol glyphs with plain text.",
    "ligature-characters": (
        "Turn off font ligatures, or use a font that does not substitute them, before exporting."
    ),
}

# Suggestion text specific to the producing tool, keyed by finding id then by Producer. Only a
# menu name or option Claude is confident exists is named here.
_BY_PRODUCER: dict[str, dict[Producer, str]] = {
    "no-text-layer": {
        Producer.WORD: 'Use File > Save As > PDF ("Save as PDF") rather than printing to PDF.',
        Producer.GOOGLE_DOCS: "Use File > Download > PDF Document (.pdf).",
        Producer.CANVA: 'Turn off "Flatten PDF" when downloading as PDF Standard.',
        Producer.LATEX: _LATEX_TEMPLATE_SUGGESTION,
    },
    "text-as-outlines": {
        Producer.CANVA: 'Turn off "Flatten PDF" when downloading as PDF Standard.',
        Producer.LATEX: _LATEX_TEMPLATE_SUGGESTION,
    },
    "image-only": {
        Producer.WORD: (
            'Use File > Save As > PDF ("Save as PDF") rather than printing a scanned copy.'
        ),
        Producer.GOOGLE_DOCS: (
            "Use File > Download > PDF Document (.pdf) rather than a scanned copy."
        ),
        Producer.CANVA: 'Turn off "Flatten PDF" when downloading as PDF Standard.',
        Producer.LATEX: _LATEX_TEMPLATE_SUGGESTION,
    },
    "unmapped-glyphs": {
        Producer.LATEX: _LATEX_TEMPLATE_SUGGESTION,
    },
    "icon-font-glyphs": {
        Producer.LATEX: _LATEX_TEMPLATE_SUGGESTION,
    },
    "ligature-characters": {
        Producer.LATEX: _LATEX_TEMPLATE_SUGGESTION,
    },
}


def suggestion_for(finding_id: str, producer: Producer) -> str | None:
    """The suggestion text for `finding_id` under `producer`.

    Prefers a producer-specific string, falls back to the producer-neutral default, and returns
    `None` when this module has no suggestion at all for `finding_id`.
    """
    by_producer = _BY_PRODUCER.get(finding_id, {})
    if producer in by_producer:
        return by_producer[producer]
    return _DEFAULTS.get(finding_id)
