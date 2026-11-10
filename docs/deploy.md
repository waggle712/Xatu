# Deploying the API (AWS Mumbai, ap-south-1)

This is a guide only. Nothing here runs automatically, and nobody deploys from CI yet.

## Why ECS Express Mode, not App Runner

The kit planned AWS App Runner. **AWS closed App Runner to new customers on 30 April 2026** and recommends **Amazon ECS Express Mode** instead. Xatu has no App Runner account, so we deploy with ECS Express Mode. It gives what App Runner would have:

- Fargate tasks
- an HTTPS load balancer with a URL
- auto scaling
- CloudWatch logs

You pay only for those underlying resources. It is also the single deployment path the architecture review asked for. The future BullMQ worker runs on the same ECS cluster.

## Environments

Use separate AWS accounts (or at least separate VPCs, databases and secrets) for **staging** and **production**. Never point staging at the production database. Everything below is done once per environment. Names use `xatu-staging-*`; swap in `prod` for production.

## 1. One-time setup

### Network

- A VPC in ap-south-1 with **two private subnets** (in different AZs) for the API tasks, database and Redis, and two public subnets for the load balancer.
- A NAT gateway (or VPC endpoints for ECR, CloudWatch Logs and Secrets Manager) so tasks in private subnets can pull images and read secrets.
- Security groups:
  - `xatu-staging-api`: outbound to the database and Redis.
  - `xatu-staging-db`: inbound 5432 **only** from `xatu-staging-api` and the migration task.
  - `xatu-staging-redis`: inbound 6379 **only** from `xatu-staging-api`.

### Database: Amazon RDS for PostgreSQL 16

- Engine PostgreSQL 16. Staging can start on `db.t4g.micro`; production on `db.t4g.medium` with **Multi-AZ**.
- Private subnets only, **not publicly accessible**, storage encryption on, deletion protection on (prod).
- Automated backups with **point-in-time recovery** (7 days staging, 14+ days prod). Test a restore before launch; it is one of the 13 pre-launch acceptance tests.
- Parameter group: `rds.force_ssl = 1`.
- PostGIS, pg_trgm and citext are supported on RDS. The first migration runs `CREATE EXTENSION`, so run migrations as the RDS master user (or a role with `rds_superuser`).
- Create a separate **least-privilege app user** for the API (`SELECT/INSERT/UPDATE/DELETE` on the schema, no DDL). Migrations use the master credentials; the running API never does.
- Connection string format: `postgresql://USER:PASSWORD@HOST:5432/xatu?schema=public&sslmode=require`

### Redis: Amazon ElastiCache

- Redis OSS 7 (or Valkey) in the private subnets, encryption in transit on. Staging: `cache.t4g.micro`, single node.
- URL format with TLS: `rediss://HOST:6379`

### Secrets: AWS Secrets Manager

Store one secret per value (or one JSON secret) under `xatu/staging/...`:

| Name                     | Value                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `DATABASE_URL`           | app-user connection string (above)                             |
| `MIGRATION_DATABASE_URL` | master-user connection string, used only by the migration task |
| `REDIS_URL`              | `rediss://...`                                                 |
| `JWT_SECRET`             | `openssl rand -base64 48`, different per environment           |
| `FIREBASE_PROJECT_ID`    | the matching Firebase project (`xatu-staging` / `xatu-prod`)   |

Never put these in the image, the repo, or plain task environment variables.

### Container registry: Amazon ECR

```bash
aws ecr create-repository --region ap-south-1 --repository-name xatu-api \
  --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
```

### IAM roles

- **Task execution role** `xatu-staging-ecs-execution`: managed policy `AmazonECSTaskExecutionRolePolicy`, plus `secretsmanager:GetSecretValue` on `xatu/staging/*` only.
- **Infrastructure role** `xatu-staging-ecs-infrastructure`: lets ECS create the load balancer, target groups, security groups and scaling policies. Use the AWS-managed policy for ECS Express Mode infrastructure.
- No task role is needed yet; add one when the API talks to other AWS services (for example R2 is Cloudflare, so not needed).

### CloudWatch log group

```bash
aws logs create-log-group --region ap-south-1 --log-group-name /xatu/staging/api
aws logs put-retention-policy --region ap-south-1 --log-group-name /xatu/staging/api --retention-in-days 30
```

## 2. Build and push an image

Fargate defaults to x86_64, so build for `linux/amd64` (or build `linux/arm64` and set `--cpu-architecture ARM64`, which is cheaper). Tag with the git commit, never `latest`.

```bash
ACCOUNT=123456789012            # your AWS account id
REGION=ap-south-1
TAG=$(git rev-parse --short HEAD)
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/xatu-api

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker build --platform linux/amd64 -f apps/api/Dockerfile --target runtime -t $REPO:$TAG .
docker build --platform linux/amd64 -f apps/api/Dockerfile --target migrate -t $REPO:migrate-$TAG .
docker push $REPO:$TAG
docker push $REPO:migrate-$TAG
```

The `runtime` image runs as the non-root `node` user, has a Docker healthcheck on `/health`, and contains no dev dependencies or secrets.

## 3. Run migrations (before every deploy)

Migrations run as a one-off Fargate task from the `migrate` image, in the private subnets, with `DATABASE_URL` set from the **master** secret:

1. Register a task definition `xatu-staging-migrate` once: image `$REPO:migrate-$TAG`, execution role as above, secret `DATABASE_URL` → `xatu/staging/MIGRATION_DATABASE_URL`, logs to `/xatu/staging/api` with prefix `migrate`.
2. Run it with the new image tag and wait for it to exit with code 0:
   ```bash
   aws ecs run-task --region ap-south-1 --cluster xatu-staging --launch-type FARGATE \
     --task-definition xatu-staging-migrate \
     --network-configuration "awsvpcConfiguration={subnets=[subnet-PRIVATE1,subnet-PRIVATE2],securityGroups=[sg-API],assignPublicIp=DISABLED}"
   aws ecs wait tasks-stopped --region ap-south-1 --cluster xatu-staging --tasks <task-arn>
   ```
3. If it fails, **stop**. Do not deploy the new image.

**Migrations must be backwards compatible (expand, then contract).** The currently running image must keep working against the migrated database, so a rollback never needs a down-migration. For example: add a nullable column in release N, start writing it in N, backfill, and only drop the old column in N+2.

## 4. Create the service (first time)

```bash
aws ecs create-express-gateway-service --region ap-south-1 \
  --cluster xatu-staging \
  --service-name xatu-staging-api \
  --execution-role-arn arn:aws:iam::$ACCOUNT:role/xatu-staging-ecs-execution \
  --infrastructure-role-arn arn:aws:iam::$ACCOUNT:role/xatu-staging-ecs-infrastructure \
  --health-check-path /health \
  --cpu 512 --memory 1024 \
  --network-configuration "subnets=subnet-PRIVATE1,subnet-PRIVATE2,securityGroups=sg-API" \
  --scaling-target "minTaskCount=1,maxTaskCount=4,autoScalingMetric=AVERAGE_CPU,autoScalingTargetValue=60" \
  --primary-container '{
    "image": "'$REPO:$TAG'",
    "containerPort": 3000,
    "awsLogsConfiguration": { "logGroup": "/xatu/staging/api", "logStreamPrefix": "api" },
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "PORT", "value": "3000" },
      { "name": "TRUST_PROXY", "value": "1" }
    ],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/DATABASE_URL" },
      { "name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/REDIS_URL" },
      { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/JWT_SECRET" },
      { "name": "FIREBASE_PROJECT_ID", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/FIREBASE_PROJECT_ID" }
    ]
  }'
```

Notes:

- `NODE_ENV=production` is required. The API refuses to start if `AUTH_DEV_BYPASS=true` in production; never set it on staging or prod at all.
- `TRUST_PROXY=1` makes rate limits see the real client IP behind the load balancer.
- Production: `minTaskCount=2` across two AZs.
- Point a custom domain (for example `api.<your-domain>`) at the service URL with an ACM certificate in ap-south-1.
- For revoked-Firebase-token checks in production, add a Google service-account key as another secret and set `GOOGLE_APPLICATION_CREDENTIALS` (see `docs/firebase-setup.md`).

## 5. Deploy a new version

1. CI is green on `main`.
2. Build and push `$REPO:$TAG` and `$REPO:migrate-$TAG` (step 2).
3. Run migrations (step 3).
4. Point the service at the new image:
   ```bash
   aws ecs update-express-gateway-service --region ap-south-1 --cluster xatu-staging \
     --service-name xatu-staging-api --primary-container '{ ...same as above with "image": "'$REPO:$TAG'" ... }'
   ```
   ECS rolls tasks over and only shifts traffic once `/health` passes.
5. Check `/health`, the CloudWatch logs and Sentry (once added), then repeat for production.

## Rollback

- **Bad image:** run `update-express-gateway-service` again with the **previous tag** (images are immutable, so the old tag is exactly what ran before). Because migrations are expand-only, the old image works against the current database.
- **Bad data or migration:** restore RDS with point-in-time recovery to a new instance, verify it, then switch `DATABASE_URL` to it. Never edit ledger rows by hand; fix money mistakes with reversing entries.

## Checklist before the first real user

- [ ] Staging and prod in separate accounts or VPCs, with separate secrets and Firebase projects
- [ ] RDS: private, encrypted, Multi-AZ (prod), PITR on, restore rehearsed
- [ ] App user without DDL rights; migrations with the master user only
- [ ] `AUTH_DEV_BYPASS` absent everywhere outside laptops
- [ ] Alarms: 5xx rate, `/health` failures, RDS CPU and storage, and payment-webhook failures (once payments exist)
- [ ] Budget alert on the AWS account
