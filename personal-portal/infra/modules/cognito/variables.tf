variable "name" {
  type = string
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "trigger_lambda_arn" {
  description = "PostConfirmation·PostAuthentication 트리거 Lambda (auth-trigger)"
  type        = string
}
