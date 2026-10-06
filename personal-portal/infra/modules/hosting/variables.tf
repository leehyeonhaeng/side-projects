variable "name" {
  type = string
}

variable "bucket_name" {
  description = "S3 버킷명은 전역 유일해야 하므로 접미사를 붙인다"
  type        = string
}

variable "force_destroy" {
  type    = bool
  default = false
}

variable "content_security_policy" {
  description = "웹 앱 CSP. API·Cognito 주소만 연결 허용, 스크립트는 같은 출처만"
  type        = string
  default     = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.execute-api.ap-northeast-2.amazonaws.com https://cognito-idp.ap-northeast-2.amazonaws.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
}
