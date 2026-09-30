variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "tfstate_bucket_name" {
  type    = string
  default = "portal-tfstate-lhhportal"
}

variable "github_repo" {
  description = "GitHub OIDC sub 조건에 쓰이는 owner/repo"
  type        = string
  default     = "leehyeonhaeng/side-projects"
}

variable "budget_limit_amount" {
  description = "월 예산 한도. 계정 청구 통화(Billing preferences)에 맞춰 조정 필요"
  type        = string
  default     = "10"
}

variable "budget_limit_unit" {
  type    = string
  default = "USD"
}

variable "budget_notification_email" {
  type    = string
  default = "ldlgusgod@mz.co.kr"
}
