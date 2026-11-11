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

| Name                     | Value                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | app-user connection string (above)                                                                            |
| `MIGRATION_DATABASE_URL` | master-user connection string, used only by the migration task                                                |
| `REDIS_URL`              | `rediss://...`                                                                                                |
| `JWT_SECRET`             | `openssl rand -base64 48`, different per environment                                                          |
| `FIREBASE_PROJECT_ID`    | the matching Firebase project (`xatu-staging` / `xatu-prod`)                                                  |
| `SENTRY_DSN`             | the API's Sentry project DSN (also set `SENTRY_ENVIRONMENT` to `staging` or `production` as a plain variable) |
| `POSTHOG_API_KEY`        | PostHog project key (host: see `docs/analytics.md`)                                                           |

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
      { "name": "TRUST_PROXY", "value": "1" },
      { "name": "SENTRY_ENVIRONMENT", "value": "staging" }
    ],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/DATABASE_URL" },
      { "name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/REDIS_URL" },
      { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/JWT_SECRET" },
      { "name": "FIREBASE_PROJECT_ID", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/FIREBASE_PROJECT_ID" },
      { "name": "SENTRY_DSN", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/SENTRY_DSN" },
      { "name": "POSTHOG_API_KEY", "valueFrom": "arn:aws:secretsmanager:ap-south-1:'$ACCOUNT':secret:xatu/staging/POSTHOG_API_KEY" }
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

## Media (Cloudflare R2 + Image Transformations) and the worker

Photos go straight from the phone to a **private R2 bucket** using a signed, 15-minute, single-object URL that pins the content type and exact size. The API never proxies uploads.

1. In Cloudflare: create an R2 bucket `xatu-staging-media` (Asia-Pacific location hint), and an R2 API token scoped to that bucket with Object Read & Write. Store `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in Secrets Manager.
2. Connect a custom domain to the bucket (for example `img-staging.<your-domain>`) and turn on **Image Transformations** for that zone. Set `MEDIA_PUBLIC_BASE_URL=https://img-staging.<your-domain>`. Variants are URL transforms (`/cdn-cgi/image/width=320|800|1600,...`), so only the cleaned original is stored.
3. Bucket CORS: allow `PUT` from the app (mobile apps send no Origin, so no browser CORS rule is needed unless an admin web upload is added).
4. Set `MEDIA_STORAGE=r2` and `PUBLIC_API_URL=https://api-staging.<your-domain>` on both containers.

**Worker container.** Media processing runs in BullMQ jobs. Run a second ECS service from the same image with command `node dist/src/worker.js` and `RUN_WORKERS=true`; set `RUN_WORKERS=false` on the API service. The worker needs the same secrets (database, Redis, R2) and no load balancer. Failed jobs are retried 5 times with exponential backoff, then moved to the `media-dead-letter` queue, the photo is marked `rejected` (`processing_failed`) and a Sentry alert is raised. Replay a dead-lettered job only after fixing the cause.

## Share links (universal links and App Links)

Share links look like `https://<web domain>/p/<product id>` and `/s/<shop handle>`. The API serves both the preview pages and the link files, so point the web domain (or just its `/p/*`, `/s/*` and `/.well-known/*` paths) at the API service. No redirects on `/.well-known/`: iOS and Android refuse them.

1. API settings: `PUBLIC_WEB_URL=https://<web domain>`, `APPLE_TEAM_ID` (Apple Developer > Membership), `ANDROID_CERT_SHA256` (Play Console > App integrity > App signing key certificate, SHA-256; add the upload key too, comma separated, if testers install builds signed with it), optional `APP_STORE_URL`.
2. App build: `EXPO_PUBLIC_WEB_URL=https://<web domain>` in the EAS build profile. It adds `applinks:<domain>` (iOS) and verified intent filters for `/p/` and `/s/` (Android), so a new native build is needed.
3. Check: `curl -i https://<web domain>/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` return `200` with `application/json`; then Google's Statement List tester and, on a phone, tap a link in WhatsApp.

Until this is done, links open the web preview page, which has an "Open in app" button.

## Payments (Razorpay, test mode only)

No real money until the pre-launch tests (prompt 22) pass and the lawyer and CA sign off. The API refuses to start with a live key (`rzp_live_`) or any non-test key.

1. Razorpay Dashboard in **Test mode** → Account & Settings → API keys: put `RAZORPAY_KEY_ID` (`rzp_test_…`) and `RAZORPAY_KEY_SECRET` in AWS Secrets Manager for the API **and the worker** container.
2. Dashboard → Webhooks → Add: URL `https://<api domain>/webhooks/razorpay`, a strong secret (store as `RAZORPAY_WEBHOOK_SECRET`), events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed` (without the refund events, refunds still complete through the 10-minute poller).
3. Account & Settings → Payment capture: keep **automatic capture** on (the default). Xatu verifies only `captured` payments; an authorized-but-never-captured payment is refunded by Razorpay automatically.
4. The worker container (`RUN_WORKERS=true`) runs the webhook processor, the outbox relay (every 2 s) and the payments poller (every minute). Without it, webhooks are stored but nothing is processed.
5. Check: make a test payment with UPI `success@razorpay`; the order becomes `placed` within seconds. Then re-record the webhook fixtures in `apps/api/test/fixtures/razorpay` from the real deliveries.

## Ledger: database role, nightly jobs, finance commands (prompt 16)

**The app connects as a restricted user.** Migrations create a `xatu_app` role (no login) that may only SELECT and INSERT on the ledger tables (`ledger_accounts`, `ledger_transactions`, `ledger_entries`) and do normal reads and writes elsewhere. Migrations keep running as the owner.

1. Deploy order: run the migration (as the owner) BEFORE switching the app's `DATABASE_URL`. Then once, as the RDS owner (the migration user needs `CREATEROLE`; the migration is one transaction, so without it nothing is applied): `CREATE ROLE xatu_api LOGIN PASSWORD '<from Secrets Manager>' IN ROLE xatu_app;`. Never put this password in a migration or the repo.
2. API and worker containers: `DATABASE_URL` uses `xatu_api`. The migration task keeps the owner's URL.
3. A future migration that adds a ledger table must `REVOKE UPDATE, DELETE` on it from `xatu_app` (default privileges grant them).

**Nightly jobs** (worker container, India time): 01:00 settlement batches (orders completed more than 48 hours ago); 02:00 reconciliation with yesterday's Razorpay settlement report, then the ledger completeness check. Mismatches go to Sentry once each and are kept in `reconciliation_issues`.

**Finance commands** (an ECS one-off task on the API image; until the admin console, access is controlled by AWS IAM). The person must be an active user with the `admin` role; every action needs a reason and is written to `admin_audit_logs`:

```
node dist/src/cli/finance.js list
node dist/src/cli/finance.js approve --admin-phone +91XXXXXXXXXX --reason "Checked" <batchId> ...
node dist/src/cli/finance.js export --admin-phone +91XXXXXXXXXX --reason "Bank upload" --out payouts.csv
node dist/src/cli/finance.js re-export --admin-phone +91XXXXXXXXXX --reason "File lost" --out again.csv <batchId> ...
node dist/src/cli/finance.js mark-paid --admin-phone +91XXXXXXXXXX --reason "Sent" --reference <UTR> <batchId>
```

The CSV has no bank details until seller KYC (prompt 19), so it can't drive a real transfer yet. No Razorpay Route transfers.

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
