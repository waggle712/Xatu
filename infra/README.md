# infra

Local PostgreSQL 16 (with PostGIS, pg_trgm, citext) and Redis 7 for development.

```bash
pnpm db:up     # start both containers and wait until healthy
pnpm db:down   # stop them (data is kept in Docker volumes)
pnpm db:reset  # stop and delete the local data volumes
```

| Service  | Host port | Connection                                         |
| -------- | --------- | -------------------------------------------------- |
| Postgres | 5434      | `postgresql://xatu:xatu_local@localhost:5434/xatu` |
| Redis    | 6380      | `redis://localhost:6380`                           |

Ports and credentials can be changed in `infra/.env` (copy `infra/.env.example`). These are local-only values; staging and production secrets live in AWS Secrets Manager.
