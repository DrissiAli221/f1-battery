variable "name" {
  description = "Resource prefix."
  type        = string
  default     = "f1-battery"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "Use 3-31 lowercase letters, digits, or hyphens, starting with a letter."
  }
}

variable "region" {
  description = "Region of the S3 buckets (CloudFront itself is global). Matches AWS_REGION in deploy/oracle/.env."
  type        = string
  default     = "eu-west-1"
}

variable "account_id" {
  description = "Optional 12-digit account ID; when set, Terraform refuses to apply to any other account."
  type        = string
  default     = null
  validation {
    condition     = var.account_id == null || can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Supply a 12-digit account ID or leave it null."
  }
}

variable "origin_host" {
  description = "Host CloudFront uses to reach the Oracle VM (plain HTTP, port 80). Must equal F1_ORIGIN_HOST in deploy/oracle/.env. CloudFront may reject a bare IP as an origin domain; if so use a name that resolves to it, e.g. 84.8.217.209.sslip.io (see README)."
  type        = string
  default     = "84.8.217.209"
}

variable "origin_secret" {
  description = "Value of the X-Origin-Secret header CloudFront adds to every VM request. Caddy returns 403 without it. Generate with: openssl rand -hex 24. Stored in Terraform state: keep the state private."
  type        = string
  sensitive   = true
  validation {
    condition     = can(regex("^[A-Za-z0-9]{24,}$", var.origin_secret))
    error_message = "Use at least 24 letters/digits (openssl rand -hex 24)."
  }
}

variable "backup_retention_days" {
  description = "Days before db-backups/ objects expire."
  type        = number
  default     = 14
}

variable "raw_noncurrent_days" {
  description = "Days before noncurrent versions of raw/ objects expire."
  type        = number
  default     = 7
}

variable "live_read_timeout_seconds" {
  description = "Origin read timeout of the /api/live/* origin (the CloudFront default is 30; raising above 60 needs a quota request)."
  type        = number
  default     = 60
}
