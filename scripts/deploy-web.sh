#!/usr/bin/env bash
set -euo pipefail

if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI missing. Install via \"npm i -g vercel\"." >&2
  exit 1
fi

vercel pull --yes --environment=production
vercel deploy --prod
