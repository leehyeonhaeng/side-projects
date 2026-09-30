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
  description = "예산 알림 수신 주소. 레포에 남기지 않도록 terraform.tfvars(로컬) / TF_VAR_budget_notification_email(CI)로 넣는다"
  type        = string
}
