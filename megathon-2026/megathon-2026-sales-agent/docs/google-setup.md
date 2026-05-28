# Google Cloud 설정 가이드

## 1. 프로젝트 생성

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 새 프로젝트 생성: `sales-agent-system`

---

## 2. API 활성화

**API 및 서비스 → 라이브러리**에서 아래 4개 활성화:

- Gmail API
- Google Docs API
- Google Drive API
- Google Sheets API

---

## 3. OAuth 2.0 클라이언트 ID 생성

**API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**

| 항목 | 값 |
|------|-----|
| 애플리케이션 유형 | 데스크톱 앱 |
| 이름 | `sales-agent-oauth` |

생성 후 `client_id`, `client_secret` 메모

---

## 4. OAuth 동의 화면 설정

**API 및 서비스 → OAuth 동의 화면**

- 테스트 사용자에 사용할 Google 계정 추가

---

## 5. refresh_token 발급

CloudShell에서 아래 스크립트 실행:

**STEP 1 — 인증 URL 생성**
```bash
python3 << 'EOF'
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
]

client_config = {
    "installed": {
        "client_id": "YOUR_CLIENT_ID",
        "client_secret": "YOUR_CLIENT_SECRET",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token"
    }
}

flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
flow.redirect_uri = "urn:ietf:wg:oauth:2.0:oob"
auth_url, _ = flow.authorization_url(access_type='offline', prompt='consent')
print(auth_url)
EOF
```

**STEP 2 — 코드로 refresh_token 발급**
```bash
python3 << 'EOF'
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
]

client_config = {
    "installed": {
        "client_id": "YOUR_CLIENT_ID",
        "client_secret": "YOUR_CLIENT_SECRET",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token"
    }
}

flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
flow.redirect_uri = "urn:ietf:wg:oauth:2.0:oob"
flow.fetch_token(code="여기에_인증코드_입력")
print(f"refresh_token: {flow.credentials.refresh_token}")
EOF
```

---

## 6. Secrets Manager에 저장

발급받은 값을 AWS Secrets Manager `sales-agent/google-credentials`에 저장:

```json
{
  "client_id": "발급받은 client_id",
  "client_secret": "발급받은 client_secret",
  "refresh_token": "발급받은 refresh_token"
}
```
