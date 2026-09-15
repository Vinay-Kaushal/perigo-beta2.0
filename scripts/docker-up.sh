#!/usr/bin/env bash
# One command to run the whole stack: creates .env with strong secrets on first run, then builds and starts everything.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.docker.example .env
  secret() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }
  sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=$(secret)/; s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(secret)/; s/^DATA_ENCRYPTION_KEY=.*/DATA_ENCRYPTION_KEY=$(secret)/" .env && rm -f .env.bak
  echo "Created .env with generated secrets."
fi

# .env files created before 2FA/SSO existed lack the data encryption key; add one once.
if ! grep -q '^DATA_ENCRYPTION_KEY=.\+' .env; then
  key=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  if grep -q '^DATA_ENCRYPTION_KEY=' .env; then
    sed -i.bak "s/^DATA_ENCRYPTION_KEY=.*/DATA_ENCRYPTION_KEY=$key/" .env && rm -f .env.bak
  else
    printf '\nDATA_ENCRYPTION_KEY=%s\n' "$key" >> .env
  fi
  echo "Added DATA_ENCRYPTION_KEY to .env."
fi

docker compose up -d --build --wait "$@"
echo
echo "perigo is running:"
echo "  web       http://localhost:${WEB_PORT:-3000}"
echo "  api       http://localhost:${API_PORT:-4000}/ready"
echo "  websocket ws://localhost:${WS_PORT:-4001}"
echo
echo "Demo data (optional):  bun run docker:seed"
