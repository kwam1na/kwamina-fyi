#!/bin/sh
# Applies pending D1 migrations during a Cloudflare Workers build.
#
# Cloudflare runs the build command for every branch, not just the production
# one, but there is only one production database. Without this guard, pushing a
# branch would migrate the live schema for code that never ships — and a
# preview build has no way to undo it. So the migration runs only on the
# production branch; every other branch builds and uploads a preview version
# against the schema production already has.
#
# WORKERS_CI_BRANCH is injected by Workers Builds and is unset locally, so
# running this outside CI skips the migration too. `bun run deploy` remains the
# path that migrates from a developer machine.
set -e

PRODUCTION_BRANCH=main

if [ "$WORKERS_CI_BRANCH" != "$PRODUCTION_BRANCH" ]; then
  echo "Skipping production D1 migrations: branch '${WORKERS_CI_BRANCH:-<unset>}' is not '$PRODUCTION_BRANCH'."
  exit 0
fi

echo "Applying pending D1 migrations for '$PRODUCTION_BRANCH'."
bun run db:migrate:remote
