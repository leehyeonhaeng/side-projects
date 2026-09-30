output "api_endpoint" {
  value = module.api.endpoint
}

output "web_url" {
  value = "https://${module.hosting.domain_name}"
}

output "web_bucket" {
  value = module.hosting.bucket_name
}

output "web_distribution_id" {
  value = module.hosting.distribution_id
}

output "user_pool_id" {
  value = module.cognito.user_pool_id
}

output "user_pool_client_id" {
  value = module.cognito.web_client_id
}

output "table_name" {
  value = module.table.name
}
