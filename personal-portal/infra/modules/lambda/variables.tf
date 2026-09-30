variable "function_name" {
  description = "portal-<env>-<service> 형식. IAM 역할 이름(<function_name>-role)도 여기서 파생된다"
  type        = string
}

variable "service" {
  type = string
}

variable "handler" {
  type = string
}

variable "package_path" {
  type = string
}

variable "package_hash" {
  type = string
}

variable "layers" {
  type    = list(string)
  default = []
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "policy_json" {
  description = "함수별 IAM 정책 JSON (로그 권한은 모듈이 따로 부여)"
  type        = string
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  type    = number
  default = 10
}

variable "log_retention_days" {
  type    = number
  default = 14
}
