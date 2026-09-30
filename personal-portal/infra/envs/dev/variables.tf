variable "powertools_layer_arn" {
  description = "AWS 공개 Powertools 레이어. 최신 버전은 SSM /aws/service/powertools/python/arm64/python3.12/latest"
  type        = string
  default     = "arn:aws:lambda:ap-northeast-2:017000801446:layer:AWSLambdaPowertoolsPythonV3-python312-arm64:38"
}
