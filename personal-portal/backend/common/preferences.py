"""홈 레이아웃·사용자 설정 (DESIGN.md 4.3, 7장: USER#<sub> / LAYOUT, SETTINGS)."""

import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from common.aws import table
from common.perms import Module
from common.serialize import to_plain
from common.users import now_iso, user_pk

GRID_COLS = 4
# DESIGN.md 4.3: 위젯 크기 1×1, 2×1, 2×2 (가로×세로). 아이콘은 1×1만
WIDGET_SIZES = {(1, 1), (2, 1), (2, 2)}
MAX_SECTIONS = 10
MAX_ITEMS = 100

ID_PATTERN = r"^[A-Za-z0-9_-]{1,40}$"


class LayoutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=ID_PATTERN)
    kind: Literal["icon", "widget"]
    module: Module
    widget: str | None = Field(default=None, pattern=r"^[a-z]+(\.[a-z]+)?$")
    x: int = Field(ge=0, lt=GRID_COLS)
    y: int = Field(ge=0, le=1000)
    w: int = Field(ge=1, le=2)
    h: int = Field(ge=1, le=2)
    hidden: bool = False

    @model_validator(mode="after")
    def check_shape(self) -> "LayoutItem":
        if self.x + self.w > GRID_COLS:
            raise ValueError("item overflows grid")
        if self.kind == "icon":
            if (self.w, self.h) != (1, 1):
                raise ValueError("icon must be 1x1")
        else:
            if self.widget is None:
                raise ValueError("widget type required")
            if (self.w, self.h) not in WIDGET_SIZES:
                raise ValueError("widget size must be 1x1, 2x1 or 2x2")
        return self


class Section(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=20)
    items: list[LayoutItem] = Field(max_length=MAX_ITEMS)


class Layout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    sections: list[Section] = Field(min_length=1, max_length=MAX_SECTIONS)

    @model_validator(mode="after")
    def check_ids(self) -> "Layout":
        section_ids = [s.id for s in self.sections]
        item_ids = [i.id for s in self.sections for i in s.items]
        if len(set(section_ids)) != len(section_ids) or len(set(item_ids)) != len(item_ids):
            raise ValueError("ids must be unique")
        if len(item_ids) > MAX_ITEMS:
            raise ValueError("too many items")
        return self


Goal = Annotated[int, Field(ge=0, le=20000)]


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: Literal["system", "light", "dark"] = "system"
    # 식단 목표 (DESIGN.md 6.3): 칼로리(kcal), 탄수화물·단백질·지방(g). 없으면 미설정
    goalKcal: Goal | None = None
    goalCarb: Goal | None = None
    goalProtein: Goal | None = None
    goalFat: Goal | None = None


class SettingsPatch(BaseModel):
    """보낸 필드만 바뀐다. 목표치에 null을 보내면 미설정으로 돌린다."""

    model_config = ConfigDict(extra="forbid")

    theme: Literal["system", "light", "dark"] | None = None
    goalKcal: Goal | None = None
    goalCarb: Goal | None = None
    goalProtein: Goal | None = None
    goalFat: Goal | None = None


def get_layout(sub: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": user_pk(sub), "SK": "LAYOUT"}).get("Item")
    if item is None:
        # 저장된 레이아웃이 없으면 프론트가 권한 기준 기본 레이아웃을 만든다
        return {"layout": None, "updatedAt": None}
    # 숫자(x, y, w, h)가 Decimal로 바뀌지 않게 JSON 문자열로 저장한다
    return {"layout": json.loads(item["layoutJson"]), "updatedAt": item["updatedAt"]}


def put_layout(sub: str, layout: Layout) -> dict[str, Any]:
    updated_at = now_iso()
    data = layout.model_dump(mode="json")
    table().put_item(
        Item={"PK": user_pk(sub), "SK": "LAYOUT", "layoutJson": json.dumps(data, ensure_ascii=False), "updatedAt": updated_at}
    )
    return {"layout": data, "updatedAt": updated_at}


def get_settings(sub: str) -> Settings:
    item = to_plain(table().get_item(Key={"PK": user_pk(sub), "SK": "SETTINGS"}).get("Item") or {})
    return Settings.model_validate({k: v for k, v in item.items() if k in Settings.model_fields})


def patch_settings(sub: str, patch: SettingsPatch) -> Settings:
    sent = patch.model_dump(exclude_unset=True)
    if sent.get("theme", "") is None:
        sent.pop("theme")  # 테마는 비울 수 없다
    merged = get_settings(sub).model_copy(update=sent)
    stored = {k: v for k, v in merged.model_dump().items() if v is not None}
    table().put_item(Item={"PK": user_pk(sub), "SK": "SETTINGS", **stored, "updatedAt": now_iso()})
    return merged
