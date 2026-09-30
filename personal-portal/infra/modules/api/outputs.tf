output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "endpoint" {
  value = aws_apigatewayv2_api.this.api_endpoint
}
