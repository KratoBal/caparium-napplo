#!/bin/sh
# Container start: migrations, then the optional test seed, then the server.
# Every step is idempotent, so a restart or a redeploy repeats them safely.
# The seed runs only where SEED_TEST_PASSWORD is set (the test environment): it adds the
# synthetic users and master data that are missing, and never changes existing rows.
set -eu
node node_modules/prisma/build/index.js migrate deploy
if [ -n "${SEED_TEST_PASSWORD:-}" ]; then
  node dist/seed.cjs
fi
exec node server.js
