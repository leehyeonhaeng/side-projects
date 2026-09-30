import pytest

from common.access import identity_from_event
from common.perms import Level, Module, required_permission
from tests.conftest import http_event


@pytest.mark.parametrize(
    ("path", "method", "expected"),
    [
        ("/todos", "GET", (Module.TODO, Level.VIEW)),
        ("/todos/1", "PATCH", (Module.TODO, Level.EDIT)),
        ("/meals", "POST", (Module.HEALTH, Level.EDIT)),
        ("/events", "POST", (Module.CALENDAR, Level.VIEW)),
        ("/ai/estimate-calories", "POST", (Module.HEALTH, Level.EDIT)),
        ("/boards/abc/cards", "GET", (Module.BOARDS, Level.VIEW)),
        ("/me", "GET", None),
        ("/admin/users", "GET", None),
        ("/", "GET", None),
    ],
)
def test_required_permission(path: str, method: str, expected: tuple[Module, Level] | None) -> None:
    assert required_permission(path, method) == expected


@pytest.mark.parametrize(("raw", "groups"), [("[host]", {"host"}), ("[host member]", {"host", "member"}), ("", set())])
def test_groups_claim_parsing(raw: str, groups: set[str]) -> None:
    identity = identity_from_event(http_event("GET", "/x", sub="u1", groups=raw))
    assert identity is not None
    assert identity.groups == groups
