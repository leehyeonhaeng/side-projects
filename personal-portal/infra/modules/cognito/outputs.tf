output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "issuer" {
  value = "https://${aws_cognito_user_pool.this.endpoint}"
}

output "web_client_id" {
  value = aws_cognito_user_pool_client.web.id
}
