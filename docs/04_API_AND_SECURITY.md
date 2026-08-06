# FILE 04 — API AND SECURITY — TextMosaic

## Endpoints

### `POST /extract`
Request/response bodies: see File 03. Runs the shared BiLSTM + NER head + RE head for the
requested tier (File 00 Head Architecture) and returns entities + relations.
- **Test coverage:** happy path (valid text + each of the 3 tiers) · validation error (empty text,
  invalid tier) · error path (text over the length limit) — see `backend/tests/test_api.py`.

### `GET /tiers`
Returns the 3 tier names + short descriptions, read live from `model/tiers.py` (File 02) — this is
what `TierSelector.tsx` populates itself from, so the tier list only ever exists in one place.
```json
{ "tiers": [
  {"name": "speed", "description": "Fastest, lowest accuracy"},
  {"name": "balanced", "description": "Default — a middle ground"},
  {"name": "accuracy", "description": "Slowest, highest accuracy"}
]}
```

### `GET /health`
`{"status": "ok"}` — a lightweight process-liveness check. It intentionally does not eagerly
load all model checkpoints, so a deployment should also exercise `POST /extract` before it is
considered model-ready.
- **Test coverage:** returns 200 with the expected body.

## Error format
```json
{ "error": { "code": "validation_error", "message": "text must not be empty" } }
```
- 422 — pydantic validation failures (empty text, bad tier value, over length limit)
- 500 — unexpected inference errors (logged server-side, generic message returned to the client)

## CORS
`ALLOWED_ORIGINS` env var (File 02), explicit allow-list — never `*`. The local default includes
`http://localhost:5173` (Vite dev default) and `http://127.0.0.1:5173` for loopback parity. The real Cloudflare Pages
production domain is **UNVERIFIED / TBD** — it doesn't exist yet, so it isn't guessed at here; it
gets added to `ALLOWED_ORIGINS` once the frontend is actually deployed, and this file gets updated
at that point.

## Rate limiting
A custom in-memory fixed-window limiter on `POST /extract` (30 requests per direct client address
per 60 seconds). It intentionally does not trust forwarded-IP headers; deploy a proxy-aware limiter
if the app later sits behind a trusted reverse proxy or serves real public traffic.

## CSP / security headers
This is a JSON API, not an HTML-serving app, so a full Content-Security-Policy is mostly moot —
standard headers (`X-Content-Type-Options: nosniff`, no `Server` header leaking version info) are
enough here.

## Ownership rules
**None — there are no user accounts in v1.** No auth, no per-user data, nothing to check ownership
of. Worth stating explicitly so nobody later wonders where the auth layer went missing; it was
never in scope, not an oversight.

## Env vars (cross-reference — full table lives in File 02)
`ALLOWED_ORIGINS`, `TEXTMOSAIC_DATA_DIR`, `PORT`, `MODEL_TIER_DEFAULT` — same four vars, same
meanings, no divergence from File 02.
