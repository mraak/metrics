# ─── Existing infra (looked up, never created) ─────────────────────────────

data "aws_vpc" "this" {
  id = var.vpc_id
}

data "aws_subnet" "private" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# ─── Security groups ────────────────────────────────────────────────────────

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = "SQL-Metrics Studio app host — inbound from corporate network only, plain HTTP (no ALB/ACM)."
  vpc_id      = var.vpc_id

  ingress {
    description = "App"
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-app" }
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "RDS Postgres — inbound from the app host only."
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from app host"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-db" }
}

# ─── RDS Postgres ───────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = { Name = "${var.name_prefix}-db-subnets" }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name_prefix}-db"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false # no scaling/HA requirement — single instance

  backup_retention_period = 7
  skip_final_snapshot     = true # internal tool with data reproducible from migrate_to_postgres.py; simplifies teardown
  deletion_protection     = false

  apply_immediately = true
}

# ─── ECR (image the EC2 host pulls) ─────────────────────────────────────────

resource "aws_ecr_repository" "app" {
  name                 = "${var.name_prefix}-studio"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# ─── EC2 host running the container via Docker ─────────────────────────────

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name_prefix}-app-host"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# ECR pull rights + SSM Session Manager (so you can reach the instance without
# opening SSH / needing a bastion — pairs well with "no public IP").
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name_prefix}-app-host"
  role = aws_iam_role.app.name
}

locals {
  ecr_registry = split("/", aws_ecr_repository.app.repository_url)[0]
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = var.private_subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  key_name               = var.key_name

  associate_public_ip_address = false

  user_data = templatefile("${path.module}/templates/user_data.sh.tpl", {
    aws_region   = var.aws_region
    ecr_registry = local.ecr_registry
    app_image    = var.app_image
    app_port     = var.app_port
    db_endpoint  = aws_db_instance.this.address
    db_name      = var.db_name
    db_username  = var.db_username
    db_password  = var.db_password
  })
  user_data_replace_on_change = true

  tags = { Name = "${var.name_prefix}-app" }
}
