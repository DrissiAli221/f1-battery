output "site_url" {
  description = "F1_SITE_URL (the cloudfront.net origin of the site)."
  value       = local.site_url
}

output "distribution_domain" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "distribution_id" {
  description = "F1_CF_DISTRIBUTION."
  value       = aws_cloudfront_distribution.site.id
}

output "web_bucket" {
  description = "F1_WEB_BUCKET."
  value       = aws_s3_bucket.web.id
}

output "data_bucket" {
  description = "F1_S3_BUCKET."
  value       = aws_s3_bucket.data.id
}

output "vm_access_key_id" {
  description = "Goes into secrets/aws_credentials as aws_access_key_id."
  value       = aws_iam_access_key.vm.id
}

output "vm_secret_access_key" {
  description = "Secret half; read once with `terraform output -raw vm_secret_access_key`."
  value       = aws_iam_access_key.vm.secret
  sensitive   = true
}
