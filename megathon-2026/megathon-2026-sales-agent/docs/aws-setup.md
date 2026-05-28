# AWS 설정 가이드

## 1. Lambda Layer 생성

CloudShell에서 아래 순서로 패키징 후 Lambda Layer로 업로드합니다.

### google-api-layer (A1, A4 공용)
```bash
mkdir python
pip install google-api-python-client google-auth google-auth-httplib2 google-auth-oauthlib -t python/ --no-cache-dir
zip -r google-api-layer.zip python/
```

### pypdf-layer (A4 전용)
```bash
rm -rf python
mkdir python
sudo yum install python3.12 -y
python3.12 -m pip install pypdf -t python/ --no-cache-dir
zip -r pypdf-layer.zip python/
```

Lambda 콘솔 → 계층 → 계층 생성 → zip 업로드 (Python 3.12, x86_64)

---

## 2. Secrets Manager 설정

리전: `ap-northeast-2` (서울)

```json
{
  "client_id": "Google OAuth Client ID",
  "client_secret": "Google OAuth Client Secret",
  "refresh_token": "Google OAuth Refresh Token"
}
```

시크릿 이름: `sales-agent/google-credentials`

---

## 3. S3 버킷 생성 (A4)

| 항목 | 값 |
|------|-----|
| 버킷 이름 | `sales-agent-contracts` |
| 리전 | `ap-northeast-2` |
| 퍼블릭 액세스 차단 | 모두 차단 |

> 계약서 원본은 비공개 보관 후 Presigned URL로 접근

---

## 4. Lambda 함수 설정

### A1 (sales-agent-a1)

| 항목 | 값 |
|------|-----|
| 런타임 | Python 3.12 |
| 타임아웃 | 1분 |
| Layer | google-api-layer, openpyxl-layer |
| IAM | AmazonBedrockFullAccess + Secrets Manager |

### A4 (sales-agent-a4)

| 항목 | 값 |
|------|-----|
| 런타임 | Python 3.12 |
| 타임아웃 | 3분 |
| 메모리 | 256MB |
| Layer | google-api-layer, openpyxl-layer, pypdf-layer |
| IAM | AmazonBedrockFullAccess + AmazonS3FullAccess + Secrets Manager |

### Secrets Manager 인라인 정책
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:sales-agent/google-credentials*"
    }
  ]
}
```

---

## 5. API Gateway 설정

### A1
- 타입: HTTP API
- 이름: `sales-agent-a1-api`
- 라우트: `POST /generate`
- 통합: `sales-agent-a1` Lambda

### A4
- 타입: HTTP API
- 이름: `sales-agent-a4-api`
- 라우트: `POST /process-contract`
- 통합: `sales-agent-a4` Lambda
- CORS: `*` (웹 페이지 호출 허용)
