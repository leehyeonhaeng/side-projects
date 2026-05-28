import boto3

# 설정
REGION = "ap-northeast-2"
AGENT_ID = "4RIKKDLNMY"
ALIAS_ID = "T5BN51RXDO"

# 에이전트 invoke
runtime_client = boto3.client("bedrock-agent-runtime", region_name=REGION)

response = runtime_client.invoke_agent(
    agentId=AGENT_ID,
    agentAliasId=ALIAS_ID,
    sessionId="test-session-001",
    inputText="안녕하세요! 저는 Python 2년차 개발자입니다. 카카오 백엔드 개발자로 이직하고 싶어요."
)

for event in response["completion"]:
    if "chunk" in event:
        print(event["chunk"]["bytes"].decode("utf-8"))