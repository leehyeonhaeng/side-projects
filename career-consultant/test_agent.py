# import boto3

# REGION = "ap-northeast-2"
# AGENT_ID = "4RIKKDLNMY"
# ALIAS_ID = "44TD4BAA4U"

# runtime_client = boto3.client("bedrock-agent-runtime", region_name=REGION)

# response = runtime_client.invoke_agent(
#     agentId=AGENT_ID,
#     agentAliasId=ALIAS_ID,
#     sessionId="test-session-001",
#     inputText="안녕하세요! 저는 Python 2년차 개발자입니다. 카카오 백엔드 개발자로 이직하고 싶어요."
# )

# for event in response["completion"]:
#     if "chunk" in event:
#         print(event["chunk"]["bytes"].decode("utf-8"))

import boto3
import json

REGION = "ap-northeast-2"
client = boto3.client("bedrock-runtime", region_name=REGION)

# global. prefix로 직접 호출 테스트
response = client.invoke_model(
    modelId="global.anthropic.claude-sonnet-4-6",
    body=json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 100,
        "messages": [{"role": "user", "content": "안녕"}]
    })
)

result = json.loads(response["body"].read())
print(result["content"][0]["text"])