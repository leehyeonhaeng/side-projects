"""반복 규칙 계산 (할 일 다음 회차, 반복 일정 펼치기). 날짜는 모두 한국 시간 기준 달력 날짜."""

import calendar
from collections.abc import Iterator
from datetime import date, timedelta


def add_months(d: date, months: int, day: int) -> date | None:
    """d에서 months개월 뒤의 day일. 그 달에 그 날이 없으면 None (예: 31일)."""
    total = d.year * 12 + d.month - 1 + months
    year, month = divmod(total, 12)
    month += 1
    if day > calendar.monthrange(year, month)[1]:
        return None
    return date(year, month, day)


def clamp_month_day(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


# ── 할 일 반복 (DESIGN.md 6.2: 매일·매주 요일 선택·매월·평일) ─────────

def next_todo_due(due: date, freq: str, weekdays: list[int] | None = None, month_day: int | None = None) -> date:
    """완료한 회차의 마감일 다음 회차. weekdays는 ISO 요일(월=1 … 일=7)."""
    if freq == "daily":
        return due + timedelta(days=1)
    if freq == "weekdays":
        d = due + timedelta(days=1)
        while d.isoweekday() > 5:
            d += timedelta(days=1)
        return d
    if freq == "weekly":
        days = set(weekdays or [due.isoweekday()])
        d = due + timedelta(days=1)
        while d.isoweekday() not in days:
            d += timedelta(days=1)
        return d
    if freq == "monthly":
        # 31일 같은 날은 짧은 달에서 말일로 당기되, 다음 달에는 원래 날짜로 돌아간다
        day = month_day or due.day
        total = due.year * 12 + due.month
        year, month = divmod(total, 12)
        return clamp_month_day(year, month + 1, day)
    raise ValueError(f"unknown freq: {freq}")


# ── 일정 반복 (DESIGN.md 6.1: 매일·매주·매월·매년) ─────────

def event_occurrences(start: date, freq: str, until: date | None, frm: date, to: date) -> Iterator[date]:
    """start에서 시작하는 반복 일정 중 [frm, to]에 시작일이 들어가는 회차.

    매월·매년은 그 날짜가 없는 달·해(31일, 2월 29일)를 건너뛴다 (일정은 당기지 않음).
    """
    last = min(until, to) if until else to
    if last < start or last < frm:
        return
    if freq == "daily":
        d = max(start, frm)
        while d <= last:
            yield d
            d += timedelta(days=1)
    elif freq == "weekly":
        d = start
        if frm > start:
            d = start + timedelta(days=-(-(frm - start).days // 7) * 7)
        while d <= last:
            yield d
            d += timedelta(days=7)
    elif freq == "monthly":
        # frm 직전 달부터 훑는다 (처음부터 돌지 않게)
        k = max(0, (frm.year - start.year) * 12 + (frm.month - start.month) - 1)
        while True:
            first_of_month = add_months(start, k, 1)
            if first_of_month is None or first_of_month > last:
                return
            d = add_months(start, k, start.day)
            k += 1
            if d is not None and frm <= d <= last:
                yield d
    elif freq == "yearly":
        for year in range(max(start.year, frm.year), last.year + 1):
            if start.month == 2 and start.day == 29 and not calendar.isleap(year):
                continue
            d = date(year, start.month, start.day)
            if frm <= d <= last and d >= start:
                yield d
    else:
        raise ValueError(f"unknown freq: {freq}")
