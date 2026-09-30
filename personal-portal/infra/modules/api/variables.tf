variable "name" {
  type = string
}

variable "cors_allow_origins" {
  type = list(string)
}

variable "jwt_issuer" {
  type = string
}

variable "jwt_audience" {
  type = list(string)
}

variable "lambdas" {
  description = "통합 대상 Lambda. key는 routes의 lambda 값과 맞춘다"
  type = map(object({
    function_name = string
    invoke_arn    = string
  }))
}

variable "routes" {
  description = "route_key(\"GET /api/v1/health\") => { lambda, auth }"
  type = map(object({
    lambda = string
    auth   = bool
  }))
}

variable "throttling_burst_limit" {
  type    = number
  default = 50
}

variable "throttling_rate_limit" {
  type    = number
  default = 20
}

variable "log_retention_days" {
  type    = number
  default = 14
}
