"""Tests for the skills taxonomy (decision 0084): the data file, and `ats.taxonomy`'s loader,
normalisation, lookup and mention-finding.
"""

import hashlib
import importlib.resources
import json
import time
import tomllib
from pathlib import Path

import pytest

from ats.taxonomy import (
    Mention,
    Skill,
    SkillKind,
    Taxonomy,
    TaxonomyError,
    load,
    load_from_bytes,
    load_from_path,
    normalise,
    version_for,
)

DATA_PATH = Path(__file__).parent.parent / "src" / "ats" / "data" / "skills.json"


def _raw_entries() -> list[dict]:
    return json.loads(DATA_PATH.read_text())["entries"]


def _minimal_entry(**overrides: object) -> dict:
    entry = {"id": "widget-making", "name": "Widget making", "kind": "skill", "aliases": []}
    entry.update(overrides)
    return entry


def _bytes_for(entries: list[dict]) -> bytes:
    return json.dumps({"entries": entries}).encode()


# ---------------------------------------------------------------------------
# The data file itself
# ---------------------------------------------------------------------------


def test_has_at_least_300_entries() -> None:
    assert len(_raw_entries()) >= 300


def test_ids_are_sorted_alphabetically() -> None:
    ids = [e["id"] for e in _raw_entries()]
    assert ids == sorted(ids)


def test_ids_are_kebab_case_and_unique() -> None:
    ids = [e["id"] for e in _raw_entries()]
    assert len(ids) == len(set(ids))
    for entry_id in ids:
        assert entry_id, "empty id"
        assert entry_id == entry_id.lower(), f"'{entry_id}' is not lower case"
        assert " " not in entry_id, f"'{entry_id}' contains a space"
        assert "_" not in entry_id, f"'{entry_id}' contains an underscore"


def test_kinds_are_known() -> None:
    for entry in _raw_entries():
        assert entry["kind"] in ("skill", "tool", "qualification"), entry


def test_names_are_non_empty() -> None:
    for entry in _raw_entries():
        assert entry["name"].strip(), entry["id"]


def test_every_alias_is_unique_after_normalisation_across_the_whole_file() -> None:
    owner: dict[str, str] = {}
    for entry in _raw_entries():
        for term in (entry["name"], *entry.get("aliases", [])):
            key = normalise(term)
            assert key not in owner or owner[key] == entry["id"], (
                f"'{term}' in '{entry['id']}' collides with '{owner.get(key)}'"
            )
            owner[key] = entry["id"]


def test_no_alias_equals_another_entrys_name() -> None:
    names = {normalise(e["name"]): e["id"] for e in _raw_entries()}
    for entry in _raw_entries():
        for alias in entry.get("aliases", []):
            key = normalise(alias)
            if key in names:
                assert names[key] == entry["id"], (
                    f"alias '{alias}' of '{entry['id']}' equals the name of '{names[key]}'"
                )


def test_case_sensitive_entries_are_names_or_aliases() -> None:
    for entry in _raw_entries():
        allowed = {entry["name"], *entry.get("aliases", [])}
        for exact in entry.get("case_sensitive", []):
            assert exact in allowed, entry["id"]


def test_not_followed_by_only_appears_alongside_case_sensitive() -> None:
    for entry in _raw_entries():
        if entry.get("not_followed_by"):
            assert entry.get("case_sensitive"), entry["id"]


def test_html_css_and_linux_are_present() -> None:
    ids = {e["id"] for e in _raw_entries()}
    assert "html" in ids
    assert "css" in ids
    assert "linux-operating-system" in ids


# ---------------------------------------------------------------------------
# The package data is included in the wheel
# ---------------------------------------------------------------------------


def test_package_data_is_reachable_via_importlib_resources() -> None:
    resource = importlib.resources.files("ats") / "data" / "skills.json"
    assert resource.is_file()
    assert json.loads(resource.read_bytes())["entries"]


def test_hatch_wheel_config_includes_non_python_files_under_src_ats() -> None:
    # hatchling includes every file under a listed package by default (it has no include/exclude
    # pattern here that would leave `data/skills.json` out); this test fails loudly if that ever
    # changes, rather than relying on the wheel-build check alone.
    pyproject = tomllib.loads((Path(__file__).parent.parent / "pyproject.toml").read_text())
    wheel_config = pyproject["tool"]["hatch"]["build"]["targets"]["wheel"]
    assert wheel_config["packages"] == ["src/ats"]
    assert "include" not in wheel_config, "an include pattern could silently drop data/skills.json"
    assert "exclude" not in wheel_config or "data" not in str(wheel_config.get("exclude"))


# ---------------------------------------------------------------------------
# normalise()
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("term", "expected"),
    [
        ("Python", "python"),
        ("  Python   Developer  ", "python developer"),
        ("PYTHON", "python"),
        ("Node.js", "node.js"),
        ("NODE.JS", "node.js"),
        (".NET", ".net"),
        ("C++", "c++"),
        ("C#", "c#"),
        ("CI/CD", "ci/cd"),
        ("A/B testing", "a/b testing"),
        ("(Python)", "python"),
        ("Python,", "python"),
        ("'Python'", "python"),
        ("“Python”", "python"),
        # A trailing period is *not* stripped: "." is always kept, never conditionally, because
        # keeping it selectively (strip it after "Python" but not after ".NET") would need to
        # know which term it is stripping punctuation from before it has finished doing so.
        # normalise() is meant for a standalone alias, name or lookup() term, never a sentence
        # fragment sliced out of running prose, so this is in scope for lookup() edge cases like
        # "(Python)," but a bare trailing sentence period is not a case it needs to handle.
        ("Python.", "python."),
        ("e-learning", "e-learning"),
        ("Bachelor's degree", "bachelor's degree"),
        ("modelling", "modelling"),
        ("MODELLING", "modelling"),
    ],
)
def test_normalise_examples(term: str, expected: str) -> None:
    assert normalise(term) == expected


def test_normalise_is_deterministic_and_idempotent() -> None:
    term = "  Node.JS,  "
    once = normalise(term)
    assert normalise(term) == once
    assert normalise(once) == once


def test_normalise_keeps_meaningful_symbols_only_where_they_sit() -> None:
    # Not stripped from the middle or a meaningful edge.
    assert normalise("C++") == "c++"
    assert normalise(".NET") == ".net"
    # Stripped when they are truly just sentence punctuation around an unrelated term.
    assert normalise("Excel,") == "excel"
    assert normalise("(SQL)") == "sql"


# ---------------------------------------------------------------------------
# Taxonomy.lookup()
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def taxonomy() -> Taxonomy:
    return load()


def test_load_is_cached() -> None:
    assert load() is load()


def test_lookup_by_canonical_name(taxonomy: Taxonomy) -> None:
    skill = taxonomy.lookup("Python")
    assert skill is not None
    assert skill.id == "python-programming-language"
    assert skill.kind == SkillKind.TOOL


def test_lookup_by_alias_and_case_insensitively(taxonomy: Taxonomy) -> None:
    for term in ("node.js", "NODE.JS", "nodejs", "Node Js", "node js"):
        skill = taxonomy.lookup(term)
        assert skill is not None, term
        assert skill.id == "nodejs"


def test_lookup_unknown_term_returns_none(taxonomy: Taxonomy) -> None:
    assert taxonomy.lookup("underwater basket weaving") is None
    assert taxonomy.lookup("") is None


def test_lookup_honours_case_sensitive_spark_lowercase_does_not_match(taxonomy: Taxonomy) -> None:
    spark = taxonomy.lookup("Spark")
    assert spark is not None
    assert spark.id == "apache-spark"
    assert taxonomy.lookup("spark") is None
    # The all-caps form (a shouted heading) is accepted; mixed case is not.
    all_caps = taxonomy.lookup("SPARK")
    assert all_caps is not None
    assert all_caps.id == "apache-spark"
    assert taxonomy.lookup("sPARK") is None


def test_lookup_case_sensitive_chef_vs_lowercase(taxonomy: Taxonomy) -> None:
    assert taxonomy.lookup("Chef") is not None
    assert taxonomy.lookup("chef") is None


def test_lookup_accepts_all_caps_for_a_case_sensitive_alias(taxonomy: Taxonomy) -> None:
    for term in ("REACT", "React", "EXCEL", "CHEF"):
        assert taxonomy.lookup(term) is not None, term
    assert taxonomy.lookup("react") is None
    assert taxonomy.lookup("rEACT") is None


def test_lookup_retries_without_a_trailing_period(taxonomy: Taxonomy) -> None:
    python = taxonomy.lookup("Python")
    assert python is not None
    assert taxonomy.lookup("Python.") == python
    assert taxonomy.lookup("python...") == python
    # A period that belongs to the term is still honoured, and case rules still apply.
    assert taxonomy.lookup("Node.js") is not None
    assert taxonomy.lookup(".NET") is not None
    assert taxonomy.lookup("Spark.") is not None
    assert taxonomy.lookup("spark.") is None
    assert taxonomy.lookup("underwater basket weaving.") is None
    assert taxonomy.lookup(".") is None


def test_lookup_tolerates_incidental_punctuation_and_whitespace(taxonomy: Taxonomy) -> None:
    assert taxonomy.lookup("  Python  ") is not None
    assert taxonomy.lookup("(Python)") is not None


# ---------------------------------------------------------------------------
# Taxonomy.mentions()
# ---------------------------------------------------------------------------


def test_mentions_finds_the_longest_match(taxonomy: Taxonomy) -> None:
    text = "Looking for a machine learning engineer with strong Python skills."
    mentions = taxonomy.mentions(text)
    ids = [m.skill.id for m in mentions]
    assert "machine-learning" in ids
    assert not any(
        m.skill.name == "Machine learning" and text[m.start : m.end] == "machine" for m in mentions
    )
    (ml_mention,) = [m for m in mentions if m.skill.id == "machine-learning"]
    assert text[ml_mention.start : ml_mention.end] == "machine learning"


def test_mentions_finds_symbol_bearing_terms(taxonomy: Taxonomy) -> None:
    text = "Skilled in C++, C#, .NET, Node.js and CI/CD pipelines."
    ids = {m.skill.id for m in taxonomy.mentions(text)}
    assert {"c-plus-plus", "c-sharp", "dot-net", "nodejs", "ci-cd"} <= ids


def test_mentions_java_does_not_match_inside_javascript(taxonomy: Taxonomy) -> None:
    mentions = taxonomy.mentions("Strong JavaScript skills required.")
    ids = [m.skill.id for m in mentions]
    assert "javascript" in ids
    assert "java" not in ids


def test_mentions_no_bare_r_go_or_c_false_positives(taxonomy: Taxonomy) -> None:
    # "Go", "R" and "C" bare are intentionally not in the taxonomy at all (decision 0084): even
    # exact-case matching would still collide with ordinary prose ("Go the extra mile", "R&D",
    # "C-suite"). This asserts that residual behaviour rather than the taxonomy's contents.
    text = (
        "Go the extra mile. Our R&D team works closely with C-suite executives. "
        "React developers welcome."
    )
    mentions = taxonomy.mentions(text)
    matched_texts = {text[m.start : m.end] for m in mentions}
    assert "Go" not in matched_texts
    assert "R" not in matched_texts
    assert "C" not in matched_texts
    # "React" is a legitimate mention even though it starts with "R".
    assert any(m.skill.id == "react" for m in mentions)


def test_mentions_no_false_positive_on_ambiguous_capitalised_words_we_dropped(
    taxonomy: Taxonomy,
) -> None:
    # "Word" and "Access" bare were dropped as too noisy (decision 0084); only the "Microsoft
    # ..." / "MS ..." aliases are in the taxonomy. "Excel" is back (see the not_followed_by tests
    # below), guarded against exactly this idiom instead of dropped.
    text = "Excel in a fast-paced environment. Word of mouth matters. Access to the office is easy."
    ids = {m.skill.id for m in taxonomy.mentions(text)}
    assert "excel-spreadsheets" not in ids
    assert "microsoft-word" not in ids
    assert "microsoft-access" not in ids


def test_mentions_case_sensitive_terms_do_not_match_lower_case_prose(taxonomy: Taxonomy) -> None:
    text = "Please spark some ideas and chef up a plan; go for it."
    ids = {m.skill.id for m in taxonomy.mentions(text)}
    assert "apache-spark" not in ids
    assert "chef-configuration-management" not in ids


def test_mentions_returns_multiple_mentions_in_order_with_correct_offsets(
    taxonomy: Taxonomy,
) -> None:
    text = "We use Python, then React, and finally PostgreSQL for storage."
    mentions = taxonomy.mentions(text)
    assert len(mentions) >= 3
    starts = [m.start for m in mentions]
    assert starts == sorted(starts)
    for m in mentions:
        assert text[m.start : m.end]  # round-trips to a non-empty substring
        assert isinstance(m, Mention)
        assert isinstance(m.skill, Skill)


def test_mentions_are_non_overlapping(taxonomy: Taxonomy) -> None:
    text = "Node.js and NodeJS and node js all refer to the same runtime."
    mentions = taxonomy.mentions(text)
    for earlier, later in zip(mentions, mentions[1:], strict=False):
        assert earlier.end <= later.start


def test_mentions_finds_nothing_in_unrelated_text(taxonomy: Taxonomy) -> None:
    text = (
        "The old house on the hill had seen better days, its paint peeling and its garden "
        "overgrown with wildflowers that nobody had planted."
    )
    assert taxonomy.mentions(text) == []


def test_mentions_is_deterministic(taxonomy: Taxonomy) -> None:
    text = "Python, SQL, React, leadership and stakeholder management are all required."
    first = taxonomy.mentions(text)
    second = taxonomy.mentions(text)
    assert first == second


def test_mentions_finds_nothing_silly_in_invented_plain_prose(taxonomy: Taxonomy) -> None:
    """A hostile self-review pass: run `mentions` over ordinary, invented paragraphs that were
    not written to mention any skill, and check nothing fires."""
    paragraphs = [
        "Maria spent the weekend repainting the fence behind her grandmother's cottage, "
        "humming an old tune she barely remembered the words to.",
        "The bakery on the corner sells out of cinnamon rolls by nine most mornings, so "
        "Tomas always leaves a little earlier on Fridays.",
        "A gentle rain fell over the harbour as the last ferry of the day pulled away from "
        "the dock, its lights fading slowly into the mist.",
        "The committee agreed to postpone the picnic until the following weekend, since the "
        "forecast promised nothing but grey skies and wind.",
    ]
    for paragraph in paragraphs:
        assert taxonomy.mentions(paragraph) == [], paragraph


def test_mentions_finds_nothing_in_the_reviewed_ambiguous_word_paragraph(
    taxonomy: Taxonomy,
) -> None:
    """The exact paragraph the review flagged: every capitalised word in it is either an
    ambiguous alias we dropped, or an ambiguous one we kept case-sensitive but that appears here
    in lower case, so it must not match."""
    text = "Our organization is growing; express interest by Spring. Keep a positive outlook."
    assert taxonomy.mentions(text) == []


def test_mentions_sentence_initial_capital_is_a_known_false_positive(taxonomy: Taxonomy) -> None:
    """Documented limit (decision 0084): `case_sensitive` cannot tell a capital that names the
    tool from one that is only there because the word starts a sentence. Only Excel carries a
    `not_followed_by` guard; "React quickly." still tags React."""
    assert any(m.skill.id == "react" for m in taxonomy.mentions("React quickly."))
    assert not taxonomy.mentions("Excel in a fast-paced environment.")


def test_mentions_no_false_positive_on_pr_ts_or_lower_case_ml(taxonomy: Taxonomy) -> None:
    text = "PR review needed. TS types. 500 ml saline."
    ids = {m.skill.id for m in taxonomy.mentions(text)}
    assert "public-relations" not in ids
    assert "typescript" not in ids
    assert "machine-learning" not in ids


def test_mentions_finds_ml_only_in_upper_case(taxonomy: Taxonomy) -> None:
    assert any(m.skill.id == "machine-learning" for m in taxonomy.mentions("Strong ML skills."))
    assert not any(m.skill.id == "machine-learning" for m in taxonomy.mentions("500 ml saline."))


def test_mentions_performance_on_a_50kb_document(taxonomy: Taxonomy) -> None:
    sentence = (
        "The candidate should have experience with Python, JavaScript, React, Node.js, SQL, "
        "AWS, Docker, Kubernetes, Git, Agile, Scrum, communication, leadership, project "
        "management, Microsoft Excel and stakeholder management. "
    )
    text = sentence * (50_000 // len(sentence) + 1)
    assert len(text) >= 50_000

    start = time.monotonic()
    mentions = taxonomy.mentions(text)
    elapsed = time.monotonic() - start

    assert mentions
    assert elapsed < 1.0, f"mentions() took {elapsed:.3f}s on ~50KB of text"


# ---------------------------------------------------------------------------
# The İ/ı crash (review item 1)
# ---------------------------------------------------------------------------


def test_mentions_boundaries_are_unicode_aware(taxonomy: Taxonomy) -> None:
    python = taxonomy.lookup("Python")
    assert python is not None
    for text in ("éPython", "Pythoné", "Pythonß", "Дpython", "_Python", "Python_"):
        assert not [m for m in taxonomy.mentions(text) if m.skill == python], text
    # Still fine next to punctuation, a version digit, or non-word characters.
    for text in ("(Python)", "Python3", "café, Python", "日本 Python"):
        assert any(m.skill == python for m in taxonomy.mentions(text)), text


def test_mentions_finds_asp_net_and_vb_net_not_just_dot_net(taxonomy: Taxonomy) -> None:
    text = "Experience with ASP.NET MVC, VB.NET and .NET Core."
    ids = [m.skill.id for m in taxonomy.mentions(text)]
    assert ids == ["asp-net", "vb-net", "dot-net"]
    asp = taxonomy.lookup("asp.net")
    assert asp is not None and asp.id == "asp-net"
    vb = taxonomy.lookup("VB.NET")
    assert vb is not None and vb.id == "vb-net"


def test_mentions_does_not_crash_on_turkish_dotted_and_dotless_i(taxonomy: Taxonomy) -> None:
    """`re.IGNORECASE` matches the pattern "i" against U+0130 (İ) and U+0131 (ı), but
    `str.casefold()` does not fold either of them to plain "i" -- so resolving a match by
    re-normalising the matched text and looking that up used to raise `KeyError`. `mentions()`
    must not crash, and must return the same, deterministic result every time."""
    for text in ("JAVASCRİPT", "JAVAScrİpt", "javascrıpt", "Lınux", "LİNUX"):
        first = taxonomy.mentions(text)
        second = taxonomy.mentions(text)
        assert first == second  # deterministic, whether it matched or not
        # This is what CPython's re engine actually does with these code points as of this
        # pull request: both fold to plain "i"/"I" for `re.IGNORECASE` purposes, so the whole
        # token matches its ASCII-spelled skill.
        assert len(first) == 1, (text, first)
        assert first[0].start == 0
        assert first[0].end == len(text)


def test_mentions_turkish_i_variants_resolve_to_the_expected_skill(taxonomy: Taxonomy) -> None:
    (mention,) = taxonomy.mentions("JAVASCRİPT")
    assert mention.skill.id == "javascript"
    (mention,) = taxonomy.mentions("Lınux")
    assert mention.skill.id == "linux-operating-system"


# ---------------------------------------------------------------------------
# Whitespace flexibility (review item 2)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "machine\nlearning",
        "machine  learning",
        "machine \n learning",
        "Microsoft\nExcel",
        "Microsoft   Excel",
    ],
)
def test_mentions_tolerates_line_breaks_and_repeated_whitespace_inside_a_term(
    taxonomy: Taxonomy, text: str
) -> None:
    mentions = taxonomy.mentions(text)
    assert mentions, text
    assert text[mentions[0].start : mentions[0].end] == text  # the whole (short) string matched


def test_mentions_offsets_still_index_the_raw_text_when_whitespace_varies(
    taxonomy: Taxonomy,
) -> None:
    text = "Skills: machine\nlearning and teamwork."
    (mention,) = [m for m in taxonomy.mentions(text) if m.skill.id == "machine-learning"]
    assert text[mention.start : mention.end] == "machine\nlearning"


# ---------------------------------------------------------------------------
# Version suffixes (review item 4)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "skill_id", "matched"),
    [
        ("HTML5", "html", "HTML5"),  # HTML5 is itself a longer, explicit alias
        ("Python3", "python-programming-language", "Python"),
        ("C++17", "c-plus-plus", "C++"),
        ("C++11", "c-plus-plus", "C++"),
        ("Java8", "java", "Java"),
        ("Angular2+", "angular", "Angular"),
        ("Vue3", "vue-js", "Vue"),
    ],
)
def test_mentions_matches_through_a_version_suffix(
    taxonomy: Taxonomy, text: str, skill_id: str, matched: str
) -> None:
    (mention,) = [m for m in taxonomy.mentions(text) if m.skill.id == skill_id]
    assert text[mention.start : mention.end] == matched


def test_mentions_still_forbids_a_following_letter(taxonomy: Taxonomy) -> None:
    # The boundary relaxation is "no letter", not "nothing at all": a version number or a "+" is
    # fine right after a term (see the version-suffix tests above), but the term must not be a
    # prefix of a longer word made of letters.
    assert not any(m.skill.id == "java" for m in taxonomy.mentions("Javaa"))
    assert not any(m.skill.id == "java" for m in taxonomy.mentions("Javanese food"))
    # A digit suffix, by contrast, is deliberately still a match -- this is the same rule.
    assert any(m.skill.id == "javascript" for m in taxonomy.mentions("JavaScript2 rules"))


# ---------------------------------------------------------------------------
# Excel: back as case-sensitive, guarded by not_followed_by (review item 6)
# ---------------------------------------------------------------------------


def test_mentions_finds_excel_as_a_requirement(taxonomy: Taxonomy) -> None:
    (mention,) = [
        m
        for m in taxonomy.mentions("Proficient in Excel (pivot tables).")
        if m.skill.id == "excel-spreadsheets"
    ]
    assert mention is not None


def test_mentions_does_not_find_excel_in_the_fast_paced_idiom(taxonomy: Taxonomy) -> None:
    assert not any(
        m.skill.id == "excel-spreadsheets"
        for m in taxonomy.mentions("Excel in a fast-paced environment.")
    )
    assert not any(
        m.skill.id == "excel-spreadsheets"
        for m in taxonomy.mentions("Ready to excel at any challenge.")
    )


# ---------------------------------------------------------------------------
# Taxonomy.version
# ---------------------------------------------------------------------------


def test_version_is_first_12_hex_characters_of_the_file_sha256(taxonomy: Taxonomy) -> None:
    digest = hashlib.sha256(DATA_PATH.read_bytes()).hexdigest()[:12]
    assert taxonomy.version == digest
    assert len(taxonomy.version) == 12
    int(taxonomy.version, 16)  # raises if not hex


def test_version_for_changes_if_the_bytes_change() -> None:
    original = DATA_PATH.read_bytes()
    changed = original + b" "  # one trailing byte is enough to change every content hash
    assert version_for(original) != version_for(changed)
    assert version_for(original) == version_for(original)


def test_version_changes_if_the_file_changes_through_the_real_loader() -> None:
    """Exercises the actual loading path -- `load_from_bytes()`, not just the hash formula --
    against two different, valid, minimal taxonomies."""
    small = _bytes_for([_minimal_entry()])
    bigger = _bytes_for(
        [_minimal_entry(), _minimal_entry(id="widget-repair", name="Widget repair")]
    )
    small_taxonomy = load_from_bytes(small)
    bigger_taxonomy = load_from_bytes(bigger)
    assert small_taxonomy.version != bigger_taxonomy.version
    assert len(small_taxonomy.skills) == 1
    assert len(bigger_taxonomy.skills) == 2
    # Loading the same bytes again gives the same version (not cached -- `load_from_bytes` isn't
    # -- but deterministic).
    assert load_from_bytes(small).version == small_taxonomy.version


# ---------------------------------------------------------------------------
# Validation (review item 7), via load_from_bytes()/load_from_path() -- never the real data file
# ---------------------------------------------------------------------------


def test_load_from_bytes_accepts_a_minimal_valid_file() -> None:
    taxonomy = load_from_bytes(_bytes_for([_minimal_entry()]))
    assert taxonomy.lookup("Widget making") is not None


def test_load_from_path_reads_a_real_file(tmp_path: Path) -> None:
    path = tmp_path / "skills.json"
    path.write_bytes(_bytes_for([_minimal_entry()]))
    taxonomy = load_from_path(path)
    assert taxonomy.lookup("Widget making") is not None


def test_load_from_path_wraps_a_missing_file_in_taxonomy_error(tmp_path: Path) -> None:
    with pytest.raises(TaxonomyError):
        load_from_path(tmp_path / "does-not-exist.json")


def test_load_from_path_wraps_a_directory_in_taxonomy_error(tmp_path: Path) -> None:
    # Reading a directory as a file raises OSError (IsADirectoryError on POSIX); this must come
    # back as TaxonomyError, not the raw OSError.
    with pytest.raises(TaxonomyError):
        load_from_path(tmp_path)


def test_load_from_bytes_wraps_invalid_json_in_taxonomy_error() -> None:
    with pytest.raises(TaxonomyError):
        load_from_bytes(b"not json at all")


def test_load_from_bytes_wraps_a_unicode_decode_error_in_taxonomy_error() -> None:
    # This is not valid UTF-8 (or UTF-16/32): json.loads() raises UnicodeDecodeError trying to
    # decode it, which must be wrapped rather than escaping as-is.
    with pytest.raises(TaxonomyError):
        load_from_bytes(b"\x80\x80\x80")


def test_load_from_bytes_rejects_an_alias_that_normalises_to_empty() -> None:
    entry = _minimal_entry(aliases=["   ", "-", "..."])
    with pytest.raises(TaxonomyError):
        load_from_bytes(_bytes_for([entry]))


def test_load_from_bytes_rejects_a_non_string_kind_with_taxonomy_error_not_type_error() -> None:
    entry = _minimal_entry(kind=123)
    with pytest.raises(TaxonomyError):
        load_from_bytes(_bytes_for([entry]))


def test_load_from_bytes_rejects_unknown_entry_keys() -> None:
    # A misspelt optional key ("case_sensitve") would otherwise silently disable its rule.
    for key in ("case_sensitve", "notes", "Aliases"):
        entry = _minimal_entry(**{key: ["x"]})
        with pytest.raises(TaxonomyError, match="unknown keys"):
            load_from_bytes(_bytes_for([entry]))


def test_load_from_bytes_rejects_a_non_kebab_case_id() -> None:
    for bad_id in ("Widget_Making", "widget making", "Widget-Making", "-widget", "widget-", ""):
        with pytest.raises(TaxonomyError):
            load_from_bytes(_bytes_for([_minimal_entry(id=bad_id)]))


def test_load_from_bytes_rejects_an_invalid_not_followed_by() -> None:
    # Not a list of plain words.
    entry = _minimal_entry(
        name="Widget", case_sensitive=["Widget"], not_followed_by=["in", "at 5pm"]
    )
    with pytest.raises(TaxonomyError):
        load_from_bytes(_bytes_for([entry]))


def test_load_from_bytes_rejects_not_followed_by_without_case_sensitive() -> None:
    entry = _minimal_entry(name="Widget", not_followed_by=["in", "at"])
    with pytest.raises(TaxonomyError):
        load_from_bytes(_bytes_for([entry]))


def test_load_from_bytes_accepts_a_valid_not_followed_by() -> None:
    entry = _minimal_entry(name="Widget", case_sensitive=["Widget"], not_followed_by=["in", "at"])
    taxonomy = load_from_bytes(_bytes_for([entry]))
    assert not any(m.skill.id == "widget-making" for m in taxonomy.mentions("Widget in a box."))
    assert any(m.skill.id == "widget-making" for m in taxonomy.mentions("A fine Widget."))
