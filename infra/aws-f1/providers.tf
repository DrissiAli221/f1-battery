provider "aws" {
  region = var.region
  # Optional guard against applying to the wrong account (RCP does the same).
  allowed_account_ids = var.account_id == null ? null : [var.account_id]
  default_tags {
    tags = { Project = "f1-battery", ManagedBy = "Terraform" }
  }
}
