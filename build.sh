#!/usr/bin/env bash
# Runs on Netlify during deploy. Turns the SUPABASE_URL / SUPABASE_ANON_KEY
# environment variables (set in the Netlify site dashboard, never in this
# repo) into config.js, which index.html loads.
set -euo pipefail

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "SUPABASE_URL and/or SUPABASE_ANON_KEY are not set in Netlify's environment variables." >&2
  exit 1
fi

cat > config.js <<EOF
window.MUMSIE_CONFIG = {
  url: "${SUPABASE_URL}",
  anonKey: "${SUPABASE_ANON_KEY}"
};
EOF

echo "Wrote config.js"
