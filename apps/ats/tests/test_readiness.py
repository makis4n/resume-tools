from ats.extract import Document, Page
from ats.producer import Producer
from ats.readiness import check


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
) -> Page:
    return Page(
        number=number,
        width=612,
        height=792,
        text="invented placeholder text",
        char_count=char_count,
        unmapped_count=unmapped_count,
        private_use_count=private_use_count,
        ligature_count=ligature_count,
        text_objects=text_objects,
        image_objects=image_objects,
        path_objects=path_objects,
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
