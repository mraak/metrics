output "rds_endpoint" {
  description = "RDS Postgres endpoint (host:port). Use with migrate_to_postgres.py and DATABASE_URL."
  value       = aws_db_instance.this.endpoint
}

output "rds_address" {
  value = aws_db_instance.this.address
}

output "database_url" {
  description = "Full connection string for migrate_to_postgres.py / local testing. Sensitive — contains the master password."
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.this.address}:5432/${var.db_name}"
  sensitive   = true
}

output "ecr_repository_url" {
  description = "Push your built image here, then set app_image to <this>:<tag> and re-apply."
  value       = aws_ecr_repository.app.repository_url
}

output "ec2_instance_id" {
  description = "Use with `aws ssm start-session --target <id>` to reach the host without SSH."
  value       = aws_instance.app.id
}

output "ec2_private_ip" {
  value = aws_instance.app.private_ip
}

output "app_url" {
  value = "http://${aws_instance.app.private_ip}:${var.app_port}"
}
