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
  description = "월 예산 한도(USD). 청구 통화는 KRW지만 Budgets는 USD 기준, 약 1만 원"
  type        = string
  default     = "7"
}

variable "budget_limit_unit" {
  type    = string
  default = "USD"
}

variable "budget_notification_email" {
  type    = string
  default = "ldlgusgod@mz.co.kr"
}
