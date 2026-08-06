# Deploying to AWS (Postgres/RDS, Docker, on-prem corporate network)

This documents running SQL-Metrics Studio against Postgres on RDS, deployed
as a Docker container on an EC2 host inside your existing AWS VPC. There is
no load balancer, no ACM/HTTPS, and no autoscaling here — this is a
single-instance deployment on your internal corporate network, reachable
over plain HTTP from trusted CIDR ranges only.

## Two drivers, one codebase

The app supports SQLite (local dev) and Postgres (this deployment) side by
side — [studio/src/lib/db.ts](studio/src/lib/db.ts) picks the driver based on
whether `DATABASE_URL` is set:

- **`DATABASE_URL` unset** → SQLite, reading `metrics.db` (read-only) and
  `studio/studio.db` (read-write) directly, exactly as before this deployment
  existed. This is still the default for `npm run dev` — zero setup, no
  database to stand up. `better-sqlite3` is an `optionalDependency` used only
  on this path.
- **`DATABASE_URL` set** → Postgres. Both logical stores (the read-mostly
  analytics tables and the `findings_catalog` table) live as plain tables in
  one Postgres schema, read via `pg`. Table and column names are unchanged
  from the SQLite versions.

This deployment always sets `DATABASE_URL`, so it always runs the Postgres
path — the Docker image is built with `npm ci --omit=optional` and never
installs `better-sqlite3` at all (no native module to compile, smaller
image; see [Dockerfile](Dockerfile)).

**All existing data is migrated, not regenerated.** [migrate_to_postgres.py](migrate_to_postgres.py)
copies the rows that are already in `metrics.db` / `studio/studio.db` today
into Postgres. `seed.py` / `compute_metrics.py` are not re-run.

This was verified end-to-end against a real local Postgres instance —
including the standalone server bundle Docker actually runs — before this
was written up, in both driver modes.

## Prerequisites

- An existing AWS account, VPC, and at least 2 private subnets (in different
  AZs) with a route to your corporate network (VPN / Direct Connect) — this
  deploy does not create any of that.
- Local tools: `terraform` (>= 1.5), `docker`, `aws` CLI (configured with
  credentials for the target account), `python3` with `psycopg2-binary`
  (`pip install -r requirements.txt`), and the
  [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html#install-plugin-macos)
  (`brew install --cask session-manager-plugin`).
- Your corporate network's CIDR range(s), to allow inbound to the app port.
- VPC must have `enableDnsHostnames = true` and `enableDnsSupport = true`
  (Terraform creates the SSM/S3 VPC endpoints, but private DNS must be on).

## 1. Provision infrastructure (Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your VPC ID, subnet IDs, and allowed CIDR
block(s). Set the DB master password out-of-band — never in a committed
file:

```bash
export TF_VAR_db_password='choose-a-strong-password'
```

```bash
terraform init
terraform plan
terraform apply
```

This creates: an RDS Postgres instance (single-AZ, private, `db.t4g.micro` by
default), a security group that only allows the app host to reach Postgres, an
ECR repository for the app image, VPC endpoints for S3 (gateway — so `dnf`
works on the private instance), SSM / SSMMessages / EC2Messages (so Session
Manager can reach the instance), and ECR API + ECR DKR (interface — so the
instance can pull the container image), and an EC2 instance (20 GB root
volume, private, no public IP) with an instance profile that can pull from ECR
and be reached via SSM Session Manager. `app_image` is unset on this first
apply, so the instance boots without a running container yet — that's
expected.

Note the outputs: `database_url`, `ecr_repository_url`, `ec2_instance_id`,
`app_url`.

## 2. Migrate the existing data into RDS

Generate the SQLite database locally first, then migrate it to RDS:

```bash
python3 seed.py && python3 compute_metrics.py
```

The RDS instance has no public IP, so run this from somewhere with VPC
access. The simplest option is an SSM port-forward through the EC2 instance
Terraform just created (no bastion, no SSH key needed):

```bash
aws ssm start-session \
  --target "$(terraform -chdir=terraform output -raw ec2_instance_id)" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["'"$(terraform -chdir=terraform output -raw rds_address)"'"],"portNumber":["5432"],"localPortNumber":["5432"]}'
```

Leave that running in one terminal, then in another (from the repo root):

```bash
pip install -r requirements.txt
DATABASE_URL="postgresql://<db_username>:<db_password>@localhost:5432/<db_name>" \
  python3 migrate_to_postgres.py
```

Use the `db_username`/`db_name` from your `terraform.tfvars` (defaults:
`sqlmetrics_app` / `sqlmetrics`). This copies all 9 tables (`brands`,
`skus`, `regions`, `competitors`, `sales`, `forecast`, `region_metrics`,
`territory_metrics`, `national_metrics`) plus `findings_catalog` — printing a
row count per table. It's safe to re-run: every table is
`TRUNCATE`d and reloaded from the current SQLite files, so re-running just
re-syncs whatever is in `metrics.db` / `studio/studio.db` at that moment.

## 3. Build and push the Docker image

```bash
aws ecr get-login-password --region <your-region> | \
  docker login --username AWS --password-stdin "$(terraform -chdir=terraform output -raw ecr_repository_url | cut -d/ -f1)"

docker build -t "$(terraform -chdir=terraform output -raw ecr_repository_url):latest" .
docker push "$(terraform -chdir=terraform output -raw ecr_repository_url):latest"
```

## 4. Point the host at the image

```bash
cd terraform
terraform apply -var="app_image=$(terraform output -raw ecr_repository_url):latest"
```

This sets `app_image`, which changes the instance's user-data and replaces
the EC2 instance (its user-data script does the `docker pull` + `docker run`
on boot) — expect a new instance ID/IP.

**For routine redeploys after this initial rollout**, don't re-apply
Terraform (that replaces the instance each time). Instead, build/push a new
tag and update the running container over SSM:

```bash
aws ssm start-session --target "$(terraform -chdir=terraform output -raw ec2_instance_id)"
# on the instance:
sudo docker pull <ecr_repository_url>:<new-tag>
sudo docker rm -f app
sudo docker run -d --name app --restart unless-stopped -p 3100:3100 \
  -e DATABASE_URL="postgresql://<user>:<pass>@<rds_address>/<db_name>" \
  <ecr_repository_url>:<new-tag>
```

## 5. Verify

```bash
aws ssm start-session \
  --target "$(terraform -chdir=terraform output -raw ec2_instance_id)" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3100"],"localPortNumber":["3100"]}'
curl http://localhost:3100/api/report/meta
```

Or, if your corporate network already routes to the private subnet, hit
`terraform output app_url` directly from a machine on that network.

## Loading real data later (same model, no app changes)

The Postgres schema (table/column names, types) mirrors `metrics.db`
exactly, so once you have a real ETL pipeline it just needs to write to the
same 9 tables — the app doesn't change. Two ways to get there:

- **Keep using the Python ETL locally, then re-sync:** run your updated
  `compute_metrics.py`/`seed.py`-equivalent to produce a fresh `metrics.db`,
  then re-run `migrate_to_postgres.py` against RDS (same as step 2) — it's a
  full-table refresh (`TRUNCATE` + reload), not incremental.
- **Point a real ETL straight at Postgres:** swap `sqlite3` for `psycopg2`
  in your ETL and write to the same table/column names — `migrate_to_postgres.py`'s
  `CREATE TABLE` statements double as the schema reference.

## Notes / tradeoffs deliberately made for this deployment

- **No ALB, no ACM, no HTTPS.** Traffic is plain HTTP, restricted to
  `allowed_cidr_blocks` at the security-group level. If this ever needs to
  be reachable outside the corporate network, put it behind your existing
  ALB/reverse proxy rather than opening the security group further.
- **No autoscaling.** One EC2 instance, one container. If it needs to
  survive an AZ outage or handle real concurrent load later, move to ECS
  Fargate + an internal NLB — the app code doesn't change, only the compute
  layer would.
- **DB credentials are passed as a container env var via EC2 user-data**
  (visible in the EC2 console/instance metadata to anyone with instance
  describe permissions in this account). For tighter isolation, move the
  password into Secrets Manager and have the container fetch it at boot
  instead of baking it into user-data.
- **`skip_final_snapshot = true`** on the RDS instance — fine for now since
  all data is reproducible from `migrate_to_postgres.py`, but flip this once
  real production data lives there.
- **SSM agent on AL2023 is RPM-based, not Snap.** AL2023 ships the SSM agent
  as a snap by default, but `snapd` can't start without internet access (needs
  the Snap Store). The user-data script replaces it with `amazon-ssm-agent`
  from the `dnf` repos (reachable over the S3 VPC endpoint), so SSM Session
  Manager works on a fully private subnet with only the S3/SSM/SSMMessages/
  EC2Messages VPC endpoints — no NAT gateway needed.
- **RDS SSL: `?sslmode=no-verify`.** The Alpine-based Docker image doesn't
  ship the RDS CA bundle, and downloading it at boot requires an extra S3
  call. The connection is still encrypted over TLS; CA verification is skipped
  as a deliberate tradeoff for traffic that never leaves the VPC. If this
  becomes a compliance issue, add a `curl` of the RDS CA bundle to user-data
  and mount it into the container.
- **20 GB root volume.** The AL2023 AMI defaults to 2 GB, which isn't enough
  for Docker + an extracted container image (~500 MB). 20 GB (gp3) is set in
  `root_block_device`. User-data runs `growpart` + `xfs_growfs` to expand the
  filesystem if the volume is resized.
