from ats.extract import Document, Page
from ats.findings import Origin, Severity
from ats.producer import Producer
from ats.readiness import _REPETITION_TEXT_BUDGET, check


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
    text: str = "invented placeholder text",
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
    assert ids == ["repeated-terms", "hidden-text"]
    assert check(doc, Producer.OTHER) == check(doc, Producer.OTHER)
