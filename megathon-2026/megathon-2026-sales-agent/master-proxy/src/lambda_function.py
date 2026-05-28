"""
마스터 에이전트 프록시 Lambda

크롬 익스텐션에서 받은 JSON을 Bedrock Agent(BRFMJAXGJ7)에 전달하고 응답을 반환한다.
PDF 첨부 시 sales-agent-a4 Lambda를 직접 호출한다.
메일 첨부 시 agent-00-email-processor Lambda를 직접 호출한다.
"""
import json
import boto3
import uuid
import base64
from datetime import datetime, timezone

REGION = 'ap-northeast-2'
AGENT_ID = 'BRFMJAXGJ7'
AGENT_ALIAS_ID = 'TSTALIASID'
S3_BUCKET = 'sales-agent-contract'

# Agent_00 Lambda (이메일 분류/라우팅)
AGENT_00_FUNCTION_NAME = 'agent-00-email-processor'

bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=REGION)
s3_client = boto3.client('s3', region_name=REGION)
lambda_client = boto3.client('lambda', region_name=REGION)


def upload_pdf_to_s3(file_data_b64, file_name):
    """PDF base64를 S3에 임시 저장하고 s3_key를 반환한다."""
    pdf_bytes = base64.b64decode(file_data_b64)
    date_prefix = datetime.now(timezone.utc).strftime('%Y/%m/%d')
    unique_id = str(uuid.uuid4())[:8]
    safe_name = file_name.replace(' ', '_') if file_name else 'contract.pdf'
    s3_key = f"temp/{date_prefix}/{unique_id}_{safe_name}"

    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=pdf_bytes,
        ContentType='application/pdf',
    )
    return s3_key


def invoke_agent_00(payload):
    """Agent_00 Lambda를 직접 호출한다."""
    response = lambda_client.invoke(
        FunctionName=AGENT_00_FUNCTION_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
    )
    return json.loads(response['Payload'].read())


def lambda_handler(event, context):
    try:
        # API Gateway 프록시 이벤트에서 body 파싱
        body = json.loads(event.get('body', '{}')) if isinstance(event.get('body'), str) else event

        prompt = body.get('prompt', '')
        mail_context = body.get('context', {})
        data = body.get('data', {})

        # ── PDF 첨부 시: sales-agent-a4 직접 호출 ─────────────────────
        if data.get('file_data'):
            file_name = data.get('file_name', '계약서.pdf')
            user_info = body.get('user', {})
            user_name = user_info.get('name', '')

            payload = {
                'function': 'process_contract',
                'actionGroup': 'record-actions',
                'parameters': [
                    {'name': 'file_data', 'type': 'string', 'value': data['file_data']},
                    {'name': 'user_name', 'type': 'string', 'value': user_name},
                ],
            }

            resp = lambda_client.invoke(
                FunctionName='sales-agent-a4',
                InvocationType='RequestResponse',
                Payload=json.dumps(payload),
            )
            result = json.loads(resp['Payload'].read())

            # Lambda 응답에서 결과 추출
            try:
                body_str = result['response']['functionResponse']['responseBody']['TEXT']['body']
                body_json = json.loads(body_str)
                result_text = body_json.get('message', '계약서 처리 완료')
            except (KeyError, TypeError):
                result_text = json.dumps(result, ensure_ascii=False)

            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
                'body': json.dumps({
                    'status': 'success',
                    'message': result_text,
                }, ensure_ascii=False),
            }

        # ── 메일 첨부 시: Agent_00 직접 호출 ──────────────────────────
        if mail_context.get('source') == 'gmail' and mail_context.get('body_text'):
            # Agent_00이 기대하는 형식으로 전달
            agent_00_payload = {
                'prompt': prompt,
                'context': mail_context,
                'data': data,
                'user': body.get('user', {}),
            }

            result = invoke_agent_00(agent_00_payload)

            # Agent_00 응답을 사용자 친화적 메시지로 변환
            if isinstance(result, dict):
                # statusCode가 있는 경우 body에서 실제 데이터 추출
                if 'body' in result and isinstance(result['body'], str):
                    try:
                        result = json.loads(result['body'])
                    except:
                        pass

                category = result.get('category', '')
                sender = result.get('sender', '')
                subject = result.get('subject', '')
                sheet_status = result.get('sheet', '')

                # 사용자 친화적 메시지 구성
                lines = ['✅ 메일 처리 완료']
                lines.append(f'📧 발신자: {sender}')
                if subject:
                    lines.append(f'📋 제목: {subject}')
                lines.append(f'🏷️ 분류: {category.upper()}')
                lines.append(f'📊 시트 기록: {"완료" if sheet_status == "created" else sheet_status}')

                # External인 경우 추가 정보
                if result.get('matched_manager'):
                    lines.append(f'')
                    lines.append(f'👤 담당자: {result["matched_manager"]}')
                if result.get('matched_tag'):
                    lines.append(f'🔖 태그: {result["matched_tag"]}')
                if result.get('draft_email'):
                    lines.append(f'')
                    lines.append(f'✉️ 메일 초안:')
                    lines.append(result['draft_email'])

                # Internal R&R 업데이트
                rnr = result.get('rnr_update', {})
                if rnr.get('should_update'):
                    lines.append(f'')
                    lines.append(f'🔄 R&R 업데이트: {rnr.get("target_email")} → {rnr.get("new_rnr")}')

                result_text = '<br>'.join(lines)
            else:
                result_text = str(result)

            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
                'body': json.dumps({
                    'status': 'success',
                    'message': result_text,
                }, ensure_ascii=False),
            }

        # ── 일반 텍스트: Bedrock Agent 호출 ───────────────────────────
        input_text = prompt

        if not input_text:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
                'body': json.dumps({
                    'status': 'error',
                    'message': 'prompt 필드가 필요합니다.',
                }, ensure_ascii=False),
            }

        # Bedrock Agent 호출
        session_id = str(uuid.uuid4())
        response = bedrock_agent_runtime.invoke_agent(
            agentId=AGENT_ID,
            agentAliasId=AGENT_ALIAS_ID,
            sessionId=session_id,
            inputText=input_text,
        )

        # 스트리밍 응답 수집
        result_text = ""
        for event_stream in response.get('completion', []):
            if 'chunk' in event_stream:
                result_text += event_stream['chunk']['bytes'].decode('utf-8')

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            'body': json.dumps({
                'status': 'success',
                'message': result_text,
            }, ensure_ascii=False),
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            'body': json.dumps({
                'status': 'error',
                'message': f'에이전트 호출 실패: {str(e)}',
            }, ensure_ascii=False),
        }
