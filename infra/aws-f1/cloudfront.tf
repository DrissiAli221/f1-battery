locals {
  site_url = "https://${aws_cloudfront_distribution.site.domain_name}"

  # AWS managed policies (fixed IDs, documented by AWS).
  caching_disabled_id               = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  all_viewer_except_host_header_orp = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa" {
  name    = "${var.name}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/spa.js")
}

# Zero minimum TTL so index.html and the page files revalidate; hashed /assets/ files are immutable
# through their Cache-Control header, which the origin (S3 sync) sets.
resource "aws_cloudfront_cache_policy" "web" {
  name        = "${var.name}-web"
  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name = "${var.name}-security"
  security_headers_config {
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      override                   = true
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  comment             = "${var.name} site"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # The Oracle VM, plain HTTP on 80. Caddy there accepts only requests carrying X-Origin-Secret.
  origin {
    domain_name = var.origin_host
    origin_id   = "vm"
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }
    custom_header {
      name  = "X-Origin-Secret"
      value = var.origin_secret
    }
  }

  # Same VM, own origin so the live feed gets a longer read timeout (a timeout is per origin).
  origin {
    domain_name = var.origin_host
    origin_id   = "vm-live"
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = var.live_read_timeout_seconds
      origin_keepalive_timeout = 5
    }
    custom_header {
      name  = "X-Origin-Secret"
      value = var.origin_secret
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.web.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  # More specific path first. CloudFront buffers streamed responses poorly: the SSE feed may arrive
  # in chunks (README). Compression is off so events are not held back for a compression window.
  ordered_cache_behavior {
    path_pattern               = "/api/live/*"
    target_origin_id           = "vm-live"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = local.caching_disabled_id
    origin_request_policy_id   = local.all_viewer_except_host_header_orp
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "vm"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.caching_disabled_id
    origin_request_policy_id   = local.all_viewer_except_host_header_orp
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }
  depends_on = [aws_s3_bucket_public_access_block.web]
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}
resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}
