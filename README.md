---
title: TextMosaic
emoji: 🧩
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# TextMosaic

TextMosaic turns dense text into an interactive, evidence-grounded knowledge map. Every concept can be opened for a plain-English explanation and an exact supporting quotation; every relationship stays directed and readable. It runs entirely on local model weights: a bundled document language model for broad passages and a self-trained CoNLL04 relation model for focused news-style extraction. It makes no third-party API calls and never sends source text to a third party.

## Start here — no technical knowledge needed

**[Open the TextMosaic product](https://noorrattan.github.io/TextMosaic/)**, type a sentence, choose a model tier, and press **Build knowledge graph**. You will see:

1. the concepts the map found;
2. a plain-English explanation and source quotation for each selected concept; and
3. the directed, labeled relationships supported by the text.

The product interface is the intended place to explore the interactive 3D
graph. **Document model** handles research abstracts, clauses, reports, and
multi-sentence passages using the bundled local language model. **Relation
model** uses the self-trained CoNLL-style entity/relation checkpoint when a
focused news-style extraction is more useful. Both paths run locally.

| Link | What it is for |
|---|---|
| [Open TextMosaic](https://noorrattan.github.io/TextMosaic/) | The finished product: write text, run a model, and explore its 3D knowledge graph. |
| [Source code](https://github.com/NoorRattan/TextMosaic) | The React frontend, FastAPI service, checkpoints, and deployment files. |
| [Automated checks](https://github.com/NoorRattan/TextMosaic/actions) | Builds, tests, and the full container smoke test run for every push to `main`. |

### Which model should I pick?

- **balanced** — start here. It is the default trade-off between speed and accuracy.
- **speed** — choose this when you want the quickest response.
- **accuracy** — choose this when finding entities is more important than response time.

## Run locally

Prerequisites: Python 3.11 or newer, Node.js 24 or newer, Git LFS, and Docker Desktop for the container workflow.

```powershell
git lfs install
git lfs pull
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

The backend image uses the CPU-only PyTorch wheel because the deployed API performs CPU inference; the full development lockfile remains available for dataset and training work.

Or start the services directly in two terminals:

```powershell
.\.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 7860
cd frontend
npm run dev -- --host 127.0.0.1
```

Open `http://localhost:5173`. The frontend calls `http://localhost:7860`; the backend health endpoint is `http://localhost:7860/health`.

## Deploy

### Hugging Face Space (complete demo)

This repository is a self-contained Docker Space: it builds the frontend,
starts the inference API privately, and serves both through one public URL. The
browser calls the same-origin `/api` route, so no public API URL or CORS setup
is required.

1. Create a **Docker** Space on Hugging Face.
2. Push this repository to that Space, including its Git LFS checkpoint files.
3. In **Settings → Variables**, set `ALLOWED_HOSTS` to the Space hostname (for
   example, `YOUR-SPACE.hf.space`). Do not add a protocol or path.
4. Wait for the Space build to complete, then open the Space URL. `GET /health`
   confirms both the public proxy and the API are ready.

The root `Dockerfile` is specifically for this single-Space demo. It does not
require any secrets. The existing `backend/Dockerfile` and `frontend/Dockerfile`
remain available for a two-service deployment.

### Separate frontend and backend services

The frontend API address is runtime configuration, not a Docker build argument. Before starting the two public services, configure these exact values in the hosting platform's environment-variable UI:

```text
# Backend service (your public Hugging Face Space host)
ALLOWED_HOSTS=YOUR-API-SPACE.hf.space

# Also include the exact public frontend origin; never use *.
ALLOWED_ORIGINS=https://YOUR_FRONTEND_DOMAIN

# Frontend container: public backend URL, with https.
VITE_API_BASE_URL=https://YOUR-API-SPACE.hf.space
```

The frontend image writes `runtime-config.js` when its container starts, so changing `VITE_API_BASE_URL` requires a frontend restart/redeploy but **not** an image rebuild. The application shows a configuration error instead of silently calling a visitor's localhost when this value is absent on a non-local site.

If the Space domain changes, update both `ALLOWED_HOSTS` and `VITE_API_BASE_URL`, then update `ALLOWED_ORIGINS` with the real frontend origin. These values are public configuration, not secrets.

### GitHub Pages release configuration

The product must target one canonical backend. For the combined Docker Space,
set these **GitHub repository variables** before deploying Pages:

```text
TEXTMOSAIC_API_BASE_URL=https://YOUR-DOCKER-SPACE.hf.space/api
TEXTMOSAIC_PUBLIC_API_ORIGIN=https://YOUR-DOCKER-SPACE.hf.space
```

The Pages workflow then smoke-tests both the public page and the local-model
API. If these variables are absent, the page deliberately shows a configuration
error rather than sending source text to a fallback service.

## API

`POST /extract` accepts text, an optional tier, and a local mode (`document` or
`extractor`). `document` is the default and uses the bundled local language
model; `extractor` uses the self-trained relation checkpoint. `GET /tiers`
reads the available extractor tiers, and `GET /health` is a minimal liveness
endpoint.

```json
{"text":"Ada joined Acme.","tier":"balanced","mode":"document"}
```

The response retains the CoNLL04-aligned `tokens`, `entities`, and `relations`
fields. Entity spans are token-indexed and end-exclusive; relation heads and
tails index the returned entities array. It also adds `concepts`,
`graph_relations`, and `analysis`; all graph items include verbatim source
evidence for the interface to display.

## Validation snapshot

The committed checkpoints were selected on the validation split after controlled seed and learning-rate experiments. Entity F1 requires an exact predicted entity type and span. Gold-span relation F1 isolates the relation head by supplying gold entity spans; end-to-end relation F1 is the stricter pipeline result using the NER head's predicted spans.

| Tier | Entity F1 | Gold-span relation F1 | End-to-end relation F1 |
|---|---:|---:|---:|
| speed | 0.5977 | 0.5094 | 0.3507 |
| balanced | 0.6131 | 0.5235 | 0.3944 |
| accuracy | 0.6684 | 0.5203 | 0.3816 |

## Final test snapshot

The test split was held out from checkpoint selection and used for final reporting.

| Tier | Entity F1 | Gold-span relation F1 | End-to-end relation F1 |
|---|---:|---:|---:|
| speed | 0.6439 | 0.4891 | 0.3539 |
| balanced | 0.6205 | 0.5392 | 0.3866 |
| accuracy | 0.6825 | 0.5327 | 0.4021 |

## Checks

```powershell
.\.venv\Scripts\python -m pytest backend\tests -q
cd frontend; npm run lint; npm run test; npm run build
```

The CI workflow runs formatting, static checks, dependency auditing, backend tests, frontend checks, and production build verification.
