# BUILD PROGRESS — TextMosaic

## Status: Local project build complete — ready for repository publishing and deployment configuration

## Sessions completed: 5

## Planned vs. actual
| Stage | Planned | Actual | Status |
|---|---|---|---|
| Data pipeline (loader, vocab, Dataset) | Session 1 | Live CoNLL04 loader, train-only vocabulary, BIO validation, and sentence-scoped gold relation candidates | Complete |
| NER head training | Session 2 | Randomly initialized shared-BiLSTM NER head, deterministic decoding, and initialization coverage | Complete |
| RE head + joint loss | Session 3 | Directed relation head, complete per-sentence candidate enumeration, class-imbalance handling, and three trained checkpoints | Complete |
| FastAPI + Docker | Session 4 | Stateless API, CORS, rate limiting, error envelopes, Docker images, compose setup, and backend coverage | Complete locally |
| React frontend + deploy | Session 5 | Typed Vite UI, lazy 3D graph renderer, frontend coverage, and local browser verification | Complete locally; external deployment pending |

## Current repo state
- Approved Files 00–04 remain under `docs/`; File 02–04 were corrected where live verification exposed concrete drift.
- `backend/checkpoints/` contains the self-trained `speed.pt`, `balanced.pt`, and `accuracy.pt` files used by the Docker image.
- The backend includes typed model, training, inference, API, container, and test modules.
- The frontend contains the Vite React application, its lockfile, typed API boundary, responsive styling, and a deferred `react-force-graph-3d` graph view.
- `.env.example`, Docker Compose, README, and CI are present for a clean local setup.

## Validation
- Real CoNLL04 loading completed for all 1,441 records. The train-only vocabulary contains 6,677 entries including the two reserved tokens.
- All three trained checkpoints were exercised through the live API. A real balanced extraction returned 10 tokens, 3 entities, and 3 relations; the browser also rendered a live accuracy-tier graph with 3 entities and 2 relations.
- Backend: 6 `pytest` checks pass. Frontend: type check, formatting check, 1 Vitest check, and production build pass.
- Dependency audit reports no known vulnerabilities. Python lint and format checks pass.
- Validation metrics are documented in `README.md`, explicitly separating gold-span relation behavior from the end-to-end predicted-span pipeline.

## Known open risk
No Hugging Face Space, Cloudflare Pages project, or usable GitHub remote branch has been provided. The local build is complete, but publishing and deployment cannot be verified until those external targets exist and their configuration is supplied.

## What's next
Publish the local commits to the GitHub repository, create or identify the Hugging Face Docker Space and Cloudflare Pages project, then add the production Pages URL to `ALLOWED_ORIGINS` and verify the deployed browser path.
