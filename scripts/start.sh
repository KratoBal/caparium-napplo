#!/bin/sh
# Container start: migrations, the app role, the optional test seed, then the server.
# Every step is idempotent, so a restart or a redeploy repeats them safely.
#
# Two-role mode (MIGRATE_DATABASE_URL set, the compose default): migrations and the seed run
# as the table owner, the server as caparium_app, which cannot touch the audit triggers (K6).
# Without MIGRATE_DATABASE_URL everything runs as DATABASE_URL (local development only).
#
# The basic data step runs at every start; the seed runs only where SEED_TEST_PASSWORD is set (the
# test environment): it adds the test users and the synthetic master data that are missing. Neither
# changes existing rows.
set -eu
OWNER_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}"
DATABASE_URL="$OWNER_URL" node node_modules/prisma/build/index.js migrate deploy
if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  node dist/db-role.cjs
else
  echo "start: single-role mode, the server runs as the table owner (development only)" >&2
fi
# the basic data (units, parameters, pools, groups, feed types ...) at every start, without a password:
# a live system has no SEED_TEST_PASSWORD (task caparium-alapadat)
DATABASE_URL="$OWNER_URL" node dist/base-data.cjs
if [ -n "${SEED_TEST_PASSWORD:-}" ]; then
  DATABASE_URL="$OWNER_URL" node dist/seed.cjs
fi
exec node server.js
