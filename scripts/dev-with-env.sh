#!/bin/sh
set -eu

if [ -f .env ]; then
  exec pnpm exec electron-vite dev
fi

exec infisical run \
  --silent \
  --domain http://192.168.60.11:8080 \
  --projectId f0772027-6fdb-4127-85f9-af0ca1737a9f \
  --env dev \
  --path / \
  -- pnpm exec electron-vite dev
