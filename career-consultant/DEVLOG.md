# Career Consultant 개발 일지

---

## 2026-05-28

### 오늘 한 것
- 프로젝트 방향 확정: 나만의 취업/이직 컨설팅 AI 서비스
- AWS 개인 계정 생성 및 AWS CLI 설치
- Python 가상환경 구성 (venv)
- Bedrock Agent 생성 및 invoke 테스트 1차 성공
  - Agent ID: 4RIKKDLNMY
  - 모델: global.anthropic.claude-sonnet-4-6
  - 리전: ap-northeast-2

### 겪은 문제들
- 모델 ID 문제: ap. prefix 지원 안됨 → global. 써야 함
- IAM 신뢰 정책: bedrock-agentcore.amazonaws.com → bedrock.amazonaws.com으로 변경 필요
- Alias가 이전 버전 가리키는 문제 → 에이전트 새로 생성으로 해결
- Memory 활성화 이후 accessDeniedException 발생 → 미해결

### 다음에 할 것
- accessDeniedException 원인 파악 및 해결
- AgentCore Memory 연동 테스트
- 멀티 에이전트 구조 설계