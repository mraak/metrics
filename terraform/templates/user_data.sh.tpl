#!/bin/bash
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker

%{ if app_image != null ~}
aws ecr get-login-password --region ${aws_region} | docker login --username AWS --password-stdin ${ecr_registry}

docker pull ${app_image}

docker rm -f app 2>/dev/null || true
docker run -d --name app \
  --restart unless-stopped \
  -p ${app_port}:${app_port} \
  -e DATABASE_URL="postgresql://${db_username}:${db_password}@${db_endpoint}/${db_name}" \
  -e PORT=${app_port} \
  ${app_image}
%{ else ~}
echo "No app_image set yet — skipping container start. Push an image to ECR, set app_image, and re-apply (or SSH/SSM in and run 'docker run' by hand once)."
%{ endif ~}
