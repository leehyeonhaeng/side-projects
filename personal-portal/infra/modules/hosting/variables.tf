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
