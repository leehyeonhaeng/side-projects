"""
Contract AI Assetizer - Lambda Function
계약서 PDF 자동 분석 및 자산화 에이전트

스프레드시트: 계약관리 리스트 (1yXxzFMl5punfnvzpnc0l9xU_-EIhY_4cehun9FTfO0o)
AWS Region: ap-northeast-2 (서울)
"""
import json
import base64
import logging
import traceback
import io
import urllib.request
import urllib.parse
from datetime import datetime, timezone

import boto3


# ── 상수 ──────────────────────────────────────────────────────────────
REGION = 'ap-northeast-2'
SECRET_NAME = 'sales-agent/google-credentials'
SPREADSHEET_ID = '1yXxzFMl5punfnvzpnc0l9xU_-EIhY_4cehun9FTfO0o'
DRIVE_FOLDER_ID = '1Mi6ceRoNBA9ki76L9xRJaP8cBMWcbPI3'
S3_BUCKET = 'sales-agent-contract'
MODEL_ID = 'global.anthropic.claude-sonnet-4-6'

# ── 로거 ──────────────────────────────────────────────────────────────
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── AWS 클라이언트 ────────────────────────────────────────────────────
bedrock_client = boto3.client('bedrock-runtime', region_name=REGION)
secrets_client = boto3.client('secretsmanager', region_name=REGION)
s3_client = boto3.client('s3', region_name=REGION)


# ══════════════════════════════════════════════════════════════════════
# Google OAuth 인증
# ══════════════════════════════════════════════════════════════════════

def get_secret():
    """Secrets Manager에서 OAuth 자격증명을 조회한다."""
    secret = secrets_client.get_secret_value(SecretId=SECRET_NAME)
    return json.loads(secret['SecretString'])


def get_access_token(secret):
    """OAuth refresh_token으로 access_token을 발급받는다."""
    data = urllib.parse.urlencode({
        'client_id': secret['client_id'],
        'client_secret': secret['client_secret'],
        'refresh_token': secret['refresh_token'],
        'grant_type': 'refresh_token'
    }).encode()
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=data, method='POST')
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read())['access_token']


# ══════════════════════════════════════════════════════════════════════
# 이벤트 파싱 및 검증
# ══════════════════════════════════════════════════════════════════════

def parse_event(event: dict) -> dict:
    body: dict = {}
    inner_event = event

    # Bedrock Agent Function Schema 이벤트 처리
    if 'function' in event and 'parameters' in event:
        params = event.get('parameters', [])
        for p in params:
            body[p['name']] = p.get('value', '')
        return body

    if 'body' in event and isinstance(event.get('body'), str):
        try:
            inner_event = json.loads(event['body'])
        except (json.JSONDecodeError, TypeError):
            inner_event = event

    # s3_key가 있으면 S3에서 PDF를 다운로드하여 file_data로 변환
    if 's3_key' in inner_event:
        s3_key = inner_event['s3_key']
        try:
            obj = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
            pdf_bytes = obj['Body'].read()
            inner_event['file_data'] = base64.b64encode(pdf_bytes).decode()
        except Exception as e:
            logger.error(f'S3 download failed for key {s3_key}: {e}')
            return {'file_data': ''}
        return inner_event

    if 'file_data' in inner_event:
        return inner_event
    if 'pdf_base64' in inner_event:
        inner_event['file_data'] = inner_event['pdf_base64']
        return inner_event

    try:
        properties = (
            inner_event.get('requestBody', {})
            .get('content', {})
            .get('application/json', {})
            .get('properties', [])
        )
        if isinstance(properties, list):
            for prop in properties:
                body[prop['name']] = prop.get('value')
        elif isinstance(properties, dict):
            for k, v in properties.items():
                body[k] = v.get('value') if isinstance(v, dict) else v
    except (KeyError, TypeError):
        pass

    for param in inner_event.get('parameters', []):
        body[param['name']] = param.get('value')

    return body


def validate_required_fields(body: dict) -> list:
    required_fields = ['file_data']
    return [field for field in required_fields if not body.get(field)]


def _is_function_schema(event: dict) -> bool:
    return 'function' in event

def _is_http_api(event: dict) -> bool:
    return 'requestContext' in event or 'body' in event


# ══════════════════════════════════════════════════════════════════════
# 응답 빌더
# ══════════════════════════════════════════════════════════════════════

def build_error_response(event, status_code, message, missing_fields=None):
    error_body = json.dumps({
        'error': message,
        'missing_fields': missing_fields or [],
    }, ensure_ascii=False)

    if _is_http_api(event):
        return {
            'statusCode': status_code,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            'body': error_body,
        }

    if _is_function_schema(event):
        return {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': event.get('actionGroup', ''),
                'function': event.get('function', ''),
                'functionResponse': {
                    'responseBody': {
                        'TEXT': {'body': error_body}
                    }
                },
            },
        }

    return {
        'messageVersion': '1.0',
        'response': {
            'actionGroup': event.get('actionGroup', ''),
            'apiPath': event.get('apiPath', ''),
            'httpMethod': event.get('httpMethod', 'POST'),
            'httpStatusCode': status_code,
            'responseBody': {
                'application/json': {'body': error_body}
            },
        },
    }


def build_success_response(event, analysis, s3_link, sheets_status):
    message = f"계약서 처리가 완료되었습니다. 고객사: {analysis['account']}"

    result_body = {
        'account': analysis['account'],
        'contract_level': analysis.get('contract_level', ''),
        'category': analysis.get('category', ''),
        'contract_period': analysis.get('contract_period', ''),
        'effective_date': analysis.get('effective_date', ''),
        'expiry_date': analysis.get('expiry_date', ''),
        'contract_title': analysis.get('contract_title', ''),
        'auto_renewal': analysis.get('auto_renewal', ''),
        's3_link': s3_link,
        'sheets_status': sheets_status,
        'message': message,
    }

    result_json = json.dumps(result_body, ensure_ascii=False)

    if _is_http_api(event):
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            'body': result_json,
        }

    if _is_function_schema(event):
        return {
            'messageVersion': '1.0',
            'response': {
                'actionGroup': event.get('actionGroup', ''),
                'function': event.get('function', ''),
                'functionResponse': {
                    'responseBody': {
                        'TEXT': {'body': result_json}
                    }
                },
            },
        }

    return {
        'messageVersion': '1.0',
        'response': {
            'actionGroup': event.get('actionGroup', ''),
            'apiPath': event.get('apiPath', ''),
            'httpMethod': event.get('httpMethod', 'POST'),
            'httpStatusCode': 200,
            'responseBody': {
                'application/json': {'body': result_json}
            },
        },
    }


# ══════════════════════════════════════════════════════════════════════
# 파일 디코딩
# ══════════════════════════════════════════════════════════════════════

def _is_valid_base64_pdf(data: str) -> bool:
    try:
        decoded = base64.b64decode(data)
        return decoded[:5] == b'%PDF-'
    except Exception:
        return False


def decode_file_data(file_data: str, event: dict) -> tuple:
    # s3_key로 전달된 경우 S3에서 PDF 다운로드
    if file_data.startswith('temp/') or file_data.startswith('contracts/'):
        try:
            obj = s3_client.get_object(Bucket=S3_BUCKET, Key=file_data)
            pdf_bytes = obj['Body'].read()
            return pdf_bytes, None, 'pdf'
        except Exception as e:
            logger.error(f'S3 download failed for key {file_data}: {e}')
            return file_data, None, 'text'

    if _is_valid_base64_pdf(file_data):
        pdf_bytes = base64.b64decode(file_data)
        return pdf_bytes, None, 'pdf'
    return file_data, None, 'text'


# ══════════════════════════════════════════════════════════════════════
# 로깅
# ══════════════════════════════════════════════════════════════════════

_SENSITIVE_KEYS = frozenset({
    'private_key', 'private_key_id', 'client_email',
    'client_id', 'credentials', 'token', 'secret',
})


def log_step(step: str, status: str, details: dict = None) -> None:
    safe_details = {
        k: v for k, v in (details or {}).items()
        if k.lower() not in _SENSITIVE_KEYS
    }
    logger.info(json.dumps(
        {'step': step, 'status': status, **safe_details},
        ensure_ascii=False,
    ))


def log_error(step: str, exception: Exception) -> None:
    logger.error(json.dumps({
        'step': step,
        'status': 'ERROR',
        'exception_type': type(exception).__name__,
        'message': str(exception),
        'traceback': traceback.format_exc(),
    }, ensure_ascii=False))


# ══════════════════════════════════════════════════════════════════════
# Bedrock 계약서 분석
# ══════════════════════════════════════════════════════════════════════

ANALYSIS_PROMPT = """다음 계약서 내용을 분석하여 아래 JSON 형식으로만 응답하세요.
다른 설명 없이 JSON만 출력하세요:

{
    "account": "계약 상대방(고객사/갑) 회사명. '주식회사', '(주)' 등 법인 형태는 제외하고 실제 회사명만 추출 (예: 주식회사 코드잇 → 코드잇)",
    "brn": "사업자등록번호 (없으면 빈 문자열)",
    "address": "고객사 주소 (없으면 빈 문자열)",
    "representative": "고객사 대표자명 (없으면 빈 문자열)",
    "contract_level": "Lv1, Lv2, Lv3, Lv4 중 하나",
    "category": "Infra, MS, AGR 중 하나",
    "service_name": "서비스 제공자 또는 플랫폼명 (예: AWS, GCP, Azure 등)",
    "contract_name": "계약서에 기재된 계약 명칭. 추가약정인 경우 품목을 괄호로 포함 (예: MZC 관리형클라우드컴퓨팅서비스추가약정(ManagedSP))",
    "contract_period": "계약 기간 전체 (시작일 ~ 종료일)",
    "written_date": "계약서 작성일 (YYYY.MM.DD 형식. Lv1이면 빈 문자열)",
    "effective_date": "적용일/시작일 (YYYY.MM.DD 형식)",
    "expiry_date": "만료일 (YYYY.MM.DD 형식)",
    "auto_renewal": "자동갱신 여부: O 또는 X"
}

값을 찾을 수 없는 경우 빈 문자열("")로 응답하세요.

contract_level 판단 기준:
- 내용에 '통합 디지털 서비스'가 포함되면 Lv1
- '관리형서비스' 또는 '관리형 서비스'가 포함되면 Lv2
- '합의서'가 포함되면 Lv4
- '추가 약정'이 포함되면 Lv3
- 아무것도 아니라면 빈값으로 가져와
- '추가 약정'이 포함되면, 품목 뽑기 (CFRC,ManagedSP 등)

category 판단 기준:
- Lv4이면 AGR
- 인프라/클라우드 관련 또는 관리형 서비스 등급이 Basic이면 Infra
- 관리형 서비스 등급이 Standard와 Premium이면 MS"""


def analyze_contract(file_data, data_type: str, event: dict) -> tuple:
    try:
        if data_type == 'pdf':
            pdf_b64 = base64.b64encode(file_data).decode()
            content = [
                {
                    'type': 'document',
                    'source': {
                        'type': 'base64',
                        'media_type': 'application/pdf',
                        'data': pdf_b64,
                    },
                },
                {'type': 'text', 'text': ANALYSIS_PROMPT},
            ]
        else:
            content = [
                {'type': 'text', 'text': f"계약서 내용:\n{file_data[:8000]}\n\n{ANALYSIS_PROMPT}"},
            ]

        request_body = {
            'anthropic_version': 'bedrock-2023-05-31',
            'max_tokens': 1000,
            'messages': [{'role': 'user', 'content': content}],
        }

        response = bedrock_client.invoke_model(
            modelId=MODEL_ID,
            body=json.dumps(request_body),
        )
        result = json.loads(response['body'].read())
        return result['content'][0]['text'], None

    except Exception as e:
        log_error('analyze_contract', e)
        return None, build_error_response(event, 500, f'Bedrock 분석 실패: {str(e)}')


def parse_bedrock_response(response_text: str, event: dict) -> tuple:
    try:
        text = response_text.strip()
        if text.startswith('```'):
            lines = text.split('\n')
            text = '\n'.join(lines[1:-1]) if lines[-1].strip() == '```' else '\n'.join(lines[1:])

        analysis = json.loads(text)
        return {
            'account': analysis.get('account', ''),
            'brn': analysis.get('brn', ''),
            'address': analysis.get('address', ''),
            'representative': analysis.get('representative', ''),
            'contract_level': analysis.get('contract_level', ''),
            'category': analysis.get('category', ''),
            'service_name': analysis.get('service_name', ''),
            'contract_name': analysis.get('contract_name', ''),
            'contract_period': analysis.get('contract_period', ''),
            'written_date': analysis.get('written_date', ''),
            'effective_date': analysis.get('effective_date', ''),
            'expiry_date': analysis.get('expiry_date', ''),
            'auto_renewal': analysis.get('auto_renewal', ''),
        }, None

    except Exception as e:
        log_error('parse_bedrock_response', e)
        return None, build_error_response(event, 500, f'Bedrock 응답 파싱 실패: {str(e)}')


def apply_fallbacks(analysis: dict) -> dict:
    analysis['account'] = analysis.get('account') or '미확인'
    return analysis


# ══════════════════════════════════════════════════════════════════════
# S3 업로드
# ══════════════════════════════════════════════════════════════════════

def upload_to_s3(file_data, data_type: str, filename: str, event: dict) -> tuple:
    try:
        if data_type == 'pdf':
            upload_bytes = file_data
            content_type = 'application/pdf'
        else:
            upload_bytes = file_data.encode('utf-8')
            content_type = 'text/plain; charset=utf-8'
            filename = filename.replace('.pdf', '.txt')

        s3_key = f"contracts/{datetime.now(timezone.utc).strftime('%Y/%m/%d')}/{filename}"
        log_step('upload_to_s3', 'START', {'s3_key': s3_key})

        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=upload_bytes,
            ContentType=content_type,
        )

        encoded_key = urllib.parse.quote(s3_key, safe='/')
        public_url = f"https://{S3_BUCKET}.s3.{REGION}.amazonaws.com/{encoded_key}"

        log_step('upload_to_s3', 'DONE', {'s3_key': s3_key})
        return public_url, None

    except Exception as e:
        log_error('upload_to_s3', e)
        return None, build_error_response(event, 500, f'S3 업로드 실패: {str(e)}')


# ══════════════════════════════════════════════════════════════════════
# Google Sheets 기록
# ══════════════════════════════════════════════════════════════════════

def record_to_sheets(row_data: list, access_token: str, event: dict) -> tuple:
    """Google Sheets Sheet2에 계약 데이터 행을 추가한다."""
    try:
        log_step('record_to_sheets', 'START')

        url = (
            f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}'
            f'/values/Sheet2!A:S:append?valueInputOption=USER_ENTERED'
        )

        data = json.dumps({'values': [row_data]}).encode()

        req = urllib.request.Request(
            url,
            data=data,
            headers={
                'Authorization': f'Bearer {access_token}',
                'Content-Type': 'application/json'
            },
            method='POST'
        )

        with urllib.request.urlopen(req) as response:
            response.read()

        log_step('record_to_sheets', 'DONE')
        return '기록 완료', None

    except urllib.error.HTTPError as e:
        error_detail = e.read().decode()
        logger.error(f"SHEETS RECORD ERROR: {error_detail}")
        return None, build_error_response(event, 500, f'Google Sheets 기록 실패: {error_detail}')
    except Exception as e:
        log_error('record_to_sheets', e)
        return None, build_error_response(event, 500, f'Google Sheets 기록 실패: {str(e)}')


# ══════════════════════════════════════════════════════════════════════
# 유틸리티
# ══════════════════════════════════════════════════════════════════════

def build_contract_filename(analysis: dict) -> str:
    service = analysis.get('service_name', '').strip() or 'ETC'
    contract_name = analysis.get('contract_name', '').strip() or '계약서'
    account = analysis.get('account', '').strip() or '미확인'
    written_date = analysis.get('written_date', '').strip()

    short_date = ''
    if written_date:
        short_date = written_date.replace('.', '')[2:]

    if short_date:
        return f"[{service}] {contract_name}_{account}_{short_date}"
    else:
        return f"[{service}] {contract_name}_{account}"


def build_sheets_row(analysis: dict, s3_link: str, contract_title: str = '', user_name: str = '정다인') -> list:
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    hyperlink = f'=HYPERLINK("{s3_link}", "{contract_title}")' if s3_link and '실패' not in s3_link else ''

    return [
        '',                                    # A: Idx
        timestamp,                             # B: Upload Time
        analysis.get('account', ''),           # C: Account
        '정다인',                               # D: 담당자
        analysis.get('brn', ''),               # E: BRN
        analysis.get('address', ''),           # F: 주소
        analysis.get('representative', ''),    # G: 대표자
        analysis.get('contract_level', ''),    # H: 계약레벨 (Lv1~Lv4)
        analysis.get('category', ''),          # I: 분류 (Infra/MS/AGR)
        analysis.get('contract_period', ''),   # J: 계약기간
        analysis.get('written_date', ''),      # K: 작성일
        analysis.get('effective_date', ''),    # L: 적용일
        analysis.get('expiry_date', ''),       # M: 만료일
        analysis.get('auto_renewal', ''),      # N: 자동갱신
        contract_title,                        # O: 계약서명
        '',                                    # P: docs(drive)
        '',                                    # Q: DMS
        '',                                    # R: SFDC
        hyperlink,                             # S: 양사 날인본 (S3 URL HYPERLINK)
    ]


# ══════════════════════════════════════════════════════════════════════
# 메인 핸들러
# ══════════════════════════════════════════════════════════════════════

def lambda_handler(event, context):
    try:
        # 1. 입력 파싱
        log_step('receive', 'START')
        body = parse_event(event)
        log_step('receive', 'DONE')

        # 2. 필수 필드 검증
        missing = validate_required_fields(body)
        if missing:
            return build_error_response(event, 400, '필수 파라미터 누락', missing)

        # 3. 파일 데이터 분류
        log_step('decode_file', 'START')
        file_data, err, data_type = decode_file_data(body['file_data'], event)
        if err:
            return err
        log_step('decode_file', 'DONE', {'data_type': data_type})

        # 4. Bedrock 분석
        log_step('analyze_contract', 'START')
        response_text, err = analyze_contract(file_data, data_type, event)
        if err:
            return err
        log_step('analyze_contract', 'DONE')

        # 5. 응답 파싱 및 폴백
        analysis, err = parse_bedrock_response(response_text, event)
        if err:
            return err
        analysis = apply_fallbacks(analysis)

        # 6. Google OAuth 토큰 발급
        log_step('get_access_token', 'START')
        secret = get_secret()
        access_token = get_access_token(secret)
        log_step('get_access_token', 'DONE')

        # 7. S3에 파일 업로드
        contract_title = build_contract_filename(analysis)
        filename = contract_title + ('.pdf' if data_type == 'pdf' else '.txt')

        s3_link, err = upload_to_s3(file_data, data_type, filename, event)
        if err:
            s3_link = '업로드 실패'
            log_step('upload_to_s3', 'SKIPPED', {'reason': 'S3 upload failed'})

        # 8. Google Sheets 기록
        user_name = body.get('user_name', '정다인')
        row_data = build_sheets_row(analysis, s3_link, contract_title, user_name)
        sheets_status, err = record_to_sheets(row_data, access_token, event)
        if err:
            sheets_status = '기록 실패'
            log_step('record_to_sheets', 'SKIPPED', {'reason': 'Sheets record failed'})

        # 9. 성공 응답
        return build_success_response(event, analysis, s3_link, sheets_status)

    except Exception as e:
        logger.critical(json.dumps({
            'step': 'lambda_handler',
            'status': 'CRITICAL',
            'exception_type': type(e).__name__,
            'message': str(e),
            'traceback': traceback.format_exc(),
        }, ensure_ascii=False))
        return build_error_response(event, 500, f'예상치 못한 오류: {str(e)}')
