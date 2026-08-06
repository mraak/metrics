#!/bin/bash
set -euxo pipefail

# AL2023 ships SSM agent as a snap, but snapd won't start without internet
# (needs Snap Store). Replace with RPM version so VPC endpoints (SSM+S3) suffice.
dnf install -y --setopt=timeout=30 amazon-ssm-agent docker || echo "WARNING: package install failed"
systemctl enable --now amazon-ssm-agent docker

growpart /dev/nvme0n1 1 || true
xfs_growfs / || true

%{ if app_image != null ~}
aws ecr get-login-password --region ${aws_region} > /tmp/ecr-token
cat /tmp/ecr-token | docker login --username AWS --password-stdin ${ecr_registry} 2>&1 | grep -v 'Warning'
rm /tmp/ecr-token

docker pull ${app_image}

docker rm -f app 2>/dev/null || true

docker run -d --name app \
  --restart unless-stopped \
  -p ${app_port}:${app_port} \
  -e DATABASE_URL="postgresql://${db_username}:${db_password}@${db_endpoint}/${db_name}?sslmode=no-verify" \
  -e PORT=${app_port} \
  ${app_image}
%{ else ~}
echo "No app_image set yet — skipping container start. Push an image to ECR, set app_image, and re-apply (or SSH/SSM in and run 'docker run' by hand once)."
%{ endif ~}
