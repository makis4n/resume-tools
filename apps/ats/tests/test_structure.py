import dataclasses

import pytest

from ats.structure import StructureFacts, detect


def test_a_valid_email() -> None:
    facts = detect("ada.inventa@example.com")
    assert facts.has_email and not facts.has_email_candidate


@pytest.mark.parametrize("text", ["ada@inventa", "ada @ example.com", "ada[at]example.com"])
def test_an_unreadable_email_attempt_is_a_candidate(text: str) -> None:
    facts = detect(text)
    assert not facts.has_email and facts.has_email_candidate


@pytest.mark.parametrize("text", ["@adainventa", "Python @ scale"])
def test_a_handle_or_an_at_sign_is_not_an_email_candidate(text: str) -> None:
    facts = detect(text)
    assert not facts.has_email and not facts.has_email_candidate


@pytest.mark.parametrize(
    "text", ["+1 555 010 0199", "(555) 010-0199", "+65 9123 4567", "Phone: 91234567"]
)
def test_phone_numbers(text: str) -> None:
    assert detect(text).has_phone


@pytest.mark.parametrize(
    "text", ["2019 - 2023", "2019-2023", "2023.01.15", "GPA 3.85/4.00", "12345678"]
)
def test_not_phone_numbers(text: str) -> None:
    assert not detect(text).has_phone


@pytest.mark.parametrize(
    "text",
    [
        "linkedin.com/in/ada-inventa",
        "https://ada.example",
        "www.example.org",
        "github.com/ada-inventa-example",
        "LinkedIn.com/in/Ada",
    ],
)
def test_profile_links(text: str) -> None:
    assert detect(text).has_profile_link


def test_an_emails_domain_is_not_a_profile_link() -> None:
    assert not detect("ada@example.com").has_profile_link
    assert not detect("ada@mail.example.com").has_profile_link


@pytest.mark.parametrize(
    "heading",
    ["Work Experience", "PROFESSIONAL EXPERIENCE:", "E X P E R I E N C E", "Employment History"],
)
def test_experience_headings(heading: str) -> None:
    assert detect(f"Ada\n{heading}\nstuff").has_experience


@pytest.mark.parametrize("heading", ["Education", "Academic Background"])
def test_education_headings(heading: str) -> None:
    assert detect(f"{heading}\nstuff").has_education


@pytest.mark.parametrize(
    "heading", ["Technical Skills", "Core Competencies", "Tools & Technologies"]
)
def test_skills_headings(heading: str) -> None:
    assert detect(f"{heading}\nstuff").has_skills


def test_a_long_sentence_is_not_a_heading() -> None:
    facts = detect(
        "I have a lot of experience building things and many useful skills for this role\n"
        "My education was long and my work history is varied and I enjoy it a lot"
    )
    assert not (facts.has_experience or facts.has_education or facts.has_skills)


def test_facts_carry_only_booleans() -> None:
    assert all(field.type is bool for field in dataclasses.fields(StructureFacts))


@pytest.mark.parametrize(
    "text",
    [
        "Engineer, Example Co. 2019.01 - 2023.06",
        "Software Engineer 2019-01 - 2023-06",
        "Engineer 09.2019 - 06.2023",
        "09 2019 - 06 2023",
        "Scaled to 10 000 000 users",
        "Singapore 123456 2019",
        "ISBN 978-3-16-148410-0",
    ],
)
def test_dates_and_large_numbers_are_not_phone_numbers(text: str) -> None:
    assert not detect(text).has_phone


def test_a_phone_ending_in_a_year_like_group_is_still_a_phone() -> None:
    assert detect("(555) 010-2019").has_phone


@pytest.mark.parametrize(
    "text",
    [
        "Skills\nC#, ASP.NET, ADO.NET, SQL Server",
        "Built a chat app with Socket.IO",
        "Software Engineer, Booking.com",
        "ada @ example.com",
    ],
)
def test_technology_names_and_broken_emails_are_not_profile_links(text: str) -> None:
    assert not detect(text).has_profile_link


def test_a_lowercase_bare_domain_is_a_profile_link() -> None:
    assert detect("ada-inventa.dev").has_profile_link


@pytest.mark.parametrize("text", ["Intern @ Grab.com", "Software Engineer @ Shopee.sg"])
def test_a_job_title_with_an_at_sign_is_not_an_email_candidate(text: str) -> None:
    assert not detect(text).has_email_candidate


@pytest.mark.parametrize(
    "text",
    [
        "Summary\nSeasoned engineer who builds reliable systems and mentors teams with\n"
        "years of industry experience.\nProjects",
        "Redesigned onboarding flow, improving customer\nexperience.",
        "improving customer experience",
        "User Experience Designer",
        "5 years of experience",
        "Led education outreach",
        "to sharpen their\nanalysis skills.",
    ],
)
def test_wrapped_prose_and_job_titles_are_not_headings(text: str) -> None:
    facts = detect(text)
    assert not (facts.has_experience or facts.has_education or facts.has_skills)


def test_a_heading_beside_another_columns_text_is_found() -> None:
    facts = detect("Experience Python, Java, Go, Rust, Kotlin, TypeScript, SQL")
    assert facts.has_experience


@pytest.mark.parametrize(
    "text",
    [
        "Ada\nWork Experiences\nstuff",
        "EXPERIENCES",
        "Educational Background\nx",
        "Skillset\nx",
        "Skills & Interests\nx",
        "Professional Experience (Selected)\nx",
        "01 Experience",
        "01. Experience",
        "Experience Senior Engineer, Acme",
        "Experience Acme Corp",
        "Contact Experience",
        "Ada Inventa Experience",
        "Languages Skills",
        "Skills | Experience",
    ],
)
def test_plural_numbered_and_shared_line_headings_are_found(text: str) -> None:
    facts = detect(text)
    assert facts.has_experience or facts.has_education or facts.has_skills


def test_each_heading_on_a_shared_line_is_found() -> None:
    assert detect("Contact Experience").has_experience
    assert detect("Languages Education").has_education
    assert detect("Skills: Python, Java, SQL").has_skills
    assert detect("Profile Education").has_education


@pytest.mark.parametrize(
    "text",
    [
        "Education Coordinator, Invented School, 2019 - 2021",
        "Experience Designer, Invented Co, 2019 - 2021",
    ],
)
def test_a_dated_job_line_starting_with_a_keyword_is_not_a_heading(text: str) -> None:
    facts = detect(text)
    assert not (facts.has_experience or facts.has_education)


@pytest.mark.parametrize("text", ["07911 123456", "07700 900 123", "07700 900123", "98765 43210"])
def test_national_phone_formats_without_a_prefix(text: str) -> None:
    assert detect(text).has_phone


def test_an_at_word_emails_domain_is_not_a_profile_link() -> None:
    facts = detect("ada[at]inventa.dev")
    assert facts.has_email_candidate
    assert not facts.has_profile_link


def test_a_huge_line_is_rejected_quickly() -> None:
    import time

    start = time.perf_counter()
    facts = detect("x" + "-" * 96_000 + "x\n" + "x" + " " * 96_000 + "x")
    assert time.perf_counter() - start < 2
    assert not facts.has_experience


@pytest.mark.parametrize(
    "line",
    [
        "+65 9123 4567 EXPERIENCE",
        "ada@example.com EXPERIENCE",
        "linkedin.com/in/ada EXPERIENCE",
        "Singapore 123456 EXPERIENCE",
        "Experience +1 555 010 0199",
    ],
)
def test_a_heading_beside_contact_text_is_found(line: str) -> None:
    assert detect(line).has_experience


@pytest.mark.parametrize(
    "line", ["Work Authorization: US Citizen", "Work Permit Holder", "Tools Used: Python"]
)
def test_ordinary_lines_opening_with_work_or_tools_are_not_headings(line: str) -> None:
    facts = detect(line)
    assert not facts.has_experience
    assert not facts.has_skills


@pytest.mark.parametrize(
    "heading",
    [
        "WO R K E X PERIENCE",
        "E XPERIENCE",
        "EX PERIENCE",
        "W O R K  E X P E R I E N C E",
        "W O R K E X P E R I E N C E",
    ],
)
def test_irregular_and_multi_word_letter_spacing_is_collapsed(heading: str) -> None:
    assert detect(f"Jane\n{heading}\nbody").has_experience


@pytest.mark.parametrize(
    ("heading", "field"),
    [
        ("EDUCATI ON", "has_education"),
        ("S K ILLS", "has_skills"),
        ("T E C H N I C A L S K I L L S", "has_skills"),
    ],
)
def test_letter_spaced_education_and_skills(heading: str, field: str) -> None:
    assert getattr(detect(f"Jane\n{heading}\nbody"), field)


@pytest.mark.parametrize(
    ("text", "field"),
    [
        ("Work Experience and Internships", "has_experience"),
        ("Experience and Internships", "has_experience"),
        ("Education and Honors", "has_education"),
        ("Education and Coursework", "has_education"),
        ("Skills and Abilities", "has_skills"),
        ("Skills and Technologies", "has_skills"),
        ("Summary of Skills", "has_skills"),
    ],
)
def test_headings_joined_with_and_are_found(text: str, field: str) -> None:
    assert getattr(detect(f"Jane\n{text}\nx"), field)


def test_and_headings_do_not_admit_job_titles_or_ordinary_lines() -> None:
    assert not detect("Jane\nCustomer Experience and Design\nx").has_experience
    assert not detect("Jane\nWork and Life Balance\nx").has_experience


@pytest.mark.parametrize("text", ["ada.example.net", "ada.de", "ada.ca", "ada.edu"])
def test_more_bare_domains_are_profile_links(text: str) -> None:
    assert detect(text).has_profile_link


@pytest.mark.parametrize("text", ["Built with node.js", "asp.net", "uses next.js and vue.js"])
def test_file_extension_like_names_are_not_profile_links(text: str) -> None:
    assert not detect(text).has_profile_link


@pytest.mark.parametrize(
    "text", ["Boston, MA 02115 617-555-0142", "New York, NY 10001 (555) 123-4567"]
)
def test_a_phone_after_a_zip_code_is_found(text: str) -> None:
    assert detect(text).has_phone


@pytest.mark.parametrize(
    "line", ["Experience/Projects", "Education/Training", "Skills/Tools", "Experience/Education"]
)
def test_a_heading_joined_by_a_slash_is_found(line: str) -> None:
    facts = detect(line)
    assert facts.has_experience or facts.has_education or facts.has_skills


def test_slash_joined_headings_find_each_side() -> None:
    assert detect("Education/Training").has_education
    assert detect("Skills/Tools").has_skills
    assert detect("Experience/Projects").has_experience


@pytest.mark.parametrize(
    "line",
    ["EXPERIENCE ada@example.com", "Experience www.example.org", "Experience https://x.example"],
)
def test_a_heading_before_lowercase_contact_text_is_found(line: str) -> None:
    assert detect(line).has_experience
