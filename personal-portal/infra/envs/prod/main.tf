terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket       = "portal-tfstate-lhhportal"
    key          = "envs/prod/terraform.tfstate"
    region       = "ap-northeast-2"
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-northeast-2"

  default_tags {
    tags = {
      Project = "personal-portal"
      Env     = local.env
    }
  }
}

locals {
  env    = "prod"
  prefix = "portal-${local.env}"

  # DESIGN.md 8.1 도메인별 Lambda (API Gateway 연결). auth-trigger는 아래에 따로 둔다
  services = ["personal", "shared", "admin", "ai", "company"]

  # HTTP API는 ANY + JWT 조합에서 CORS preflight(OPTIONS)까지 인증을 요구하므로
  # 메서드를 명시해서 라우트를 만든다.
  methods = ["GET", "POST", "PUT", "PATCH", "DELETE"]

  # 경로 prefix => 담당 Lambda. 가장 구체적인 경로가 우선 매칭된다.
  route_prefixes = {
    "/api/v1/{proxy+}"            = "personal"
    "/api/v1/admin/{proxy+}"      = "admin"
    "/api/v1/ai/{proxy+}"         = "ai"
    "/api/v1/boards"              = "shared"
    "/api/v1/boards/{proxy+}"     = "shared"
    "/api/v1/checklists"          = "shared"
    "/api/v1/checklists/{proxy+}" = "shared"
    "/api/v1/company"             = "company"
    "/api/v1/company/{proxy+}"    = "company"
  }

  routes = merge(
    {
      "GET /api/v1/health" = { lambda = "personal", auth = false }
      # 행컴퍼니 초대 링크 정보 (로그인 전 가입 화면에서)
      "GET /api/v1/invite/{code}" = { lambda = "company", auth = false }
    },
    {
      for pair in setproduct(keys(local.route_prefixes), local.methods) :
      "${pair[1]} ${pair[0]}" => { lambda = local.route_prefixes[pair[0]], auth = true }
    },
  )
}

# ── 데이터 ──────────────────────────────────────────

module "table" {
  source = "../../modules/dynamodb"
  name   = local.prefix
  # prod: 실수로 지우지 않게 + 35일 안의 아무 시점으로 복구 (DESIGN.md 9.5)
  deletion_protection    = true
  point_in_time_recovery = true
}

# ── 인증 ────────────────────────────────────────────

module "cognito" {
  source              = "../../modules/cognito"
  name                = "${local.prefix}-users"
  trigger_lambda_arn  = module.auth_trigger.arn
  deletion_protection = true
}

# 가입 알림 (Host 이메일 구독은 받은 메일에서 Confirm 해야 활성화된다)
resource "aws_sns_topic" "signup" {
  name = "${local.prefix}-signup"
}

resource "aws_sns_topic_subscription" "host_email" {
  topic_arn = aws_sns_topic.signup.arn
  protocol  = "email"
  endpoint  = var.host_email
}

# ── 백엔드 ──────────────────────────────────────────

data "archive_file" "backend" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend"
  output_path = "${path.module}/.build/backend.zip"
  excludes = [
    "tests/**",
    "**/__pycache__/**",
    ".venv/**",
    ".pytest_cache/**",
    "requirements*.txt",
    "build_ai_layer.py",
    "fonts/**",
    "scripts/**",
  ]
}

locals {
  table_arns = [module.table.arn, "${module.table.arn}/index/*"]
}

# 모든 도메인 Lambda: 권한 미들웨어(PROFILE·PERM 조회) + 자기 도메인 데이터 읽기·쓰기
data "aws_iam_policy_document" "table_rw" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = local.table_arns
  }
}

# admin만 Cognito 사용자 관리 권한을 가진다 (DESIGN.md ADR-05)
data "aws_iam_policy_document" "admin" {
  source_policy_documents = [data.aws_iam_policy_document.table_rw.json]

  statement {
    effect = "Allow"
    actions = [
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminUserGlobalSignOut",
      "cognito-idp:AdminResetUserPassword",
    ]
    resources = [module.cognito.user_pool_arn]
  }
}

# ai만 Bedrock 호출 권한을 가진다 (DESIGN.md ADR-05). 교차 리전(global) 추론 프로필은
# 프로필 ARN + 모든 리전의 기반 모델 ARN 둘 다 허용해야 호출된다.
data "aws_caller_identity" "current" {}

locals {
  bedrock_foundation_model = trimprefix(var.bedrock_model_id, "global.")
}

data "aws_iam_policy_document" "ai" {
  source_policy_documents = [data.aws_iam_policy_document.table_rw.json]

  statement {
    effect  = "Allow"
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:ap-northeast-2:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}",
      "arn:aws:bedrock:*::foundation-model/${local.bedrock_foundation_model}",
      "arn:aws:bedrock:::foundation-model/${local.bedrock_foundation_model}",
    ]
  }
}

# ai Lambda 전용 의존성 레이어 (Powertools + pydantic + anthropic).
# 빌드: python backend/build_ai_layer.py prod → .build/ai-layer/python
data "archive_file" "ai_layer" {
  type        = "zip"
  source_dir  = "${path.module}/.build/ai-layer"
  output_path = "${path.module}/.build/ai-layer.zip"
}

resource "aws_lambda_layer_version" "ai" {
  layer_name               = "${local.prefix}-ai-deps"
  filename                 = data.archive_file.ai_layer.output_path
  compatible_runtimes      = ["python3.12"]
  compatible_architectures = ["arm64"]
  # zip은 빌드할 때마다 바이트가 달라질 수 있어서, 의존성 목록이 바뀔 때만 새 버전을 올린다
  source_code_hash = filebase64sha256("${path.module}/../../../backend/requirements-ai.txt")
}

# ── 행컴퍼니 문서 (COMPANY.md 7·9장) ───────────────

# 발행한 PDF·직인 보관. 비공개, 버전 관리(직인을 바꿔도 예전 문서는 발행 당시 직인으로 다시 그린다)
resource "aws_s3_bucket" "docs" {
  bucket        = "${local.prefix}-docs-lhhportal"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "docs" {
  bucket = aws_s3_bucket.docs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 그때그때 그린 출력물(원장·라벨·취소 판, 서명 URL로 열기)은 하루 뒤 삭제
resource "aws_s3_bucket_lifecycle_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    id     = "tmp-1day"
    status = "Enabled"
    filter {
      prefix = "tmp/"
    }
    expiration {
      days = 1
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
  depends_on = [aws_s3_bucket_versioning.docs]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── 행컴퍼니 알림 (COMPANY.md 12장 C6) ─────────────

# 폰 푸시 서명 키(VAPID, P-256). 값은 SSM SecureString과 비공개 상태 파일에만 있고, Lambda가 콜드 스타트 때 읽는다
resource "tls_private_key" "vapid" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "aws_ssm_parameter" "vapid" {
  name  = "/${local.prefix}/vapid-private-key"
  type  = "SecureString"
  value = tls_private_key.vapid.private_key_pem
}

locals {
  push_env = {
    VAPID_PARAM  = aws_ssm_parameter.vapid.name
    PUSH_SUBJECT = "https://${module.hosting.domain_name}"
  }
}

# company만 문서 버킷을 읽고 쓴다 (DeleteObject: 동시에 발행했을 때 늦은 쪽 파일 정리) + 푸시 키 읽기
data "aws_iam_policy_document" "company" {
  source_policy_documents = [data.aws_iam_policy_document.table_rw.json]

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.docs.arn}/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.vapid.arn]
  }
}

# company Lambda 문서 레이어 (reportlab + pillow + Pretendard 글꼴 /opt/fonts).
# 빌드: python backend/build_ai_layer.py prod → .build/doc-layer
data "archive_file" "doc_layer" {
  type        = "zip"
  source_dir  = "${path.module}/.build/doc-layer"
  output_path = "${path.module}/.build/doc-layer.zip"
}

resource "aws_lambda_layer_version" "doc" {
  layer_name               = "${local.prefix}-doc-deps"
  filename                 = data.archive_file.doc_layer.output_path
  compatible_runtimes      = ["python3.12"]
  compatible_architectures = ["arm64"]
  # 의존성 목록이나 글꼴이 바뀔 때만 새 버전
  source_code_hash = base64sha256(join(",", [
    filesha256("${path.module}/../../../backend/requirements-doc.txt"),
    filesha256("${path.module}/../../../backend/fonts/Pretendard-Regular.ttf"),
    filesha256("${path.module}/../../../backend/fonts/Pretendard-Bold.ttf"),
  ]))
}

locals {
  lambda_policies = {
    admin   = data.aws_iam_policy_document.admin.json
    ai      = data.aws_iam_policy_document.ai.json
    company = data.aws_iam_policy_document.company.json
  }
}

module "lambda" {
  source   = "../../modules/lambda"
  for_each = toset(local.services)

  function_name = "${local.prefix}-${each.key}"
  service       = each.key
  handler       = "handlers.${each.key}.lambda_handler"
  package_path  = data.archive_file.backend.output_path
  package_hash  = data.archive_file.backend.output_base64sha256
  # ai는 자체 레이어만 쓴다 (공개 Powertools 레이어와 같이 쓰면 pydantic 버전이 섞임). company는 문서 레이어 추가
  layers      = each.key == "ai" ? [aws_lambda_layer_version.ai.arn] : each.key == "company" ? [var.powertools_layer_arn, aws_lambda_layer_version.doc.arn] : [var.powertools_layer_arn]
  timeout     = contains(["ai", "company"], each.key) ? 30 : 10
  memory_size = contains(["ai", "company"], each.key) ? 512 : 256
  policy_json = lookup(local.lambda_policies, each.key, data.aws_iam_policy_document.table_rw.json)

  environment = merge(
    { TABLE_NAME = module.table.name },
    each.key == "admin" ? { USER_POOL_ID = module.cognito.user_pool_id } : {},
    each.key == "ai" ? { BEDROCK_MODEL_ID = var.bedrock_model_id } : {},
    each.key == "company" ? merge({ DOCS_BUCKET = aws_s3_bucket.docs.bucket }, local.push_env) : {},
  )
}

# 아침 확인 (매일 08:30 KST): 새로 생긴 연체·만료 임박·청구 대기·검침·밀린 A/S 알림
module "company_daily" {
  source = "../../modules/lambda"

  function_name = "${local.prefix}-company-daily"
  service       = "company-daily"
  handler       = "handlers.company_daily.lambda_handler"
  package_path  = data.archive_file.backend.output_path
  package_hash  = data.archive_file.backend.output_base64sha256
  layers        = [var.powertools_layer_arn, aws_lambda_layer_version.doc.arn]
  timeout       = 120
  memory_size   = 512
  policy_json   = data.aws_iam_policy_document.company.json

  environment = merge({ TABLE_NAME = module.table.name, DOCS_BUCKET = aws_s3_bucket.docs.bucket }, local.push_env)
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = module.company_daily.arn }]
  })
}

resource "aws_scheduler_schedule" "company_daily" {
  name                         = "${local.prefix}-company-daily"
  schedule_expression          = "cron(30 8 * * ? *)"
  schedule_expression_timezone = "Asia/Seoul"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = module.company_daily.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_retry_attempts = 1
    }
  }
}

# Cognito 트리거. 풀이 이 함수 ARN을 참조하므로 풀 ID는 이벤트에서 받고,
# IAM 정책만 풀 ARN을 참조해서 순환 의존을 피한다.
data "aws_iam_policy_document" "auth_trigger" {
  statement {
    effect    = "Allow"
    actions   = ["cognito-idp:AdminDisableUser", "cognito-idp:AdminAddUserToGroup"]
    resources = [module.cognito.user_pool_arn]
  }

  statement {
    effect = "Allow"
    # 초대 가입(COMPANY.md 8장): 초대·회사·프리셋 읽기, 초대 사용 표시
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchWriteItem"]
    resources = [module.table.arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.signup.arn]
  }
}

module "auth_trigger" {
  source = "../../modules/lambda"

  function_name = "${local.prefix}-auth-trigger"
  service       = "auth-trigger"
  handler       = "handlers.auth_trigger.lambda_handler"
  package_path  = data.archive_file.backend.output_path
  package_hash  = data.archive_file.backend.output_base64sha256
  layers        = [var.powertools_layer_arn]
  timeout       = 5
  policy_json   = data.aws_iam_policy_document.auth_trigger.json

  environment = {
    TABLE_NAME       = module.table.name
    HOST_EMAIL       = var.host_email
    SIGNUP_TOPIC_ARN = aws_sns_topic.signup.arn
  }
}

module "api" {
  source = "../../modules/api"
  name   = "${local.prefix}-api"

  cors_allow_origins = ["https://${module.hosting.domain_name}"]
  jwt_issuer         = module.cognito.issuer
  jwt_audience       = [module.cognito.web_client_id]

  lambdas = {
    for name, fn in module.lambda : name => {
      function_name = fn.function_name
      invoke_arn    = fn.invoke_arn
    }
  }
  routes = local.routes
}

# ── 프론트엔드 ──────────────────────────────────────

module "hosting" {
  source        = "../../modules/hosting"
  name          = "${local.prefix}-web"
  bucket_name   = "${local.prefix}-web-lhhportal"
  force_destroy = false
}
