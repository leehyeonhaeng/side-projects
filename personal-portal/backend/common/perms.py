"""모듈·권한 정의 (DESIGN.md 4.2, 8.2)."""

from enum import StrEnum


class Module(StrEnum):
    CALENDAR = "calendar"
    TODO = "todo"
    HEALTH = "health"
    BOARDS = "boards"
    NOTES = "notes"
    LEDGER = "ledger"
    HUB = "hub"
    CHECKLISTS = "checklists"


class Level(StrEnum):
    NONE = "none"
    VIEW = "view"
    EDIT = "edit"


class Status(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class Role(StrEnum):
    HOST = "host"
    MEMBER = "member"


_RANK = {Level.NONE: 0, Level.VIEW: 1, Level.EDIT: 2}

# /api/v1 뒤 첫 경로 세그먼트 → 모듈. 새 리소스를 추가하면 여기에 등록한다.
MODULE_BY_SEGMENT: dict[str, Module] = {
    "events": Module.CALENDAR,
    "event-series": Module.CALENDAR,
    "todos": Module.TODO,
    "todo-lists": Module.TODO,
    "meals": Module.HEALTH,
    "meal-sets": Module.HEALTH,
    "foods": Module.HEALTH,
    "weights": Module.HEALTH,
    "runs": Module.HEALTH,
    "gym": Module.HEALTH,
    "routines": Module.HEALTH,
    "programs": Module.HEALTH,
    "boards": Module.BOARDS,
    "notes": Module.NOTES,
    "txns": Module.LEDGER,
    "categories": Module.LEDGER,
    "recurring": Module.LEDGER,
    "budgets": Module.LEDGER,
    "hub": Module.HUB,
    "checklists": Module.CHECKLISTS,
}

READ_METHODS = {"GET", "HEAD"}


def allows(granted: Level, required: Level) -> bool:
    return _RANK[granted] >= _RANK[required]


def required_permission(path: str, method: str) -> tuple[Module, Level] | None:
    """요청 경로(/api/v1 제외)에 필요한 모듈 권한. 모듈에 속하지 않는 경로는 None."""
    segment = next((s for s in path.split("/") if s), "")
    if segment == "ai":
        # AI 칼로리 추정은 식단 기록의 일부
        return Module.HEALTH, Level.EDIT
    module = MODULE_BY_SEGMENT.get(segment)
    if module is None:
        return None
    if module is Module.CALENDAR:
        # 캘린더는 자기 일정만 다루므로 사용 가능/불가만 구분한다
        return module, Level.VIEW
    return module, Level.VIEW if method in READ_METHODS else Level.EDIT


def all_edit() -> dict[Module, Level]:
    return {m: Level.EDIT for m in Module}


DEFAULT_PRESETS: list[dict[str, object]] = [
    {
        "id": "family",
        "name": "가족",
        "perms": {
            Module.CALENDAR: Level.EDIT,
            Module.TODO: Level.EDIT,
            Module.HEALTH: Level.EDIT,
            Module.NOTES: Level.EDIT,
            Module.LEDGER: Level.EDIT,
            Module.HUB: Level.EDIT,
            Module.CHECKLISTS: Level.EDIT,
            Module.BOARDS: Level.NONE,
        },
    },
    {
        "id": "team",
        "name": "팀",
        "perms": {
            Module.CALENDAR: Level.EDIT,
            Module.TODO: Level.EDIT,
            Module.NOTES: Level.EDIT,
            Module.HUB: Level.EDIT,
            Module.BOARDS: Level.EDIT,
            Module.CHECKLISTS: Level.EDIT,
            Module.HEALTH: Level.NONE,
            Module.LEDGER: Level.NONE,
        },
    },
    {
        # 행컴퍼니 초대로 가입한 직원의 행포털 개인 기능 (COMPANY.md 8장). Host가 관리자 화면에서 고칠 수 있다
        "id": "staff",
        "name": "회사 직원",
        "perms": {
            Module.CALENDAR: Level.EDIT,
            Module.TODO: Level.EDIT,
            Module.NOTES: Level.EDIT,
            Module.CHECKLISTS: Level.EDIT,
            Module.HUB: Level.NONE,
            Module.BOARDS: Level.NONE,
            Module.HEALTH: Level.NONE,
            Module.LEDGER: Level.NONE,
        },
    },
]
