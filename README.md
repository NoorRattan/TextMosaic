# TextMosaic

TextMosaic turns text into an interactive 3D knowledge graph. Its named-entity and relation models are trained from random initialization on CoNLL04; inference never calls a hosted language model or loads pretrained language weights.

## Run locally

Prerequisites: Python 3.11 or newer, Node.js 24 or newer, and Docker Desktop for the container workflow.

```powershell
Copy-Item .env.example .env
# Optionally set TEXTMOSAIC_DATA_DIR in .env to an external writable location.
Copy-Item frontend\.env.example frontend\.env.local
# Set VITE_API_BASE_URL in frontend\.env.local when the API is hosted elsewhere.

py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install --requirement backend\requirements-lock.txt
.\.venv\Scripts\python -m pytest backend\tests -q

cd frontend
npm ci
npm run build
cd ..
```

The repository includes trained checkpoints. To train fresh, self-initialized weights from the source dataset:

```powershell
.\.venv\Scripts\python -m backend.model.train --export-directory backend\checkpoints
```

For the local two-service workflow:

```powershell
docker compose up --build
```

Open `http://localhost:5173`. The frontend calls `http://localhost:7860`; the backend health endpoint is `http://localhost:7860/health`.

For a deployed frontend, set `VITE_API_BASE_URL` at build time to the public FastAPI URL and add the exact frontend origin to the backend's `ALLOWED_ORIGINS` allow-list. The value is public configuration, not a secret.

## API

`POST /extract` accepts text and an optional tier. `GET /tiers` reads the available tiers from the backend configuration, and `GET /health` is a minimal liveness endpoint.

```json
{"text":"Ada joined Acme.","tier":"balanced"}
```

The response uses the CoNLL04-aligned `tokens`, `entities`, and `relations` fields. Entity spans are token-indexed and end-exclusive; relation heads and tails index the returned entities array.

## Validation snapshot

The committed checkpoints were selected on the validation split after controlled seed and learning-rate experiments. Entity F1 requires an exact predicted entity type and span. Gold-span relation F1 isolates the relation head by supplying gold entity spans; end-to-end relation F1 is the stricter pipeline result using the NER head's predicted spans.

| Tier | Entity F1 | Gold-span relation F1 | End-to-end relation F1 |
|---|---:|---:|---:|
| speed | 0.5181 | 0.5111 | 0.3012 |
| balanced | 0.5549 | 0.4913 | 0.3815 |
| accuracy | 0.6307 | 0.5676 | 0.3768 |

## Final test snapshot

The test split was held out from checkpoint selection and used for final reporting.

| Tier | Entity F1 | Gold-span relation F1 | End-to-end relation F1 |
|---|---:|---:|---:|
| speed | 0.5499 | 0.4834 | 0.3123 |
| balanced | 0.5831 | 0.5034 | 0.3556 |
| accuracy | 0.6445 | 0.5807 | 0.4019 |

## Checks

```powershell
.\.venv\Scripts\python -m pytest backend\tests -q
cd frontend; npm run lint; npm run test; npm run build
```

The CI workflow runs formatting, static checks, dependency auditing, backend tests, frontend checks, and production build verification.
