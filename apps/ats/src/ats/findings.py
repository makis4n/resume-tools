"""The finding model shared by `ats.readiness` and the analysis response (PRD §5, §7.4, §8.3)."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Severity(StrEnum):
    """How serious a finding is, matching `packages/contracts/ats/v1/analysis.schema.json`."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class Origin(StrEnum):
    """Who can act on a finding (PRD §5, §8.3):

    - `CONTENT`: the user can fix it by changing what the resume says.
    - `LAYOUT`: it comes from the template or the tool that produced the PDF.
    """

    CONTENT = "content"
    LAYOUT = "layout"


@dataclass(frozen=True)
class Finding:
    """One readiness finding. `id` is a stable identifier: other code, tests and, once shipped,
    clients may rely on it not changing meaning."""

    id: str
    severity: Severity
    origin: Origin
    message: str
    page: int | None = None
    suggestion: str | None = None

    def to_json(self) -> dict[str, Any]:
        """The contract's `finding` shape (`packages/contracts/ats/v1/analysis.schema.json`)."""
        result: dict[str, Any] = {
            "id": self.id,
            "severity": self.severity.value,
            "origin": self.origin.value,
            "message": self.message,
        }
        if self.page is not None:
            result["page"] = self.page
        if self.suggestion is not None:
            result["suggestion"] = self.suggestion
        return result
