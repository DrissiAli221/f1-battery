# ---- web bucket: private, served only through CloudFront (OAC) -----------------------------------
resource "aws_s3_bucket" "web" {
  bucket_prefix = "${substr(var.name, 0, 26)}-web-"
}
resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# ---- data bucket: private-assets/, db-backups/, raw/ ---------------------------------------------
resource "aws_s3_bucket" "data" {
  bucket_prefix = "${substr(var.name, 0, 26)}-data-"
}
resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "data" {
  bucket = aws_s3_bucket.data.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  # Versioning must exist before noncurrent-version rules.
  depends_on = [aws_s3_bucket_versioning.data]

  rule {
    id     = "expire-db-backups"
    status = "Enabled"
    filter { prefix = "db-backups/" }
    expiration { days = var.backup_retention_days }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 2 }
  }
  rule {
    id     = "expire-raw-noncurrent"
    status = "Enabled"
    filter { prefix = "raw/" }
    noncurrent_version_expiration { noncurrent_days = var.raw_noncurrent_days }
    abort_incomplete_multipart_upload { days_after_initiation = 2 }
  }
}
