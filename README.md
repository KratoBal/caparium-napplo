# Cápárium nAPPló

Browser-based measurement log for the Budapest Zoo Cápárium: daily and weekly water measurements,
later feeding logs. Tablet first (iPadOS Safari), desktop browsers too.

The business rules come from the project documents (requirements v2, logical data model v1,
decision log). Requirement IDs (ÁLT-xx, VIZ-xx, …) and data-model rules (K1–K9, R-xx, T-xx) are
referenced in the code where a rule is implemented.

## Technical decisions

- **Next.js 16 (App Router) + TypeScript**, server-rendered pages, JSON API routes for the grid.
  One deployable, no separate API service.
- **PostgreSQL + Prisma 6.** Rules Prisma cannot express are in the migration SQL: one valid value per
  grid cell (partial unique index, T-02) and an append-only audit table (triggers reject
  UPDATE/DELETE/TRUNCATE, K6).
- **Own session login** (scrypt password hash, random token in an httpOnly SameSite=Lax cookie, only its
  hash in the database, same-origin check on every write). No external identity provider.
- **Optimistic concurrency** (version per record), **idempotent writes** (client request id), and a
  **local retry queue** in the browser for short network drops (ÁLT-03, ÁLT-15). No silent overwrite.
- **Exact decimals** (Decimal columns, string arithmetic in the app; K8). Business day in
  Europe/Budapest with the midnight boundary (K2); late saves after midnight follow K9.
- **docker compose** (app + its own PostgreSQL). No database is shared with any other system.

## Run

```bash
cp .env.example .env      # set POSTGRES_PASSWORD and SEED_TEST_PASSWORD
docker compose up -d --build --wait app
docker compose --profile tools run --rm seed   # synthetic test users and master data
# http://127.0.0.1:3000  (APP_BIND / APP_PORT in .env to change)
scripts/backup.sh ./backups                     # dump + restore check
```

Test users (password: `SEED_TEST_PASSWORD`): `teszt.admin` (adminisztrátor),
`teszt.akvarista1`, `teszt.akvarista2` (akvarista). All seed data is synthetic.

## Development and tests

```bash
npm ci && npx prisma generate
DATABASE_URL=postgresql://…/caparium_test npm run test:integration   # resets the *_test database
npm test                 # unit tests
npm run typecheck
npm run build && SEED_TEST_PASSWORD=… npx playwright test           # needs a migrated, seeded DB
npm run secret-scan      # no secrets, no customer documents in the repo
```

CI runs all of the above, the migration drift check, Playwright on WebKit (tablet 1024×768, touch)
and Chromium (desktop 1440×900), and a docker compose start with a backup restore check.

## Temporary settings (not final business rules)

- Reference ranges in the seed are **placeholder test values**; the admin sets the real ones.
- Pool groups follow the NY-03 default: "Nagy medencék" = Nagymedence, Kismedence, Karantén;
  "Kismedencék" = Korallos, Inkubátor, Ragadozós; Kis sózó and Sózó have no water measurement.
- Late-save grace period: 30 minutes (setting `late_save_grace_minutes`, K9).
- Trainee (NY-14 / T-06): no own login; "Gyakornok végezte" flag on the measurement.

## Status

First working part: login → pool group → record a daily measurement → saved → log with history.
Weekly measurement, admin correction UI, closing/reopening days, Excel and ZIMS CSV exports follow
in the next parts.
