"""
Sales Agent Router - 크롬 확장프로그램 → Bedrock Agent Core 중계 Lambda

Chrome Extension에서 API Gateway를 통해 호출되며,
Bedrock Agent Runtime API (InvokeAgent)를 호출하여 결과를 반환합니다.
"""
import json
import boto3

# ── 설정 ──────────────────────────────────────────────────────────────
REGION = 'ap-northeast-2'

# TODO: Bedrock Agent 생성 후 아래 값을 채워주세요
ORCHESTRATOR_AGENT_ID = 'BRFMJAXGJ7'      # Agent Core ID
ORCHESTRATOR_ALIAS_ID = '16Q84PHBCZ'      # Agent Core Alias ID

A1_AGENT_ID = 'SKZ01K9K79'                          # A1 Agent ID (직접 호출용)
A1_ALIAS_ID = 'X3UD2COU3M'                          # A1 Alias ID

A4_AGENT_ID = '3WXKPNWHZS'                          # A4 Agent ID (직접 호출용)
A4_ALIAS_ID = '9U8NUAYBMP'                          # A4 Alias ID

# ── 클라이언트 ────────────────────────────────────────────────────────
bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=REGION)


def invoke_agent(agent_id: str, alias_id: str, session_id: str, input_text: str) -> str:
    """Bedrock Agent를 호출하고 응답 텍스트를 반환한다."""
    response = bedrock_agent_runtime.invoke_agent(
        agentId=agent_id,
        agentAliasId=alias_id,
        sessionId=session_id,
        inputText=input_text,
    )

    # 스트리밍 응답 처리
    result_text = ''
    for event in response['completion']:
        if 'chunk' in event:
            chunk = event['chunk']
            if 'bytes' in chunk:
                result_text += chunk['bytes'].decode('utf-8')

    return result_text


def lambda_handler(event, context):
    """API Gateway에서 호출되는 메인 핸들러.

    라우트:
    - POST /invoke       → Agent Core (Supervisor)에게 전달
    - POST /invoke-a1    → A1 에이전트 직접 호출
    - POST /invoke-a4    → A4 에이전트 직접 호출
    """
    try:
        # 요청 파싱
        body = json.loads(event.get('body', '{}'))
        path = event.get('rawPath', '') or event.get('path', '')

        input_text = body.get('message', '')
        session_id = body.get('session_id', 'default-session')

        # file_data가 있으면 input_text에 포함 (A4용)
        if body.get('file_data') or body.get('pdf_base64'):
            file_data = body.get('file_data') or body.get('pdf_base64')
            input_text = json.dumps({
                'action': 'process_contract',
                'file_data': file_data,
                'sheet_id': body.get('sheet_id', ''),
            }, ensure_ascii=False)

        if not input_text:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
                },
                'body': json.dumps({'error': 'message 필드가 필요합니다'}, ensure_ascii=False)
            }

        # 라우팅
        if '/invoke-a1' in path:
            agent_id = A1_AGENT_ID
            alias_id = A1_ALIAS_ID
        elif '/invoke-a4' in path:
            agent_id = A4_AGENT_ID
            alias_id = A4_ALIAS_ID
        else:
            # 기본: Orchestrator (Agent Core)
            agent_id = ORCHESTRATOR_AGENT_ID
            alias_id = ORCHESTRATOR_ALIAS_ID

        # Bedrock Agent 호출
        result = invoke_agent(agent_id, alias_id, session_id, input_text)

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
            },
            'body': json.dumps({
                'response': result,
                'session_id': session_id,
            }, ensure_ascii=False)
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
            },
            'body': json.dumps({
                'error': str(e),
            }, ensure_ascii=False)
        }
