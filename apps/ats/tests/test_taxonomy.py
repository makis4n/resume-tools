"""Tests for the skills taxonomy (decision 0034): the data file, and `ats.taxonomy`'s loader,
normalisation, lookup and mention-finding.
"""

import importlib.resources
import json
import time
import tomllib
from pathlib import Path

import pytest

from ats.taxonomy import Mention, Skill, SkillKind, Taxonomy, load, normalise

DATA_PATH = Path(__file__).parent.parent / "src" / "ats" / "data" / "skills.json"


def _raw_entries() -> list[dict]:
    return json.loads(DATA_PATH.read_text())["entries"]


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


def test_lookup_honours_case_sensitive_go_lowercase_does_not_match(taxonomy: Taxonomy) -> None:
    assert taxonomy.lookup("Spark") is not None
    assert taxonomy.lookup("Spark").id == "apache-spark"
    assert taxonomy.lookup("spark") is None
    assert taxonomy.lookup("SPARK") is None


def test_lookup_case_sensitive_chef_vs_lowercase(taxonomy: Taxonomy) -> None:
    assert taxonomy.lookup("Chef") is not None
    assert taxonomy.lookup("chef") is None


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


def test_mentions_c_plus_plus_matches_as_a_word_but_not_inside_a_version_token(
    taxonomy: Taxonomy,
) -> None:
    assert any(m.skill.id == "c-plus-plus" for m in taxonomy.mentions("C++ developer wanted."))
    assert not any(
        m.skill.id == "c-plus-plus" for m in taxonomy.mentions("Targets C++11 and C++17.")
    )


def test_mentions_java_does_not_match_inside_javascript(taxonomy: Taxonomy) -> None:
    mentions = taxonomy.mentions("Strong JavaScript skills required.")
    ids = [m.skill.id for m in mentions]
    assert "javascript" in ids
    assert "java" not in ids


def test_mentions_no_bare_r_go_or_c_false_positives(taxonomy: Taxonomy) -> None:
    # "Go", "R" and "C" bare are intentionally not in the taxonomy at all (decision 0034): even
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
    # "Excel", "Word" and "Access" bare were dropped as too noisy (decision 0034); only the
    # "Microsoft ..." / "MS ..." aliases are in the taxonomy.
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


def test_version_is_first_12_hex_characters_of_the_file_sha256(taxonomy: Taxonomy) -> None:
    import hashlib

    digest = hashlib.sha256(DATA_PATH.read_bytes()).hexdigest()[:12]
    assert taxonomy.version == digest
    assert len(taxonomy.version) == 12
    int(taxonomy.version, 16)  # raises if not hex


def test_version_changes_if_the_file_changes() -> None:
    from ats.taxonomy import version_for

    original = DATA_PATH.read_bytes()
    changed = original + b" "  # one trailing byte is enough to change every content hash
    assert version_for(original) != version_for(changed)
    # And is stable for the same bytes.
    assert version_for(original) == version_for(original)
