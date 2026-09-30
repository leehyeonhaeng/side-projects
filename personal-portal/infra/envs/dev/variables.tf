variable "powertools_layer_arn" {
  description = "AWS 공개 Powertools 레이어. 최신 버전은 SSM /aws/service/powertools/python/arm64/python3.12/latest"
  type        = string
  default     = "arn:aws:lambda:ap-northeast-2:017000801446:layer:AWSLambdaPowertoolsPythonV3-python312-arm64:38"
}

variable "host_email" {
  description = "Host 계정 이메일이자 가입 알림 수신 주소. 레포에 남기지 않도록 terraform.tfvars(로컬) / TF_VAR_host_email(CI)로 넣는다"
  type        = string
}
