#!/bin/sh
set -eu

required_keys="SONARR_URL SONARR_API RADARR_URL RADARR_API"

if [ -f .env ]; then
  exec node --env-file=.env scripts/check-required-env.mjs $required_keys
fi

exec infisical run \
  --silent \
  --domain http://192.168.60.11:8080 \
  --projectId f0772027-6fdb-4127-85f9-af0ca1737a9f \
  --env dev \
  --path / \
  -- node scripts/check-required-env.mjs $required_keys
