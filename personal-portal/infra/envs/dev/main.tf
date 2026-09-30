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

  # DESIGN.md 8.1 도메인별 Lambda (auth-trigger는 Phase 2)
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
  source = "../../modules/cognito"
  name   = "${local.prefix}-users"
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

module "lambda" {
  source   = "../../modules/lambda"
  for_each = toset(local.services)

  function_name = "${local.prefix}-${each.key}"
  service       = each.key
  handler       = "handlers.${each.key}.lambda_handler"
  package_path  = data.archive_file.backend.output_path
  package_hash  = data.archive_file.backend.output_base64sha256
  layers        = [var.powertools_layer_arn]

  environment = {
    TABLE_NAME = module.table.name
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
