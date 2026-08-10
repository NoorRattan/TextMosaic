#!/bin/sh
set -eu

api_base_url="${VITE_API_BASE_URL:-}"
escaped_api_base_url=$(printf '%s' "$api_base_url" | sed 's/\\/\\\\/g; s/"/\\"/g')

printf 'globalThis.__TEXTMOSAIC_CONFIG__ = { apiBaseUrl: "%s" };\n' "$escaped_api_base_url" \
  > /usr/share/nginx/html/runtime-config.js
