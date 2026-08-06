# Everything here plugs into infrastructure you already have — no VPC, no
# subnets, no NAT/IGW are created by this config. Fill these in from your
# existing AWS account (see README-DEPLOY.md).

variable "aws_region" {
  description = "AWS region of the existing VPC/account this deploys into."
  type        = string
}

variable "vpc_id" {
  description = "Existing VPC ID to deploy into."
  type        = string
}

variable "private_subnet_ids" {
  description = "Existing private subnet IDs (>= 2, in different AZs) for the RDS subnet group and the EC2 host. No public IP is assigned to either resource."
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks (your corporate network / VPN ranges) allowed to reach the app on app_port. Plain HTTP, no ALB/ACM — this must be a trusted internal range, not 0.0.0.0/0."
  type        = list(string)
}

variable "app_port" {
  description = "Port the containerized app listens on."
  type        = number
  default     = 3100
}

variable "instance_type" {
  description = "EC2 instance type running the Docker container. No autoscaling — one instance."
  type        = string
  default     = "t3.small"
}

variable "key_name" {
  description = "Existing EC2 key pair name for SSH access (optional — omit to rely on SSM Session Manager only, which the instance profile already grants)."
  type        = string
  default     = null
}

variable "db_instance_class" {
  description = "RDS instance class. Single-AZ, no read replicas — this is an internal tool, not a scaled service."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB. The migrated dataset is ~300k rows (well under 1GB); this leaves headroom for real data later."
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "Postgres engine version."
  type        = string
  default     = "16.4"
}

variable "db_name" {
  description = "Database name."
  type        = string
  default     = "sqlmetrics"
}

variable "db_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "sqlmetrics_app"
}

variable "db_password" {
  description = "Master password for the RDS instance. Pass via TF_VAR_db_password or a tfvars file that is NOT committed — do not hardcode."
  type        = string
  sensitive   = true
}

variable "app_image" {
  description = "Full image URI (including tag) to run, e.g. <ecr_repo_url>:latest. Leave null on first apply (before anything's been pushed) — the instance will come up without a running container until you push an image and restart it (see README-DEPLOY.md)."
  type        = string
  default     = null
}

variable "name_prefix" {
  description = "Prefix applied to resource names/tags."
  type        = string
  default     = "sql-metrics"
}
