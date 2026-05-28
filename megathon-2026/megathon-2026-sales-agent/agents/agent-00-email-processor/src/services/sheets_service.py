"""
sheets_service.py
─────────────────
Google Sheets 연동 서비스.
Internal / External 시트에 이메일 발신자 정보를 기록한다.

시트 구조:
    Internal: idx | 담당자 | 담당자 이메일 | Unit | 그룹메일 | S3 | Assigned | R&R | Mapping Tag | Frequency
    External: idx | Account | 담당부서 | 담당자 | 담당자 이메일 | Docs (Drive) | SFDC | DMS | MCIS
"""

import os
from google.oauth2 import service_account
from googleapiclient.discovery import build
from .classifier import INTERNAL_SHEET, EXTERNAL_SHEET

# ── 설정 ──────────────────────────────────────────────────────────────────────
SCOPES               = ["https://www.googleapis.com/auth/spreadsheets"]
SERVICE_ACCOUNT_FILE = os.path.join(os.path.dirname(__file__), "..", "creditinals.json")
SPREADSHEET_ID       = "1SqnwTx7iDF24qN9RviOh1jMuRBnziVUiz8OGeEVDPcs"

SHEET_HEADERS = {
    INTERNAL_SHEET: [["idx", "담당자", "담당자 이메일", "Unit", "그룹메일", "S3", "Assigned R&R", "Mapping Tag", "Frenquency"]],
    EXTERNAL_SHEET: [["idx", "Account", "담당부서", "담당자", "담당자 이메일", "Docs (Drive)", "SFDC", "DMS", "MCIS"]],
}
# ─────────────────────────────────────────────────────────────────────────────


def _get_service():
    """인증된 Google Sheets 서비스 객체 반환."""
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES
    )
    return build("sheets", "v4", credentials=creds)


def _get_sheet_data(service, sheet_name: str) -> list:
    """시트 전체 데이터를 2D 리스트로 반환."""
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=sheet_name)
        .execute()
    )
    return result.get("values", [])


def _ensure_sheet(service, sheet_name: str):
    """시트가 없으면 생성하고 헤더를 추가한다."""
    meta     = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    existing = [s["properties"]["title"] for s in meta["sheets"]]

    if sheet_name not in existing:
        service.spreadsheets().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]},
        ).execute()
        service.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{sheet_name}!A1",
            valueInputOption="RAW",
            body={"values": SHEET_HEADERS[sheet_name]},
        ).execute()
        print(f"[sheets] '{sheet_name}' 시트 생성 완료")


def _build_row(sheet_name: str, idx: int, sender_email: str, extra: dict) -> list:
    """시트 종류에 맞는 행 데이터 생성."""
    if sheet_name == INTERNAL_SHEET:
        # idx | 담당자 | 담당자 이메일 | Unit | 그룹메일 | S3 | Assigned R&R | Mapping Tag | Frenquency
        return [
            idx,
            extra.get("sender_name", ""),
            sender_email,
            extra.get("unit", ""),
            extra.get("group_email", ""),
            "",                              # S3 컬럼 — 미사용
            extra.get("assigned_rnr", ""),   # Assigned R&R (합쳐진 컬럼)
            extra.get("mapping_tag", ""),
            extra.get("frequency", ""),
        ]
    else:
        # idx | Account | 담당부서 | 담당자 | 담당자 이메일 | Docs (Drive) | SFDC | DMS | MCIS
        return [
            idx,
            extra.get("account", ""),
            extra.get("department", ""),
            extra.get("sender_name", ""),
            sender_email,
            extra.get("docs_drive", ""),
            extra.get("sfdc", ""),
            extra.get("dms", ""),
            extra.get("mcis", ""),
        ]


def log_to_sheet(sheet_name: str, sender_email: str, extra: dict = {}, force: bool = False) -> str:
    """
    Internal 또는 External 시트에 발신자 정보를 기록한다.

    Args:
        sheet_name:   "Internal" or "External"
        sender_email: 발신자 이메일
        extra:        추가 정보 (sender_name, account, s3_uri 등)
        force:        True이면 중복 체크 없이 항상 새 행 추가 (테스트 계정용)

    Returns:
        "created" | "skipped"
    """
    service = _get_service()
    _ensure_sheet(service, sheet_name)

    rows      = _get_sheet_data(service, sheet_name)
    email_col = 2 if sheet_name == INTERNAL_SHEET else 4

    # 중복 체크 (force=True 이면 스킵)
    if not force:
        for row in rows[1:]:
            if len(row) > email_col and row[email_col].strip().lower() == sender_email.strip().lower():
                print(f"[sheets] '{sender_email}' 이미 {sheet_name} 시트에 존재 — 스킵")
                return "skipped"

    idx     = len(rows)
    new_row = _build_row(sheet_name, idx, sender_email, extra)

    service.spreadsheets().values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{sheet_name}!A1",
        valueInputOption="RAW",
        body={"values": [new_row]},
    ).execute()

    print(f"[sheets] '{sender_email}' → {sheet_name} 시트 기록 완료 (idx={idx})")
    return "created"


def get_internal_data() -> list[dict]:
    """
    Internal 시트 전체 데이터를 dict 리스트로 반환.
    각 dict 키: 헤더 컬럼명.
    """
    service = _get_service()
    rows    = _get_sheet_data(service, INTERNAL_SHEET)
    if len(rows) < 2:
        return []

    headers = rows[0]
    result  = []
    for row in rows[1:]:
        entry = {}
        for i, h in enumerate(headers):
            entry[h] = row[i] if i < len(row) else ""
        result.append(entry)
    return result


def update_rnr(target_email: str, new_rnr: str) -> bool:
    """
    Internal 시트에서 target_email 행의 Assigned R&R 컬럼을 업데이트.

    Args:
        target_email: 수정할 행의 담당자 이메일
        new_rnr:      새로운 Assigned R&R 값

    Returns:
        True: 업데이트 성공, False: 행을 찾지 못함
    """
    service = _get_service()
    rows    = _get_sheet_data(service, INTERNAL_SHEET)

    if len(rows) < 2:
        print(f"[sheets] Internal 시트에 데이터 없음")
        return False

    # 담당자 이메일 컬럼 = col 2 (C), Assigned R&R = col 6 (G)
    email_col = 2
    rnr_col   = 6

    target_row_idx = None
    for i, row in enumerate(rows[1:], start=2):  # 1-indexed, 헤더 제외
        if len(row) > email_col and row[email_col].strip().lower() == target_email.strip().lower():
            target_row_idx = i
            break

    if target_row_idx is None:
        print(f"[sheets] '{target_email}' 행을 찾을 수 없음")
        return False

    col_letter = chr(ord("A") + rnr_col)
    cell_range = f"{INTERNAL_SHEET}!{col_letter}{target_row_idx}"

    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=cell_range,
        valueInputOption="RAW",
        body={"values": [[new_rnr]]},
    ).execute()

    print(f"[sheets] '{target_email}' Assigned R&R 업데이트 완료 → '{new_rnr}' ({cell_range})")
    return True
