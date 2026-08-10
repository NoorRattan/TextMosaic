#!/bin/sh
set -eu

# The browser and API share one public Space origin. This avoids exposing a
# second service and keeps the generated runtime configuration deployment-safe.
printf '%s\n' 'globalThis.__TEXTMOSAIC_CONFIG__ = { apiBaseUrl: "/api" };' \
  > /app/frontend-dist/runtime-config.js

uvicorn backend.main:app --host 127.0.0.1 --port 7861 &
backend_pid=$!

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

nginx -g 'daemon off;'
