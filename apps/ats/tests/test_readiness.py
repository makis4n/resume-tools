import time

from ats.extract import Document, Page
from ats.findings import Origin, Severity
from ats.producer import Producer
from ats.readiness import (
    _REPETITION_TEXT_BUDGET,
    Rect,
    _interleaved_lines,
    _join_markers,
    _segments,
    check,
)

_CLEAN_TEXT = (
    "Ada Inventa\nada.inventa@example.com | +1 555 010 0199 | github.com/ada-inventa-example\n"
    "Experience\nEngineer at Invented Works\nEducation\nBSc in Invention\n"
    "Skills\nPrototyping and documentation"
)


def _page(
    number: int = 1,
    *,
    char_count: int = 10,
    unmapped_count: int = 0,
    private_use_count: int = 0,
    ligature_count: int = 0,
    text_objects: int = 1,
    image_objects: int = 0,
    path_objects: int = 0,
    text_rects: tuple[Rect, ...] = (),
    hyphen_break_count: int = 0,
    text: str = _CLEAN_TEXT,
    hidden_count: int = 0,
    invisible_count: int = 0,
    background_colour_count: int = 0,
    tiny_count: int = 0,
    off_page_count: int = 0,
) -> Page:
    return Page(
        number=number,
        width=612,
        height=792,
        text=text,
        char_count=char_count,
        unmapped_count=unmapped_count,
        private_use_count=private_use_count,
        ligature_count=ligature_count,
        text_objects=text_objects,
        image_objects=image_objects,
        path_objects=path_objects,
        hidden_count=hidden_count,
        invisible_count=invisible_count,
        background_colour_count=background_colour_count,
        tiny_count=tiny_count,
        off_page_count=off_page_count,
        text_rects=text_rects,
        hyphen_break_count=hyphen_break_count,
    )


def _document(*pages: Page) -> Document:
    return Document(pages=tuple(pages), producer=None, creator=None)


def _ids(document: Document, producer: Producer = Producer.OTHER) -> list[str]:
    return [finding.id for finding in check(document, producer)]


# --- no-text-layer / text-as-outlines / image-only ---


def test_no_text_layer_when_no_page_has_any_content() -> None:
    document = _document(_page(char_count=0, text_objects=0))
    findings = check(document, Producer.OTHER)
    assert [f.id for f in findings] == ["no-text-layer"]
    assert findings[0].severity == "critical"
    assert findings[0].origin == "layout"
    assert findings[0].page is None


def test_text_as_outlines_when_mostly_paths() -> None:
    document = _document(_page(char_count=0, text_objects=0, path_objects=20, image_objects=0))
    assert _ids(document) == ["text-as-outlines"]


def test_image_only_when_images_present_and_not_mostly_paths() -> None:
    document = _document(_page(char_count=0, text_objects=0, path_objects=0, image_objects=1))
    assert _ids(document) == ["image-only"]


def test_scanned_page_with_a_border_is_image_only_not_outlines() -> None:
    # One scan image plus two rule/border paths: 2/3 paths by count, but far too few to be glyphs.
    document = _document(_page(char_count=0, text_objects=0, path_objects=2, image_objects=1))
    assert _ids(document) == ["image-only"]


def test_exactly_half_paths_is_not_mostly_paths() -> None:
    # 5 paths, 5 images: exactly 50%, not over it, so this falls through to the "any image" rule.
    document = _document(_page(char_count=0, text_objects=0, path_objects=5, image_objects=5))
    assert _ids(document) == ["image-only"]


def test_no_findings_at_all_for_a_normal_text_page() -> None:
    document = _document(_page())
    assert check(document, Producer.OTHER) == []


# --- blank-page ---


def test_blank_page_fires_when_another_page_has_text() -> None:
    document = _document(
        _page(number=1, char_count=10),
        _page(number=2, char_count=0, text_objects=0, image_objects=0, path_objects=0),
    )
    findings = check(document, Producer.OTHER)
    assert [f.id for f in findings] == ["blank-page"]
    assert findings[0].page == 2
    assert findings[0].severity == "warning"


def test_blank_page_does_not_fire_when_every_page_is_blank() -> None:
    document = _document(
        _page(number=1, char_count=0, text_objects=0),
        _page(number=2, char_count=0, text_objects=0),
    )
    # Every page is blank: this is `no-text-layer` for the whole document, not one blank page.
    assert _ids(document) == ["no-text-layer"]


def test_a_page_with_only_an_image_is_not_blank() -> None:
    document = _document(
        _page(number=1, char_count=10),
        _page(number=2, char_count=0, text_objects=0, image_objects=1),
    )
    assert _ids(document) == []


def test_a_page_with_a_text_object_but_no_characters_is_not_blank() -> None:
    document = _document(
        _page(number=1, char_count=10),
        _page(number=2, char_count=0, text_objects=1),
    )
    assert _ids(document) == []


# --- page-count ---


def test_page_count_fires_above_two_pages() -> None:
    document = _document(_page(1), _page(2), _page(3))
    findings = check(document, Producer.OTHER)
    assert [f.id for f in findings] == ["page-count"]
    assert findings[0].severity == "info"
    assert findings[0].origin == "content"
    assert findings[0].page is None
    assert "3" in findings[0].message


def test_page_count_does_not_fire_at_two_pages() -> None:
    document = _document(_page(1), _page(2))
    assert _ids(document) == []


# --- unmapped-glyphs ---


def test_unmapped_glyphs_does_not_fire_at_the_threshold() -> None:
    document = _document(_page(char_count=100, unmapped_count=2))
    assert _ids(document) == []


def test_unmapped_glyphs_warns_just_above_the_threshold() -> None:
    document = _document(_page(char_count=100, unmapped_count=3))
    findings = check(document, Producer.OTHER)
    assert [f.id for f in findings] == ["unmapped-glyphs"]
    assert findings[0].severity == "warning"
    assert findings[0].page == 1


def test_unmapped_glyphs_stays_warning_at_the_critical_threshold() -> None:
    document = _document(_page(char_count=100, unmapped_count=20))
    findings = check(document, Producer.OTHER)
    assert findings[0].severity == "warning"


def test_unmapped_glyphs_is_critical_just_above_the_critical_threshold() -> None:
    document = _document(_page(char_count=100, unmapped_count=21))
    findings = check(document, Producer.OTHER)
    assert findings[0].severity == "critical"


# --- icon-font-glyphs ---


def test_icon_font_glyphs_fires_for_any_private_use_character() -> None:
    document = _document(_page(char_count=10, private_use_count=1))
    findings = check(document, Producer.OTHER)
    assert [f.id for f in findings] == ["icon-font-glyphs"]
    assert findings[0].severity == "warning"
    assert findings[0].page == 1


def test_icon_font_glyphs_does_not_fire_with_none() -> None:
    document = _document(_page(char_count=10, private_use_count=0))
    assert _ids(document) == []


# --- ligature-characters ---


def test_ligature_characters_fires_for_any_ligature() -> None:
    document = _document(_page(char_count=10, ligature_count=1))
    findings = check(document, Producer.OTHER)
    assert [f.id for f in findings] == ["ligature-characters"]
    assert findings[0].severity == "warning"
    assert "profile" in findings[0].message


# --- short-circuit ---


def test_no_text_layer_short_circuits_the_per_page_glyph_checks() -> None:
    # Every page has zero characters, so nothing on it could be classified as unmapped, PUA or
    # ligature -- but the fields are set anyway here, to prove the short-circuit really suppresses
    # the per-page checks rather than the fields happening to be zero.
    document = _document(
        _page(char_count=0, unmapped_count=5, private_use_count=5, ligature_count=5, text_objects=0)
    )
    assert _ids(document) == ["no-text-layer"]


# --- ordering ---


def test_findings_are_ordered_by_page_then_by_fixed_id_order() -> None:
    document = _document(
        _page(number=1, char_count=100, unmapped_count=30, ligature_count=1),
        _page(number=2, char_count=100, private_use_count=1, unmapped_count=30),
        _page(number=3, char_count=0, text_objects=0),
    )
    findings = check(document, Producer.OTHER)
    assert [(f.page, f.id) for f in findings] == [
        (None, "page-count"),
        (1, "unmapped-glyphs"),
        (1, "ligature-characters"),
        (2, "unmapped-glyphs"),
        (2, "icon-font-glyphs"),
        (3, "blank-page"),
    ]


def test_check_is_deterministic() -> None:
    document = _document(
        _page(number=1, char_count=100, unmapped_count=30, ligature_count=1),
        _page(number=2, char_count=0, image_objects=1, text_objects=0),
    )
    first = check(document, Producer.OTHER)
    second = check(document, Producer.OTHER)
    assert [f.to_json() for f in first] == [f.to_json() for f in second]


# --- suggestions vary by producer ---


def test_latex_layout_findings_get_the_neutral_template_suggestion() -> None:
    document = _document(_page(char_count=0, text_objects=0))
    findings = check(document, Producer.LATEX)
    assert findings[0].suggestion == "This comes from the template's design."
    assert "tex" not in findings[0].suggestion.lower()
    assert "latex" not in findings[0].suggestion.lower()


def test_word_gets_a_word_specific_suggestion() -> None:
    document = _document(_page(char_count=0, text_objects=0))
    findings = check(document, Producer.WORD)
    assert "Save as PDF" in (findings[0].suggestion or "")


# --- hidden-text ---


def _findings(document: Document, finding_id: str) -> list:
    return [f for f in check(document, Producer.OTHER) if f.id == finding_id]


def test_hidden_text_fires_at_twenty_characters_and_not_at_nineteen() -> None:
    assert _ids(_document(_page(hidden_count=19, invisible_count=19))) == []
    (finding,) = _findings(_document(_page(2, hidden_count=20, tiny_count=20)), "hidden-text")
    assert finding.severity is Severity.CRITICAL
    assert finding.origin is Origin.CONTENT
    assert finding.page == 2
    assert finding.suggestion == (
        "Remove any text a reader cannot see, and keep each keyword in visible text where it is "
        "true."
    )


def test_hidden_text_message_lists_only_present_reasons_in_fixed_order_and_no_page_text() -> None:
    page = _page(
        hidden_count=30,
        off_page_count=5,
        invisible_count=10,
        tiny_count=7,
        text="secretword stuffing",
    )
    (finding,) = _findings(_document(page), "hidden-text")
    assert "(drawn invisibly, too small to read and placed outside the page)" in finding.message
    assert "secretword" not in finding.message
    (single,) = _findings(
        _document(_page(hidden_count=25, background_colour_count=25)), "hidden-text"
    )
    assert "(coloured to match the background)" in single.message


def test_hidden_text_is_not_reported_without_a_text_layer() -> None:
    page = _page(char_count=0, hidden_count=50, invisible_count=50, image_objects=1)
    assert "hidden-text" not in _ids(_document(page))


def test_hidden_text_sorts_after_ligatures_on_its_page() -> None:
    page = _page(ligature_count=1, hidden_count=20, invisible_count=20)
    assert _ids(_document(page)) == ["ligature-characters", "hidden-text"]


# --- repeated-terms ---


def _filler(count: int) -> str:
    return " ".join(f"word{i}" for i in range(count))


def _repeat_doc(word: str, times: int, filler: int) -> Document:
    """`word` `times` times, spread through `filler` other words so no run forms."""
    others = [f"word{i}" for i in range(filler)]
    tokens: list[str] = []
    gap = max(1, filler // times) if times else 1
    for index in range(times):
        tokens.append(word)
        tokens.extend(others[index * gap : (index + 1) * gap])
    tokens.extend(others[times * gap :])
    return _document(_page(text=" ".join(tokens)))


def test_a_word_repeated_often_enough_and_with_enough_share_fires() -> None:
    assert "repeated-terms" in _ids(_repeat_doc("python", 25, 100))
    assert "repeated-terms" not in _ids(_repeat_doc("python", 24, 100))
    # 25 occurrences but a share under 5% of all words.
    assert "repeated-terms" not in _ids(_repeat_doc("python", 25, 600))


def test_stopwords_and_digits_never_trigger_the_frequency_rule() -> None:
    assert "repeated-terms" not in _ids(_repeat_doc("the", 40, 10))
    assert "repeated-terms" not in _ids(_repeat_doc("2024", 40, 10))
    assert "repeated-terms" not in _ids(_repeat_doc("x", 40, 10))


def test_a_short_phrase_repeated_back_to_back_fires() -> None:
    for phrase in ("python", "machine learning", "cloud data pipelines"):
        unit = " ".join([phrase] * 5)
        assert "repeated-terms" in _ids(_document(_page(text=f"intro text {unit} outro text")))
        unit = " ".join([phrase] * 4)
        assert "repeated-terms" not in _ids(_document(_page(text=f"intro text {unit} outro text")))


def test_a_run_of_stopwords_alone_does_not_fire() -> None:
    assert "repeated-terms" not in _ids(_document(_page(text="so " + "and of " * 6)))


def test_ordinary_resume_repetition_gives_no_finding() -> None:
    sentence = (
        "Data analyst with experience in data pipelines. Built data models and data dashboards "
        "for finance teams, improving data quality and data access. "
    )
    text = sentence * 2 + " ".join(f"{_filler(25)} data" for _ in range(10))
    assert "repeated-terms" not in _ids(_document(_page(text=text)))


def test_the_repetition_scan_reads_only_the_first_budget_of_characters() -> None:
    stuffed = "python " * 40
    late = _page(text="a" * _REPETITION_TEXT_BUDGET + " " + stuffed)
    assert "repeated-terms" not in _ids(_document(late))
    huge = _page(text="lorem " * 2_000_000)
    assert "repeated-terms" in _ids(_document(huge))


def test_repeated_terms_is_document_level_without_quoting_the_word() -> None:
    doc = _document(_page(1, text="intro"), _page(2, text="zebra " * 30))
    (finding,) = _findings(doc, "repeated-terms")
    assert finding.page is None
    assert finding.severity is Severity.WARNING
    assert finding.origin is Origin.CONTENT
    assert finding.suggestion
    assert "zebra" not in finding.message
    ids = _ids(_document(_page(1, text="intro"), _page(2, text="zebra " * 30, hidden_count=20)))
    # The custom text carries no contact details, so content findings (decision 0085) fire too.
    assert [i for i in ids if i in ("repeated-terms", "hidden-text")] == [
        "repeated-terms",
        "hidden-text",
    ]
    assert check(doc, Producer.OTHER) == check(doc, Producer.OTHER)


def test_a_column_drawn_one_token_per_line_is_not_repetition() -> None:
    skills = "\n".join(["python", "terraform", "kubernetes", "postgres", "golang"])
    column = skills + "\n" + "\n".join(["advanced"] * 5)
    assert "repeated-terms" not in _ids(_document(_page(text=column)))


# --- reading order (decision 0086) ---

_H = 10.0  # line height used by the hand-built rects


def _line(left: float, right: float, row: int, offset: float = 0.0) -> Rect:
    bottom = 700.0 - 16 * row - offset
    return (left, bottom, right, bottom + _H)


def _interleaved(rows: int, offset: float = 0.0, left_right: float = 290.0) -> tuple[Rect, ...]:
    rects: list[Rect] = []
    for row in range(rows):
        rects.append(_line(72, left_right - (row % 2) * 10, row))
        rects.append(_line(330, 560, row, offset))
    return tuple(rects)


def _ids_for(rects: tuple[Rect, ...], producer: Producer = Producer.OTHER) -> list[str]:
    return _ids(_document(_page(text_rects=rects)), producer)


def test_four_alternating_filled_lines_fire_column_interleaving() -> None:
    (finding,) = check(_document(_page(text_rects=_interleaved(4))), Producer.OTHER)
    assert finding.id == "column-interleaving"
    assert finding.severity == "warning"
    assert finding.origin == "layout"
    assert finding.page == 1
    assert finding.suggestion


def test_three_alternating_lines_do_not_fire() -> None:
    assert _ids_for(_interleaved(3)) == []


def test_interleaving_with_offset_baselines_fires() -> None:
    assert _ids_for(_interleaved(7, offset=4.0)) == ["column-interleaving"]


def test_a_cleanly_ordered_two_column_page_does_not_fire() -> None:
    left = [_line(72, 290, row) for row in range(7)]
    right = [_line(330, 560, row) for row in range(7)]
    assert _ids_for(tuple(left + right)) == []


def test_a_single_column_page_does_not_fire() -> None:
    assert _ids_for(tuple(_line(72, 540, row) for row in range(20))) == []


def test_right_aligned_dates_between_full_width_bullets_do_not_fire() -> None:
    rects: list[Rect] = []
    row = 0
    for _ in range(4):
        rects.append(_line(72, 250, row))
        rects.append(_line(450, 540, row))
        row += 1
        for _ in range(2):
            rects.append(_line(72, 540, row))
            row += 1
    assert _interleaved_lines(tuple(rects)) == 0
    assert _ids_for(tuple(rects)) == []


def test_a_date_column_whose_description_lines_break_alternation_does_not_fire() -> None:
    rects: list[Rect] = []
    for row in range(6):
        rects.append(_line(72, 250, 2 * row))
        rects.append(_line(450, 540, 2 * row))
        rects.append(_line(72, 540, 2 * row + 1))
    assert _ids_for(tuple(rects)) == []


def test_a_skills_grid_with_unfilled_left_cells_does_not_fire() -> None:
    widths = (60, 150, 70, 240, 65)
    rects: list[Rect] = []
    for row, width in enumerate(widths):
        rects.append(_line(72, 72 + width, row))
        rects.append(_line(330, 400, row))
    assert _interleaved_lines(tuple(rects)) == 0
    assert _ids_for(tuple(rects)) == []


def test_per_glyph_rects_are_merged_into_segments() -> None:
    glyphs = tuple((72 + 6.0 * i, 700.0, 77.0 + 6.0 * i, 710.0) for i in range(10))
    assert _segments(glyphs) == [(72.0, 700.0, 131.0, 710.0)]
    # a gutter between two glyph runs is not merged
    split = glyphs + ((330.0, 700.0, 335.0, 710.0),)
    assert len(_segments(split)) == 2


def test_an_interleaved_layout_drawn_per_glyph_still_fires() -> None:
    rects: list[Rect] = []
    for row in range(5):
        bottom = 700.0 - 16 * row
        for start, count in ((72.0, 36), (330.0, 38)):
            rects.extend(
                (start + 6.0 * i, bottom, start + 5.0 + 6.0 * i, bottom + _H) for i in range(count)
            )
    assert _ids_for(tuple(rects)) == ["column-interleaving"]


def test_hyphen_breaks_fire_hyphenated_line_breaks() -> None:
    (finding,) = check(_document(_page(hyphen_break_count=2)), Producer.OTHER)
    assert finding.id == "hyphenated-line-breaks"
    assert finding.severity == "warning"
    assert finding.origin == "layout"
    assert finding.page == 1
    assert _ids(_document(_page(hyphen_break_count=0))) == []


def test_reading_order_checks_do_not_run_without_a_text_layer() -> None:
    document = _document(
        _page(char_count=0, text_objects=0, text_rects=_interleaved(5), hyphen_break_count=3)
    )
    assert _ids(document) == ["no-text-layer"]


def test_reading_order_ids_sort_after_ligatures_within_a_page() -> None:
    document = _document(
        _page(ligature_count=1, text_rects=_interleaved(5), hyphen_break_count=1),
    )
    assert _ids(document) == [
        "ligature-characters",
        "column-interleaving",
        "hyphenated-line-breaks",
    ]


def test_reading_order_suggestions_vary_by_producer() -> None:
    page = _page(text_rects=_interleaved(5), hyphen_break_count=1)
    document = _document(page)

    def suggestions(producer: Producer) -> list[str | None]:
        return [f.suggestion for f in check(document, producer)]

    template = "This comes from the template's design."
    latex = suggestions(Producer.LATEX)
    assert latex[0] == template
    assert latex[1] and "Reword" in latex[1] and "compound" in latex[1]
    word = suggestions(Producer.WORD)
    assert word[0] and "Layout > Columns" in word[0]
    assert word[1] and word[1].startswith("Turn off hyphenation with Layout > Hyphenation > None")
    google = suggestions(Producer.GOOGLE_DOCS)
    assert google[0] and "Format > Columns" in google[0]
    for producer in (Producer.CANVA, Producer.OTHER):
        default = suggestions(producer)
        assert default[0] and default[0].startswith("Use a single-column layout")
        assert default[1] and default[1].startswith("Turn off automatic hyphenation")
    for producer in Producer:
        for text in suggestions(producer):
            assert text and "latex" not in text.lower() and "\\" not in text


def test_right_aligned_right_cells_in_long_rows_do_not_fire() -> None:
    # Education rows: a long left cell at x=50 and a right cell right-aligned to x=562, so the
    # right cells start at different x. Each row already reads in order.
    rights = (180.0, 200.0, 170.0, 190.0)
    rects: list[Rect] = []
    for row, width in enumerate(rights):
        rects.append(_line(50, 50 + 200 + row * 7, row))
        rects.append(_line(562 - width, 562, row))
    assert _interleaved_lines(tuple(rects)) == 0


def test_a_two_column_table_of_ragged_long_cells_does_not_fire() -> None:
    lefts = (190.0, 235.0, 205.0, 250.0)
    rights = (240.0, 195.0, 255.0, 210.0)
    rects: list[Rect] = []
    for row in range(4):
        rects.append(_line(50, 50 + lefts[row], row))
        rects.append(_line(320, 320 + rights[row], row))
    assert _interleaved_lines(tuple(rects)) == 0


def test_hyphen_message_names_compound_hyphens() -> None:
    (finding,) = check(_document(_page(hyphen_break_count=1)), Producer.WORD)
    assert "compound" in finding.message
    assert finding.suggestion and "compound" in finding.suggestion


def _bulleted_rows(
    items: int,
    lines_per_item: int,
    *,
    left_x: float = 72.0,
    right_x: float = 330.0,
    indent: float = 18.0,
    marker: bool = True,
) -> tuple[Rect, ...]:
    """Two columns of bulleted items, written left, right, left, right line by line. The last line
    of each item is short. With `marker`, the bullet is a small separate rect."""
    rects: list[Rect] = []
    row = 0
    for _ in range(items):
        for line in range(lines_per_item):
            for x in (left_x, right_x):
                bottom = 700.0 - 16 * row
                last = line == lines_per_item - 1
                text_x = x + indent
                if line == 0 and marker:
                    rects.append((x, bottom + 3, x + 4, bottom + 7))
                right = text_x + (90 if last else 200 - indent)
                rects.append((text_x, bottom, right, bottom + _H))
            row += 1
    return tuple(rects)


def test_interleaved_bulleted_columns_with_short_last_lines_fire() -> None:
    rects = _bulleted_rows(items=4, lines_per_item=3)
    assert _ids_for(rects) == ["column-interleaving"]


def test_interleaved_columns_of_two_line_items_are_not_detected() -> None:
    # Half the lines are short: not told apart from a table of ragged cells (decision 0086).
    assert _ids_for(_bulleted_rows(items=6, lines_per_item=2)) == []


def test_bullet_marks_are_merged_into_their_text() -> None:
    rects = ((72.0, 703.0, 76.0, 707.0), (90.0, 700.0, 270.0, 710.0))
    assert _join_markers(_segments(rects)) == [(72.0, 700.0, 270.0, 710.0)]


def test_interleaved_bullets_with_the_text_in_a_tight_hanging_indent_fire() -> None:
    rects = _bulleted_rows(items=4, lines_per_item=3, indent=12.0, marker=True)
    segments = _join_markers(_segments(rects))
    # Two start positions per side: the bullet's x and the indent, so a one-x check fails.
    assert len({round(seg[0]) for seg in segments if seg[0] < 200}) == 2
    assert _ids_for(rects) == ["column-interleaving"]


def test_two_unfilled_cells_in_a_row_do_not_count_as_filled() -> None:
    # Wide, aligned columns with 6 of 8 segments filled (above the ratio), but two unfilled
    # segments sit side by side, so the rule in `_filled` alone rejects them.
    rects: list[Rect] = []
    for row, full in enumerate((True, True, True, False, False, True, True, True)):
        rects.append(_line(72, 283 if full else 232, row))
        rects.append(_line(330, 540 if full else 490, row))
    assert _interleaved_lines(tuple(rects)) == 0
    # The same columns with the unfilled segments apart are read as interleaved prose.
    apart = []
    for row, full in enumerate((True, True, False, True, True, False, True, True)):
        apart.append(_line(72, 283 if full else 232, row))
        apart.append(_line(330, 540 if full else 490, row))
    assert _interleaved_lines(tuple(apart)) == 8


def test_a_long_chain_with_distinct_starts_is_checked_in_near_linear_time() -> None:
    rows = 20000
    rects: list[Rect] = []
    for row in range(rows):
        bottom = 400000.0 - 16 * row
        start = 72.0 - 0.00001 * row
        rects.append((start, bottom, 283.0, bottom + _H))
        rects.append((330.0, bottom, 540.0, bottom + _H))
    began = time.perf_counter()
    longest = _interleaved_lines(tuple(rects))
    elapsed = time.perf_counter() - began
    assert longest == rows  # one chain, so the alignment check ran on every segment
    assert elapsed < 2.0


# --- contact and section findings (decision 0085) ---

_NEW_IDS = [
    "missing-contact-email",
    "missing-contact-phone",
    "missing-profile-link",
    "missing-section-experience",
    "missing-section-education",
    "missing-section-skills",
]


def test_a_text_page_with_no_contact_or_headings_gets_every_content_finding() -> None:
    document = _document(_page(text="Some invented words and nothing else"))
    findings = check(document, Producer.OTHER)
    assert [f.id for f in findings] == _NEW_IDS
    assert [f.severity for f in findings] == [
        "warning",
        "info",
        "info",
        "warning",
        "info",
        "info",
    ]
    assert all(f.origin == "content" and f.page is None for f in findings)


def test_an_email_candidate_alone_is_unrecognised_not_missing() -> None:
    text = _CLEAN_TEXT.replace("ada.inventa@example.com", "ada@inventa")
    ids = _ids(_document(_page(text=text)))
    assert ids == ["unrecognised-contact-email"]
    findings = check(_document(_page(text=text)), Producer.OTHER)
    assert findings[0].severity == "warning"


def test_no_contact_or_section_findings_without_a_text_layer() -> None:
    document = _document(_page(char_count=0, text_objects=0, text=""))
    assert _ids(document) == ["no-text-layer"]


def test_content_findings_sort_before_per_page_findings_and_after_page_count() -> None:
    pages = [_page(n, text="nothing useful") for n in (1, 2, 3)]
    pages[0] = _page(1, text="nothing useful", private_use_count=1)
    ids = _ids(_document(*pages))
    assert ids[0] == "page-count"
    assert ids[1] == "missing-contact-email"
    assert ids[-1] == "icon-font-glyphs"


def test_latex_content_findings_use_the_neutral_suggestion() -> None:
    findings = check(_document(_page(text="nothing useful")), Producer.LATEX)
    assert findings
    for finding in findings:
        assert finding.suggestion
        assert "\\" not in finding.suggestion and "LaTeX" not in finding.suggestion
        assert finding.suggestion != "This comes from the template's design."


def test_detect_reads_a_bounded_amount_of_text(monkeypatch) -> None:
    import ats.readiness as readiness

    seen: list[int] = []
    real = readiness.detect

    def spy(text: str):
        seen.append(len(text))
        return real(text)

    monkeypatch.setattr(readiness, "detect", spy)
    check(_document(_page(text="a. " * 400_000)), Producer.OTHER)
    assert seen == [readiness._DETECT_CHAR_LIMIT]


def test_content_findings_are_skipped_when_the_text_is_mostly_unmapped() -> None:
    document = _document(_page(text="nothing useful", char_count=800, unmapped_count=800))
    assert _ids(document) == ["unmapped-glyphs"]
