# FILE 02 — COMPLETE FILE STRUCTURE — TextMosaic

```
textmosaic/                          (clones to N:\Github-Repo\textmosaic locally)
├── .env.example
├── .gitignore
├── BUILD_PROGRESS.md
├── pyproject.toml
├── docker-compose.yml
├── README.md
├── docs/
│   ├── 00_LOCKED_FACTS.md
│   ├── 01_PROJECT_OVERVIEW.md
│   ├── 02_FILE_STRUCTURE.md          (this file)
│   ├── 03_DATA_MODELS.md
│   └── 04_API_AND_SECURITY.md
├── .github/workflows/
│   └── ci.yml                        # lint -> format check -> security audit -> tests -> build
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── requirements-lock.txt
│   ├── main.py                       # FastAPI app entrypoint, mounts routes, CORS middleware
│   ├── config.py                     # reads env vars: TEXTMOSAIC_DATA_DIR, ALLOWED_ORIGINS, PORT, MODEL_TIER_DEFAULT
│   ├── checkpoints/                  # baked into image at build time — see warning below
│   │   ├── speed.pt
│   │   ├── balanced.pt
│   │   └── accuracy.pt
│   ├── data/
│   │   ├── __init__.py
│   │   ├── conll04_loader.py         # datasets.load_dataset("DFKI-SLT/conll04"); caches under TEXTMOSAIC_DATA_DIR
│   │   ├── vocab.py                  # builds token vocab from the training split only (never dev/test)
│   │   └── dataset.py                # PyTorch Dataset: BIO tag encoding + gold entity-pair sampling
│   ├── model/
│   │   ├── __init__.py
│   │   ├── architecture.py           # JointNERRE nn.Module — shared BiLSTM, NER head, RE head
│   │   ├── tiers.py                  # the 3-tier config table from File 00, as code — single source, not re-typed elsewhere
│   │   ├── train.py                  # training loop; loss = loss_ner + loss_re; writes selected checkpoints directly to backend/checkpoints/ by default
│   │   ├── inference.py              # loads a tier's .pt, runs NER decode, builds RE candidate pairs from predicted spans, classifies
│   │   └── decoding.py               # deterministic local tokenizer + shared BIO decoder
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py                 # POST /extract, GET /health, GET /tiers
│   │   └── schemas.py                # pydantic models — field names match File 00 domain vocabulary exactly
│   └── tests/
│       ├── test_model_init.py        # Minimum Testing Floor: asserts random init, no checkpoint loaded at construction
│       ├── test_training_updates.py  # Minimum Testing Floor: asserts relation-F1 improves over >=2 epochs
│       └── test_api.py               # /extract, /health, /tiers smoke tests
└── frontend/
    ├── .env.example                  # public build-time API base URL; copy to .env.local for a local override
    ├── package-lock.json
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    ├── Dockerfile                    # local-dev parity only; production build is static, served by Cloudflare Pages
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/client.ts             # fetch wrapper; see File 03 for the (currently trivial) snake_case->camelCase mapping
        ├── api/client.test.ts        # fetch-boundary conversion coverage
        ├── types.ts                  # frontend-only camelCase TypeScript interfaces
        ├── components/
        │   ├── TextInput.tsx
        │   ├── TierSelector.tsx      # populated from GET /tiers, not a hardcoded second copy of the tier list
        │   └── GraphView.tsx         # react-force-graph-3d wrapper
        └── styles/theme.css          # the four hex codes from File 00, applied globally
```

## Key Decisions
- Checkpoints are **baked into the Docker image** (`backend/checkpoints/*.pt` copied in at build
  time), not downloaded or trained at container startup — consistent with File 00's Deployment
  section and the ephemeral-disk fact about HF Spaces.
- `tiers.py` is the **single source of truth** for the 3 model configs. `TierSelector.tsx` reads
  them from the live `GET /tiers` endpoint rather than hardcoding a second copy — this is the kind
  of duplication the Schema Propagation Check below exists to catch.
- No ORM, no database driver anywhere in this tree — the API is genuinely stateless (File 01).

## Warnings / Patterns to Avoid
- Do **not** add a `from_pretrained(...)` call anywhere under `backend/model/` pointing at a
  Hugging Face model checkpoint — only `conll04_loader.py` is allowed to talk to the HF ecosystem,
  and only for the dataset, never a model.
- Do **not** import `torchtext` or load GloVe/word2vec vectors into the embedding layer — File 00
  locks all three tiers to random initialization.
- Do **not** let `client.ts` leak snake_case field names into React props — convert at the fetch
  boundary even though, today, the conversion happens to be a no-op (see File 03).

## Package Versions
Pinned as **minimums**, not exact patches — see File 01's Known Quirks for why. Exact resolved
versions are locked into a committed lockfile the first time `pip install` / `npm install` actually
runs (Session 1), which is the verified source of truth, not this document.

**Backend (`requirements.txt`):** `torch>=2.9`, `fastapi>=0.115`, `uvicorn>=0.30`, `datasets>=3.0`,
`pydantic>=2.8`, `pytest>=8.0`

**Frontend (`package.json`):** `react^19.2.8`, `vite^8.2.1`, `typescript^7.0.2`,
`framer-motion`, `react-force-graph-3d^1.29.1`, and `three^0.185.1`. Exact resolved transitive
versions are in `frontend/package-lock.json`.

## Environment Variables
| Var | Where used | Default | Notes |
|---|---|---|---|
| `TEXTMOSAIC_DATA_DIR` | `conll04_loader.py`, `train.py` | `./data` | Your local override goes in `.env`: `N:\training data` |
| `ALLOWED_ORIGINS` | `main.py` CORS middleware | `http://localhost:5173,http://127.0.0.1:5173` | Explicit local-dev allow-list. Add the real Cloudflare Pages domain once it exists — **UNVERIFIED / TBD until frontend is deployed**, not invented here |
| `PORT` | `Dockerfile` CMD, `uvicorn` | `7860` | Locked — HF Spaces Docker SDK requirement |
| `MODEL_TIER_DEFAULT` | `config.py`, `routes.py` | `balanced` | Loaded from `.env` before route configuration; used when a request omits `tier` |
| `VITE_API_BASE_URL` | `frontend/src/api/client.ts` | `http://127.0.0.1:7860` | Public build-time frontend API target. Set to the deployed backend URL before building the frontend. |
