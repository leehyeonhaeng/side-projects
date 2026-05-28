# import boto3
# import time

# REGION = "ap-northeast-2"
# AGENT_ID = "4RIKKDLNMY"

# client = boto3.client("bedrock-agent", region_name=REGION)

# # 기존 alias 삭제
# client.delete_agent_alias(
#     agentId=AGENT_ID,
#     agentAliasId="T5BN51RXDO"
# )
# print("기존 alias 삭제!")
# time.sleep(5)

# # 새 alias 생성
# alias_response = client.create_agent_alias(
#     agentId=AGENT_ID,
#     agentAliasName="v2",
# )
# ALIAS_ID = alias_response["agentAlias"]["agentAliasId"]
# print(f"새 Alias ID: {ALIAS_ID}")
# time.sleep(15)

# # Memory 테스트
# runtime_client = boto3.client("bedrock-agent-runtime", region_name=REGION)

# print("\n--- 첫 번째 대화 ---")
# response = runtime_client.invoke_agent(
#     agentId=AGENT_ID,
#     agentAliasId=ALIAS_ID,
#     sessionId="memory-test-session-001",
#     memoryId="user-001",
#     inputText="안녕하세요! 저는 Python 2년차 개발자이고 Django, FastAPI 경험 있어요. 카카오 백엔드 개발자로 이직하고 싶어요."
# )

# for event in response["completion"]:
#     if "chunk" in event:
#         print(event["chunk"]["bytes"].decode("utf-8"))


import boto3
import time

REGION = "ap-northeast-2"
AGENT_ID = "4RIKKDLNMY"

client = boto3.client("bedrock-agent", region_name=REGION)

# Memory 비활성화
client.update_agent(
    agentId=AGENT_ID,
    agentName="career-consultant-agent",
    agentResourceRoleArn="arn:aws:iam::860402920684:role/career-consultant-agent-role",
    foundationModel="global.anthropic.claude-sonnet-4-6",
    instruction="""
    당신은 취업/이직 컨설팅 전문가입니다.
    사용자의 스펙, 경력, 조건을 분석하고
    지원하는 회사와 직무에 맞는 맞춤형 로드맵을 제공합니다.
    회사, 직무, 산업, 기술 트렌드를 항상 고려해서
    구체적이고 실행 가능한 조언을 제공합니다.
    """,
)
print("Memory 비활성화 완료!")

client.prepare_agent(agentId=AGENT_ID)
print("배포 중...")
time.sleep(30)

runtime_client = boto3.client("bedrock-agent-runtime", region_name=REGION)

response = runtime_client.invoke_agent(
    agentId=AGENT_ID,
    agentAliasId="EM9FT7MUC6",
    sessionId="test-session-010",
    inputText="안녕하세요!"
)

for event in response["completion"]:
    if "chunk" in event:
        print(event["chunk"]["bytes"].decode("utf-8"))