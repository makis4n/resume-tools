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
