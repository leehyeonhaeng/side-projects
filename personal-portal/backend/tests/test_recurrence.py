from datetime import date

import pytest

from domains.recurrence import event_occurrences, next_todo_due

D = date.fromisoformat


@pytest.mark.parametrize(
    ("due", "freq", "weekdays", "month_day", "expected"),
    [
        ("2026-10-01", "daily", None, None, "2026-10-02"),
        ("2026-10-02", "weekdays", None, None, "2026-10-05"),  # 금 → 월
        ("2026-10-03", "weekdays", None, None, "2026-10-05"),  # 토 → 월
        ("2026-10-01", "weekly", [1, 4], None, "2026-10-05"),  # 목(4) → 다음 월(1)
        ("2026-10-05", "weekly", [1, 4], None, "2026-10-08"),  # 월 → 목
        ("2026-10-01", "weekly", None, None, "2026-10-08"),  # 요일 없으면 같은 요일
        ("2026-01-31", "monthly", None, 31, "2026-02-28"),  # 짧은 달은 말일로
        ("2026-02-28", "monthly", None, 31, "2026-03-31"),  # 다음 달엔 원래 날짜로 복귀
        ("2026-12-15", "monthly", None, 15, "2027-01-15"),  # 연도 넘김
    ],
)
def test_next_todo_due(due: str, freq: str, weekdays: list[int] | None, month_day: int | None, expected: str) -> None:
    assert next_todo_due(D(due), freq, weekdays, month_day) == D(expected)


def occ(start: str, freq: str, frm: str, to: str, until: str | None = None) -> list[str]:
    return [d.isoformat() for d in event_occurrences(D(start), freq, D(until) if until else None, D(frm), D(to))]


def test_daily_within_range() -> None:
    assert occ("2026-10-01", "daily", "2026-10-03", "2026-10-05") == ["2026-10-03", "2026-10-04", "2026-10-05"]


def test_daily_respects_until() -> None:
    assert occ("2026-10-01", "daily", "2026-10-01", "2026-10-31", until="2026-10-02") == ["2026-10-01", "2026-10-02"]


def test_nothing_before_start() -> None:
    assert occ("2026-10-10", "daily", "2026-10-01", "2026-10-11") == ["2026-10-10", "2026-10-11"]
    assert occ("2026-12-01", "weekly", "2026-10-01", "2026-10-31") == []


def test_weekly_aligns_to_start_weekday() -> None:
    # 2026-10-01은 목요일
    assert occ("2026-10-01", "weekly", "2026-10-02", "2026-10-31") == ["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]


def test_monthly_skips_missing_days() -> None:
    assert occ("2026-01-31", "monthly", "2026-01-01", "2026-05-31") == ["2026-01-31", "2026-03-31", "2026-05-31"]


def test_monthly_starts_scan_near_range() -> None:
    assert occ("2020-03-15", "monthly", "2026-10-01", "2026-11-30") == ["2026-10-15", "2026-11-15"]


def test_yearly_leap_day() -> None:
    assert occ("2024-02-29", "yearly", "2024-01-01", "2028-12-31") == ["2024-02-29", "2028-02-29"]
