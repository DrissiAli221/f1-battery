resource "aws_iam_user" "vm" {
  name = "${var.name}-vm"
}

# The only access key; its secret is shown once by `terraform output -raw vm_secret_access_key`
# and lives in Terraform state. Rotate by tainting the key.
resource "aws_iam_access_key" "vm" {
  user = aws_iam_user.vm.name
}

data "aws_iam_policy_document" "vm" {
  statement {
    sid       = "DataObjects"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = [for p in ["private-assets", "db-backups", "raw"] : "${aws_s3_bucket.data.arn}/${p}/*"]
  }
  statement {
    sid       = "DataList"
    actions   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.data.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["private-assets/*", "db-backups/*", "raw/*", "private-assets", "db-backups", "raw"]
    }
  }
  statement {
    sid       = "WebSync"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
  }
  statement {
    sid       = "WebList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
  }
  statement {
    sid       = "Invalidate"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_user_policy" "vm" {
  name   = "${var.name}-runtime"
  user   = aws_iam_user.vm.name
  policy = data.aws_iam_policy_document.vm.json
}
