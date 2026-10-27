#!/usr/bin/env bash
# First-time local setup for a fresh clone; safe to re-run (migrations and seed are idempotent).
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (22.12 or newer). Install it from https://nodejs.org and re-run." >&2
  exit 1
fi

if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'; then
  echo "Node.js 22.12 or newer is required; found $(node -v)." >&2
  exit 1
fi

echo "==> Installing dependencies"
npm install

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
fi

echo "==> Preparing local data folder"
mkdir -p data

echo "==> Generating the Prisma client (src/generated is not committed)"
npm run db:generate

echo "==> Applying database migrations"
npm run db:migrate

echo "==> Seeding the household catalog and system records"
npm run db:seed

echo
echo "Setup complete. Start the app with: npm run dev"
echo "Then open http://127.0.0.1:3000"
