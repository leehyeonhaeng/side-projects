"""행컴퍼니 문서 PDF 그리기 (COMPANY.md 7장, C5). AWS와 무관하게 스냅샷(dict) → PDF 바이트.

글꼴: Pretendard (SIL OFL, fonts/). Lambda에서는 문서 레이어의 /opt/fonts, 로컬·테스트는 backend/fonts
직인: 회사가 올린 이미지가 있으면 그 이미지, 없으면 회사 이름으로 그린 원형 예시 직인
취소된 문서는 같은 스냅샷으로 다시 그리면서 "취소됨" 워터마크를 넣는다
"""

import io
import math
from pathlib import Path
from typing import Any

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

_LAYER_FONTS = Path("/opt/fonts")
FONT_DIR = _LAYER_FONTS if _LAYER_FONTS.exists() else Path(__file__).resolve().parents[1] / "fonts"
R, B = "Pre", "PreB"
SEAL_RED = colors.Color(0.82, 0.12, 0.12)
LINE = colors.Color(0.55, 0.55, 0.55)
SHADE = colors.Color(0.95, 0.95, 0.95)
_ready = False


def _fonts() -> None:
    global _ready
    if not _ready:
        pdfmetrics.registerFont(TTFont(R, str(FONT_DIR / "Pretendard-Regular.ttf")))
        pdfmetrics.registerFont(TTFont(B, str(FONT_DIR / "Pretendard-Bold.ttf")))
        _ready = True


def won(n: Any) -> str:
    return f"{int(round(float(n or 0))):,}"


def qty(n: Any) -> str:
    v = float(n or 0)
    return f"{int(v):,}" if v == int(v) else f"{v:,.2f}".rstrip("0").rstrip(".")


_DIGITS = "영일이삼사오육칠팔구"
_SMALL = ["", "십", "백", "천"]
_BIG = ["", "만", "억", "조"]


def korean_amount(n: int) -> str:
    """1200000 → 일백이십만 (영수증 '금 ○○원정')"""
    if n == 0:
        return "영"
    out = []
    for gi in range(len(_BIG)):
        group = (n // 10 ** (4 * gi)) % 10000
        if group == 0:
            continue
        s = ""
        for i in range(3, -1, -1):
            d = (group // 10**i) % 10
            if d:
                s += _DIGITS[d] + _SMALL[i]
        out.append(s + _BIG[gi])
    return "".join(reversed(out))


def _style(size: float = 9, bold: bool = False, align: int = 0, color: Any = colors.black, leading: float | None = None) -> ParagraphStyle:
    _fonts()
    return ParagraphStyle("s", fontName=B if bold else R, fontSize=size, leading=leading or size * 1.35, alignment=align, textColor=color, wordWrap="CJK")


def _p(text: Any, size: float = 9, bold: bool = False, align: int = 0, color: Any = colors.black) -> Paragraph:
    esc = str(text if text is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    return Paragraph(esc, _style(size, bold, align, color))


# ── 직인 ─────────────────────────────────────────────

def draw_seal(c: Canvas, cx: float, cy: float, r: float, company: str, image: bytes | None) -> None:
    """(cx, cy) 중심, 반지름 r. 올린 이미지가 있으면 그 이미지, 없으면 예시 직인"""
    if image:
        c.drawImage(ImageReader(io.BytesIO(image)), cx - r, cy - r, 2 * r, 2 * r, mask="auto", preserveAspectRatio=True, anchor="c")
        return
    c.saveState()
    c.setStrokeColor(SEAL_RED)
    c.setFillColor(SEAL_RED)
    c.setLineWidth(r * 0.07)
    c.circle(cx, cy, r, stroke=1, fill=0)
    c.setLineWidth(r * 0.03)
    c.circle(cx, cy, r * 0.56, stroke=1, fill=0)
    # 바깥 고리에 회사 이름: 위쪽 가운데를 중심으로 글자마다 같은 각도 (공백은 반 칸)
    name = (company or "회사")[:12]
    size = r * 0.34
    c.setFont(B, size)
    weights = [0.5 if ch == " " else 1.0 for ch in name]
    step = min(300.0 / max(sum(weights), 1), 38.0)
    angle = 90 + step * (sum(weights) - weights[0]) / 2
    for ch, wt in zip(name, weights, strict=True):
        a = math.radians(angle)
        if ch != " ":
            c.saveState()
            c.translate(cx + math.cos(a) * r * 0.77, cy + math.sin(a) * r * 0.77)
            c.rotate(angle - 90)
            c.drawCentredString(0, -size * 0.35, ch)
            c.restoreState()
        angle -= step * wt
    # 가운데 "대표 / 이사" 두 줄
    inner = r * 0.36
    c.setFont(B, inner * 0.62)
    c.drawCentredString(cx, cy + inner * 0.08, "대표")
    c.drawCentredString(cx, cy - inner * 0.62, "인")
    c.restoreState()


class NameWithSeal(Flowable):
    """'홍길동 (인)' + 그 위에 겹쳐 찍힌 직인"""

    def __init__(self, name: str, company: str, seal: bytes | None, size: float = 9) -> None:
        super().__init__()
        self.name, self.company, self.seal, self.size = name or "", company, seal, size

    def wrap(self, aw: float, ah: float) -> tuple[float, float]:
        return aw, self.size * 1.4

    def draw(self) -> None:
        c = self.canv
        c.setFont(R, self.size)
        text = f"{self.name}  (인)"
        c.drawString(0, self.size * 0.3, text)
        w = pdfmetrics.stringWidth(text, R, self.size)
        draw_seal(c, w - self.size * 0.7, self.size * 0.65, 8.5 * mm, self.company, self.seal)


# ── 공통 틀 ──────────────────────────────────────────

def _page_deco(title: str, no: str, canceled: bool, footer: str) -> Any:
    def deco(c: Canvas, doc: Any) -> None:
        c.saveState()
        c.setFont(R, 7.5)
        c.setFillColor(colors.grey)
        c.drawString(15 * mm, 9 * mm, footer)
        c.drawRightString(A4[0] - 15 * mm, 9 * mm, f"{no}  ·  {doc.page} 페이지" if no else f"{doc.page} 페이지")
        if canceled:
            c.setFillColor(colors.Color(0.85, 0.1, 0.1, alpha=0.22))
            c.translate(A4[0] / 2, A4[1] / 2)
            c.rotate(32)
            c.setFont(B, 110)
            c.drawCentredString(0, 0, "취소됨")
        c.restoreState()

    return deco


def _build(story: list[Any], title: str, no: str, canceled: bool, footer: str) -> bytes:
    _fonts()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm, bottomMargin=16 * mm, title=f"{title} {no}".strip(), author=footer)
    deco = _page_deco(title, no, canceled, footer)
    doc.build(story, onFirstPage=deco, onLaterPages=deco)
    return buf.getvalue()


def _title(title: str, no: str, day: str) -> Table:
    t = Table([[_p(title, 22, True), _p(f"No. {no}" if no else "", 9, align=TA_RIGHT)], ["", _p(day, 9, align=TA_RIGHT)]], colWidths=[120 * mm, 60 * mm])
    t.setStyle(TableStyle([("SPAN", (0, 0), (0, 1)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 1), (-1, 1), 1.2, colors.black), ("BOTTOMPADDING", (0, 1), (-1, 1), 6)]))
    return t


def _box(label: str, rows: list[tuple[str, Any]], width: float) -> Table:
    data = [[_p(label, 8.5, True, TA_CENTER), ""]] + [[_p(k, 8, color=colors.Color(0.3, 0.3, 0.3)), v if isinstance(v, Flowable) else _p(v, 9)] for k, v in rows]
    t = Table(data, colWidths=[18 * mm, width - 18 * mm])
    t.setStyle(
        TableStyle([
            ("SPAN", (0, 0), (1, 0)),
            ("BACKGROUND", (0, 0), (1, 0), SHADE),
            ("BACKGROUND", (0, 1), (0, -1), SHADE),
            ("GRID", (0, 0), (-1, -1), 0.5, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ])
    )
    return t


def _parties(s: dict[str, Any], seal: bytes | None, buyer_label: str = "공급받는 자") -> Table:
    co, pa = s["company"], s["partner"]
    half = 88 * mm
    buyer = _box(buyer_label, [("상호", f"{pa.get('name', '')}  귀하"), ("사업자번호", pa.get("bizNo", "")), ("대표", pa.get("ceo", "")), ("주소", pa.get("address", "")), ("전화", pa.get("phone", ""))], half)
    seller = _box(
        "공급자",
        [
            ("상호", co.get("name", "")),
            ("사업자번호", co.get("bizNo", "")),
            ("대표", NameWithSeal(co.get("ceo", ""), co.get("name", ""), seal)),
            ("주소", co.get("address", "")),
            ("업태·종목", " / ".join(x for x in (co.get("bizType", ""), co.get("bizItem", "")) if x)),
            ("전화", " · ".join(x for x in (co.get("phone", ""), f"팩스 {co['fax']}" if co.get("fax") else "") if x)),
        ],
        half,
    )
    t = Table([[buyer, seller]], colWidths=[half + 4 * mm, half])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t


def _grid(data: list[list[Any]], widths: list[float], right_cols: tuple[int, ...] = (), head_rows: int = 1, extra: list[tuple[Any, ...]] | None = None) -> Table:
    t = Table(data, colWidths=widths, repeatRows=head_rows)
    style = [
        ("FONTNAME", (0, 0), (-1, -1), R),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    style += [("ALIGN", (c, 0), (c, -1), "RIGHT") for c in right_cols]
    if head_rows:
        style.append(("BACKGROUND", (0, 0), (-1, head_rows - 1), SHADE))
    t.setStyle(TableStyle(style + (extra or [])))
    return t


def _bank(s: dict[str, Any]) -> list[Any]:
    acc = s["company"].get("bankAccount")
    return [Spacer(1, 4 * mm), _p(f"입금 계좌: {acc}", 9.5, True)] if acc else []


def _footer(s: dict[str, Any]) -> str:
    return f"{s['company'].get('name', '')} · 발행 {s.get('issuedAt', '')[:16].replace('T', ' ')}"


def _line_rows(lines: list[dict[str, Any]], with_money: bool = True) -> list[list[Any]]:
    rows = []
    for i, ln in enumerate(lines, start=1):
        name = ln.get("name", "") + (f"\n{ln['memo']}" if ln.get("memo") else "")
        q = f"{qty(ln.get('qty'))}{ln.get('unit', '')}"
        if with_money:
            rows.append([_p(i, 8.5, align=TA_CENTER), _p(name, 8.5), q, won(ln.get("unitPrice")), won(ln.get("supply")), won(ln.get("vat"))])
        else:
            rows.append([_p(i, 8.5, align=TA_CENTER), _p(name, 8.5), q])
    return rows


# ── 문서별 ───────────────────────────────────────────

def statement(s: dict[str, Any], seal: bytes | None, canceled: bool = False) -> bytes:
    """거래명세서: 판매·청구·임대 출고/수거·A/S 거래 한 건"""
    t = s["txn"]
    story: list[Any] = [_title("거래명세서", s["no"], t["date"]), Spacer(1, 4 * mm), _parties(s, seal), Spacer(1, 5 * mm)]
    total = int(t.get("total") or 0)
    story.append(_grid([[_p("합계 금액", 10, True), _p(f"₩ {won(total)}  (공급가액 {won(t.get('supply'))} + 세액 {won(t.get('vat'))})", 11, True)]], [32 * mm, 148 * mm], extra=[("BACKGROUND", (0, 0), (0, 0), SHADE)]))
    story.append(Spacer(1, 3 * mm))
    head = ["번호", "품목·내용", "수량", "단가", "공급가액", "세액"]
    rows = _line_rows(t.get("lines", []))
    rows.append(["", _p("합계", 9, True), "", "", won(t.get("supply")), won(t.get("vat"))])
    story.append(_grid([head, *rows], [11 * mm, 77 * mm, 18 * mm, 24 * mm, 27 * mm, 23 * mm], right_cols=(2, 3, 4, 5), extra=[("BACKGROUND", (0, len(rows)), (-1, len(rows)), SHADE)]))
    info = []
    if t.get("assetCodes"):
        info.append(f"기기: {', '.join(t['assetCodes'])}")
    if t.get("contractNo"):
        info.append(f"계약: {t['contractNo']}" + (f" ({int(t['billMonth'][5:7])}월분)" if t.get("billMonth") else ""))
    info.append(f"거래 번호: {t.get('no', '')}")
    if t.get("memo"):
        info.append(f"메모: {t['memo']}")
    story += [Spacer(1, 3 * mm), _p(" · ".join(info), 8.5, color=colors.Color(0.3, 0.3, 0.3))]
    story += _bank(s)
    story += [Spacer(1, 6 * mm), _p("위와 같이 거래합니다.", 10, align=TA_CENTER)]
    return _build(story, "거래명세서", s["no"], canceled, _footer(s))


def receipt(s: dict[str, Any], seal: bytes | None, canceled: bool = False) -> bytes:
    """영수증: 입금 한 건"""
    t = s["txn"]
    amount = int(t.get("amount") or 0)
    story: list[Any] = [_title("영 수 증", s["no"], t["date"]), Spacer(1, 6 * mm)]
    story.append(_p(f"{s['partner'].get('name', '')}  귀하", 14, True))
    story.append(Spacer(1, 5 * mm))
    story.append(_grid([[_p("금 액", 11, True, TA_CENTER), _p(f"금 {korean_amount(amount)}원정   (₩ {won(amount)})", 13, True)]], [30 * mm, 150 * mm], extra=[("BACKGROUND", (0, 0), (0, 0), SHADE), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.append(Spacer(1, 4 * mm))
    rows = [["받은 날", t["date"]], ["받은 방법", t.get("accountName", "")]]
    allocs = t.get("allocations", [])
    if allocs:
        rows.append(["내역", _p("\n".join(f"{a.get('no', '')} ({a.get('date', '')})  {won(a.get('amount'))}원" for a in allocs), 9)])
    if int(t.get("unallocated") or 0) > 0:
        rows.append(["선수금", f"{won(t['unallocated'])}원 (다음 청구에서 차감)"])
    if t.get("memo"):
        rows.append(["메모", _p(t["memo"], 9)])
    story.append(_grid([[_p(k, 9, color=colors.Color(0.3, 0.3, 0.3)), v if isinstance(v, Flowable) else _p(v, 9)] for k, v in rows], [30 * mm, 150 * mm], head_rows=0, extra=[("BACKGROUND", (0, 0), (0, -1), SHADE)]))
    story += [Spacer(1, 10 * mm), _p("위 금액을 정히 영수합니다.", 12, align=TA_CENTER), Spacer(1, 3 * mm), _p(t["date"], 10, align=TA_CENTER), Spacer(1, 8 * mm)]
    co = s["company"]
    sign = Table(
        [[_p("상호", 9), _p(co.get("name", ""), 10, True)], [_p("사업자번호", 9), _p(co.get("bizNo", ""), 9)], [_p("주소", 9), _p(co.get("address", ""), 9)], [_p("대표", 9), NameWithSeal(co.get("ceo", ""), co.get("name", ""), seal, 10)]],
        colWidths=[22 * mm, 70 * mm],
        hAlign="RIGHT",
    )
    sign.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3)]))
    story.append(sign)
    return _build(story, "영수증", s["no"], canceled, _footer(s))


def invoice(s: dict[str, Any], seal: bytes | None, canceled: bool = False) -> bytes:
    """청구서: 고른 청구 건들 (+ 이전 미수, 카운터, 입금 계좌는 선택)"""
    opt = s.get("options", {})
    story: list[Any] = [_title("청 구 서", s["no"], s["date"]), Spacer(1, 4 * mm), _parties(s, seal, "받는 분"), Spacer(1, 5 * mm)]
    head = ["날짜", "내용", "수량", "단가", "합계"]
    rows: list[list[Any]] = []
    shade_rows = []
    for it in s["items"]:
        shade_rows.append(len(rows) + 1)
        rows.append([it["date"], _p(f"{it.get('summary', '')}  ({it.get('no', '')})", 9, True), "", "", won(it.get("total"))])
        for ln in it.get("lines", []):
            rows.append(["", _p(f"· {ln.get('name', '')}" + (f"  — {ln['memo']}" if ln.get("memo") else ""), 8.5), f"{qty(ln.get('qty'))}{ln.get('unit', '')}", won(ln.get("unitPrice")), won(ln.get("total"))])
        if opt.get("counters"):
            for k in it.get("counters", []):
                color = f" / 컬러 {won(k['fromColor'])} → {won(k['toColor'])}" if k.get("toColor") else ""
                rows.append(["", _p(f"   검침 {k.get('code', '')}: 흑백 {won(k['fromMono'])} → {won(k['toMono'])}{color} ({k.get('readAt', '')})", 8, color=colors.Color(0.35, 0.35, 0.35)), "", "", ""])
        if int(it.get("paid") or 0) > 0:
            rows.append(["", _p("   받은 금액", 8.5, color=colors.Color(0.35, 0.35, 0.35)), "", "", f"−{won(it['paid'])}"])
    story.append(_grid([head, *rows], [22 * mm, 92 * mm, 18 * mm, 22 * mm, 26 * mm], right_cols=(2, 3, 4), extra=[("BACKGROUND", (0, r), (-1, r), colors.Color(0.98, 0.98, 0.98)) for r in shade_rows]))
    story.append(Spacer(1, 4 * mm))
    tot = s["totals"]
    summary = [["이번 청구 합계", f"{won(tot['charged'])}원"]]
    if tot.get("paid"):
        summary.append(["받은 금액", f"−{won(tot['paid'])}원"])
    if opt.get("previous"):
        summary.append(["이전 미수", f"{won(tot.get('previous', 0))}원"])
    summary.append(["받을 금액", f"{won(tot['due'])}원"])
    sm = _grid([[_p(k, 9.5, k == "받을 금액"), _p(v, 10.5 if k == "받을 금액" else 9.5, k == "받을 금액", TA_RIGHT)] for k, v in summary], [40 * mm, 45 * mm], head_rows=0, extra=[("BACKGROUND", (0, 0), (0, -1), SHADE), ("LINEABOVE", (0, -1), (-1, -1), 1.2, colors.black)])
    sm.hAlign = "RIGHT"
    story.append(sm)
    if opt.get("bank"):
        story += _bank(s)
    if s.get("memo"):
        story += [Spacer(1, 3 * mm), _p(s["memo"], 9)]
    story += [Spacer(1, 6 * mm), _p("위와 같이 청구합니다.", 10, align=TA_CENTER)]
    return _build(story, "청구서", s["no"], canceled, _footer(s))


def work(s: dict[str, Any], seal: bytes | None, canceled: bool = False) -> bytes:
    """작업 확인서: 완료한 A/S (금액은 넣지 않음)"""
    sv = s["service"]
    story: list[Any] = [_title("작업 확인서", s["no"], sv.get("doneDate", "")), Spacer(1, 4 * mm), _parties(s, seal, "고객"), Spacer(1, 5 * mm)]
    rows = [
        ["A/S 번호", sv.get("no", "")],
        ["기기", " ".join(x for x in (sv.get("assetCode", ""), sv.get("itemName", "")) if x) or "—"],
        ["접수일", sv.get("date", "")],
        ["증상", _p(sv.get("symptom", ""), 9)],
        ["완료일", sv.get("doneDate", "")],
        ["조치 내용", _p(sv.get("action", ""), 9)],
        ["담당 기사", sv.get("technician", "")],
    ]
    story.append(_grid([[_p(k, 9, color=colors.Color(0.3, 0.3, 0.3)), v if isinstance(v, Flowable) else _p(v, 9)] for k, v in rows], [30 * mm, 150 * mm], head_rows=0, extra=[("BACKGROUND", (0, 0), (0, -1), SHADE)]))
    parts = s.get("parts", [])
    if parts:
        story += [Spacer(1, 4 * mm), _p("사용 부품", 10, True), Spacer(1, 2 * mm)]
        story.append(_grid([["번호", "부품", "수량"], *_line_rows(parts, with_money=False)], [12 * mm, 140 * mm, 28 * mm], right_cols=(2,)))
    if s.get("billable"):
        story += [Spacer(1, 3 * mm), _p("유상 작업입니다. 작업비는 따로 청구합니다.", 9)]
    story += [Spacer(1, 10 * mm), _p("위 작업을 확인합니다.", 11, align=TA_CENTER), Spacer(1, 6 * mm)]
    sign = Table([[_p("확인 날짜", 9), "", _p("확인자", 9), _p("(서명)", 9, color=colors.grey, align=TA_RIGHT)]], colWidths=[22 * mm, 48 * mm, 22 * mm, 48 * mm], rowHeights=[14 * mm], hAlign="RIGHT")
    sign.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, LINE), ("BACKGROUND", (0, 0), (0, 0), SHADE), ("BACKGROUND", (2, 0), (2, 0), SHADE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(sign)
    return _build(story, "작업 확인서", s["no"], canceled, _footer(s))


def ledger(s: dict[str, Any]) -> bytes:
    """거래처 원장 (기간): 이월 잔액 → 거래마다 +청구 −입금 → 잔액"""
    story: list[Any] = [_title("거래처 원장", "", f"{s['from']} ~ {s['to']}"), Spacer(1, 4 * mm)]
    pa = s["partner"]
    story.append(_p(f"{pa.get('name', '')}  귀하", 13, True))
    story.append(Spacer(1, 4 * mm))
    for side in s["sides"]:
        story += [_p(side["title"], 10, True), Spacer(1, 2 * mm)]
        head = ["날짜", "번호", "구분", "내용", side["plus"], side["minus"], "잔액"]
        rows: list[list[Any]] = [["", "", "", _p("이월", 8.5, True), "", "", won(side["opening"])]]
        for r in side["rows"]:
            rows.append([r["date"], _p(r["no"], 7.5), r["type"], _p(r["summary"], 8), won(r["plus"]) if r["plus"] else "", won(r["minus"]) if r["minus"] else "", won(r["balance"])])
        rows.append(["", "", "", _p("기간 합계", 8.5, True), won(side["plusSum"]), won(side["minusSum"]), won(side["closing"])])
        story.append(_grid([head, *rows], [19 * mm, 25 * mm, 15 * mm, 55 * mm, 22 * mm, 22 * mm, 22 * mm], right_cols=(4, 5, 6), extra=[("BACKGROUND", (0, len(rows)), (-1, len(rows)), SHADE), ("FONTSIZE", (0, 0), (-1, -1), 8)]))
        story.append(Spacer(1, 5 * mm))
    if not s["sides"]:
        story.append(_p("이 기간에 거래가 없습니다.", 9))
    story += _bank(s)
    return _build(story, "거래처 원장", "", False, _footer(s))


# ── 기기 라벨 ────────────────────────────────────────

SHEETS: dict[str, dict[str, float]] = {
    # A4 라벨지 (mm): 칸 크기와 첫 칸 위치·간격. 회사마다 약간 다르면 출력할 때 위치 보정
    "a4-21": {"cols": 3, "rows": 7, "w": 63.5, "h": 38.1, "left": 7.25, "top": 15.15, "px": 66.0, "py": 38.1},
    "a4-24": {"cols": 3, "rows": 8, "w": 63.5, "h": 33.9, "left": 7.25, "top": 12.9, "px": 66.0, "py": 33.9},
    "a4-14": {"cols": 2, "rows": 7, "w": 99.1, "h": 38.1, "left": 4.65, "top": 15.15, "px": 101.6, "py": 38.1},
}
ROLLS: dict[str, tuple[float, float]] = {"50x30": (50, 30), "60x40": (60, 40), "40x30": (40, 30)}


def _fit(text: str, font: str, max_size: float, width: float, min_size: float = 4.5) -> float:
    size = max_size
    while size > min_size and pdfmetrics.stringWidth(text, font, size) > width:
        size -= 0.25
    return size


def _label(c: Canvas, x: float, y: float, w: float, h: float, a: dict[str, Any], company: str, phone: str, base_url: str) -> None:
    """(x, y) = 라벨 왼쪽 아래. 왼쪽 QR(기기 화면 주소), 오른쪽 회사·고유번호·모델·제조번호·A/S 전화"""
    pad = min(w, h) * 0.07
    q = min(h - 2 * pad, w * 0.4)
    widget = QrCodeWidget(f"{base_url}/company/{a['cid']}/assets/{a['id']}", barLevel="M")
    bx = widget.getBounds()
    d = Drawing(q, q, transform=[q / (bx[2] - bx[0]), 0, 0, q / (bx[3] - bx[1]), 0, 0])
    d.add(widget)
    renderPDF.draw(d, c, x + pad * 0.6, y + (h - q) / 2)
    tx = x + q + pad * 1.6
    tw = w - (tx - x) - pad
    lines = [
        (company, R, h * 0.11),
        (a["code"], B, h * 0.22),
        (a.get("itemName", ""), R, h * 0.115),
        (f"S/N {a['serial']}" if a.get("serial") else "", R, h * 0.1),
        (f"A/S {phone}" if phone else "", B, h * 0.11),
    ]
    lines = [ln for ln in lines if ln[0]]
    # 모델 이름이 너무 작아지면 두 줄로
    name, nsize = a.get("itemName", ""), h * 0.115
    if name and _fit(name, R, nsize, tw) < 7:
        cut = max((i for i, ch in enumerate(name) if ch == " " and pdfmetrics.stringWidth(name[:i], R, 7) <= tw), default=len(name) // 2)
        k = next(i for i, ln in enumerate(lines) if ln[0] == name)
        lines[k : k + 1] = [(name[:cut].strip(), R, nsize), (name[cut:].strip(), R, nsize)]
    sizes = [_fit(t, f, s, tw) for t, f, s in lines]
    total = sum(sz * 1.25 for sz in sizes)
    cy = y + h / 2 + total / 2
    for (t, f, _), sz in zip(lines, sizes, strict=True):
        cy -= sz * 1.25
        c.setFont(f, sz)
        c.drawString(tx, cy + sz * 0.2, t)


def labels(assets: list[dict[str, Any]], company: str, phone: str, base_url: str, kind: str = "a4-21", start: int = 0, nudge: tuple[float, float] = (0, 0), outline: bool = False) -> bytes:
    """A4 라벨지(kind = SHEETS 키, start = 건너뛸 칸 수) 또는 라벨 프린터(kind = 'roll-50x30' 등, 한 장에 하나)"""
    _fonts()
    buf = io.BytesIO()
    if kind.startswith("roll-"):
        w, h = ROLLS[kind[5:]]
        c = Canvas(buf, pagesize=(w * mm, h * mm))
        for a in assets:
            _label(c, 0, 0, w * mm, h * mm, a, company, phone, base_url)
            c.showPage()
    else:
        sh = SHEETS[kind]
        per = int(sh["cols"] * sh["rows"])
        c = Canvas(buf, pagesize=A4)
        nx, ny = nudge[0] * mm, nudge[1] * mm
        slot = start
        for a in assets:
            if slot and slot % per == 0:
                c.showPage()
            k = slot % per
            col, row = k % int(sh["cols"]), k // int(sh["cols"])
            x = (sh["left"] + col * sh["px"]) * mm + nx
            y = A4[1] - (sh["top"] + row * sh["py"] + sh["h"]) * mm - ny
            if outline:
                c.setStrokeColor(colors.lightgrey)
                c.roundRect(x, y, sh["w"] * mm, sh["h"] * mm, 2 * mm)
            _label(c, x, y, sh["w"] * mm, sh["h"] * mm, a, company, phone, base_url)
            slot += 1
        c.showPage()
    c.save()
    return buf.getvalue()


RENDER = {"statement": statement, "receipt": receipt, "invoice": invoice, "work": work}
