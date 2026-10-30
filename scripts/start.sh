#!/bin/sh
# Container start: migrations, the app role, the optional test seed, then the server.
# Every step is idempotent, so a restart or a redeploy repeats them safely.
#
# Two-role mode (MIGRATE_DATABASE_URL set, the compose default): migrations and the seed run
# as the table owner, the server as caparium_app, which cannot touch the audit triggers (K6).
# Without MIGRATE_DATABASE_URL everything runs as DATABASE_URL (local development only).
#
# The basic data step runs at every start; the seed runs only where CAPARIUM_TEST_SEED=on (the
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
# The test seed runs only on the explicit switch, never on the password alone: Coolify fills every
# SERVICE_PASSWORD_* the compose file names, SERVICE_PASSWORD_SEED included, so on a live system the
# password is never empty and would have created the test users there (release runbook 1.1, 2026-10-30).
#
# A failed test seed does not stop the app: it is test data, and a used test database can disagree with it (stage,
# 2026-10-30: the container restarted for an hour on a seed error). It is said aloud, and the CI compose job still
# requires "seed ok:".
if [ "${CAPARIUM_TEST_SEED:-}" = "on" ]; then
  if ! DATABASE_URL="$OWNER_URL" node dist/seed.cjs; then
    echo "start: TEST SEED FAILED (see above); the app starts without it" >&2
  fi
elif [ -n "${SEED_TEST_PASSWORD:-}" ]; then
  echo "start: test seed off (CAPARIUM_TEST_SEED is not on); the seed password alone does not run it" >&2
fi
exec node server.js
