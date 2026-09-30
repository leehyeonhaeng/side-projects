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
  }

  backend "s3" {
    bucket       = "portal-tfstate-lhhportal"
    key          = "envs/dev/terraform.tfstate"
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
  env    = "dev"
  prefix = "portal-${local.env}"

  # DESIGN.md 8.1 도메인별 Lambda (API Gateway 연결). auth-trigger는 아래에 따로 둔다
  services = ["personal", "shared", "admin", "ai"]

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
  }

  routes = merge(
    {
      "GET /api/v1/health" = { lambda = "personal", auth = false }
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
}

# ── 인증 ────────────────────────────────────────────

module "cognito" {
  source             = "../../modules/cognito"
  name               = "${local.prefix}-users"
  trigger_lambda_arn = module.auth_trigger.arn
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

module "lambda" {
  source   = "../../modules/lambda"
  for_each = toset(local.services)

  function_name = "${local.prefix}-${each.key}"
  service       = each.key
  handler       = "handlers.${each.key}.lambda_handler"
  package_path  = data.archive_file.backend.output_path
  package_hash  = data.archive_file.backend.output_base64sha256
  layers        = [var.powertools_layer_arn]
  policy_json   = each.key == "admin" ? data.aws_iam_policy_document.admin.json : data.aws_iam_policy_document.table_rw.json

  environment = merge(
    { TABLE_NAME = module.table.name },
    each.key == "admin" ? { USER_POOL_ID = module.cognito.user_pool_id } : {},
  )
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
    effect    = "Allow"
    actions   = ["dynamodb:PutItem", "dynamodb:BatchWriteItem"]
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

  cors_allow_origins = ["https://${module.hosting.domain_name}", "http://localhost:5173"]
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
  force_destroy = true
}
