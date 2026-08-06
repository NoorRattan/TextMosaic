# FILE 02 — COMPLETE FILE STRUCTURE — TextMosaic

```
textmosaic/                          (clones to N:\Github-Repo\textmosaic locally)
├── .env.example
├── .gitignore
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
│   ├── main.py                       # FastAPI app entrypoint, mounts routes, CORS middleware
│   ├── config.py                     # reads env vars: TEXTMOSAIC_DATA_DIR, ALLOWED_ORIGINS, PORT
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
│   │   ├── train.py                  # training loop; loss = loss_ner + loss_re; writes checkpoints to TEXTMOSAIC_DATA_DIR during training, then copied into backend/checkpoints/ for the Docker build
│   │   └── inference.py              # loads a tier's .pt, runs NER decode, builds RE candidate pairs from predicted spans, classifies
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py                 # POST /extract, GET /health, GET /tiers
│   │   └── schemas.py                # pydantic models — field names match File 00 domain vocabulary exactly
│   └── tests/
│       ├── test_model_init.py        # Minimum Testing Floor: asserts random init, no checkpoint loaded at construction
│       ├── test_training_updates.py  # Minimum Testing Floor: asserts relation-F1 improves over >=2 epochs
│       └── test_api.py               # /extract, /health, /tiers smoke tests
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    ├── Dockerfile                    # local-dev parity only; production build is static, served by Cloudflare Pages
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/client.ts             # fetch wrapper; see File 03 for the (currently trivial) snake_case->camelCase mapping
        ├── components/
        │   ├── TextInput.tsx
        │   ├── TierSelector.tsx      # populated from GET /tiers, not a hardcoded second copy of the tier list
        │   └── GraphView.tsx         # react-force-graph-3d wrapper
        └── styles/theme.ts           # the four hex codes from File 00 — imported, never re-typed
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

**Frontend (`package.json`):** `react>=18`, `vite>=5`, `typescript>=5.5`, `react-force-graph-3d`
(latest at install time), `three` (peer dependency of `react-force-graph-3d`)

## Environment Variables
| Var | Where used | Default | Notes |
|---|---|---|---|
| `TEXTMOSAIC_DATA_DIR` | `conll04_loader.py`, `train.py` | `./data` | Your local override goes in `.env`: `N:\training data` |
| `ALLOWED_ORIGINS` | `main.py` CORS middleware | `http://localhost:5173` | Add the real Cloudflare Pages domain once it exists — **UNVERIFIED / TBD until frontend is deployed**, not invented here |
| `PORT` | `Dockerfile` CMD, `uvicorn` | `7860` | Locked — HF Spaces Docker SDK requirement |
| `MODEL_TIER_DEFAULT` | `routes.py` | `balanced` | Used when a request omits `tier` |
