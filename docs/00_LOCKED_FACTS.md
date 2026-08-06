# FILE 00 — LOCKED FACTS — TextMosaic

**Every other file and session prompt must copy these values character-for-character. Do not restate or paraphrase them elsewhere.**

## Scale Check
**Mode: STANDARD** — multi-session personal build, no external grading rubric, but genuinely
multi-stage (data pipeline → model training → API → frontend → deployment), so it's more than a
weekend LITE build and doesn't warrant FULL's formal audit-script overhead.

Under STANDARD this project uses: File 00 (this file), Files 01–04, session prompts, and a Build
Progress file. No Master Context file and no Files 05–08 — the Minimum Testing Floor and domain
data instead live inline in Files 01 and 03 below, per the framework's rule that STANDARD mode
still owes real coverage, just not a dedicated file for it.

## Project Identity
| Field | Value |
|---|---|
| App name | TextMosaic |
| Repo | https://github.com/NoorRattan/TextMosaic.git |
| Branch | `main` *(assumed default — tell me if you use something else)* |
| Cloud project ID | none (no GCP/AWS project — Spaces + Pages need no project ID) |

## Tech Stack
**Backend** — Python 3.11+, fully type-hinted · PyTorch (self-trained model; **zero pretrained
weights** in the NER/RE core) · FastAPI + Uvicorn · Hugging Face `datasets` library used *only* to
pull the CoNLL04 training data — a data source, not a model dependency.

**Frontend** — React + Vite, TypeScript `strict` mode · `react-force-graph-3d` (Three.js-based) for
the 3D graph view · native `fetch` for API calls.

**Deployment** — Backend: Hugging Face Spaces, Docker SDK, listens on port 7860, model weights
**baked into the image** (Spaces' disk resets on every restart, so downloading at runtime would
mean re-downloading on every cold start — verified earlier in this conversation). Frontend:
Cloudflare Pages. One Dockerfile per service; `docker-compose.yml` for local dev so a fresh
`git clone` + `docker compose up` works on someone else's laptop.

## Model Architecture — three tiers, all trained from scratch on CoNLL04
| Tier | Embedding dim | BiLSTM hidden dim | Layers |
|---|---|---|---|
| speed | 100 | 64 | 1 |
| balanced | 200 | 128 | 1 |
| accuracy | 300 | 256 | 2 |

No tier uses pretrained embeddings (e.g. GloVe) or pretrained weights of any kind — all three start
from random initialization and are trained only on CoNLL04.

## Head Architecture (locked)
**Joint — one shared BiLSTM, two heads** (not a two-model pipeline). Chosen because CoNLL04 is
small (~900–1,150 training sentences depending on split), and a shared encoder acts as implicit
regularization across both tasks; a two-model pipeline would also double inference cost across all
three model tiers above.

- **NER head:** per-token BIO tagging on top of the shared BiLSTM output — tag set
  `B-Peop, I-Peop, B-Org, I-Org, B-Loc, I-Loc, B-Other, I-Other, O`. Greedy argmax decoding for v1;
  no CRF layer.
- **RE head:** mean-pool each candidate entity span's token representations, concatenate the pair,
  classify via linear + softmax over the five relation types plus a `no_relation` class.
- **Candidate pairs:** train the RE head on **gold** entity pairs; infer using the **NER head's own
  predicted** spans. (This means inference-time error cascade — a missed entity means a missed
  relation — is still possible even in this joint architecture. Joint training fixes shared
  representations, not that specific failure mode.)
- **Loss:** `loss = loss_ner + loss_re`, equal weighting for v1 — not tuned further unless model
  quality falls short after Day 3.
- **Batching:** RE candidate pairs are processed per-sentence, not batched across sentences, for v1.

## Local Paths (dev machine convention)
Your C: drive is full, so large/generated artifacts are redirected off it. To keep the repo
portable for anyone else who clones it, this is done via an env var with a relative default, not
a hardcoded path in any script:

| What | Where | How it's referenced in code |
|---|---|---|
| Git repo clone (everything tracked by git — code, docs, configs) | `N:\Github-Repo\textmosaic` | N/A — this is just where you `git clone` to |
| Everything else (raw CoNLL04 cache, model checkpoints, training logs, venv) | `N:\training data` | `TEXTMOSAIC_DATA_DIR` env var, set in your local `.env` (gitignored) |

Scripts read `TEXTMOSAIC_DATA_DIR` with a default of `./data` (a relative path) if the env var
isn't set — so someone else cloning the repo without an N: drive still gets a working default,
and your machine just overrides it via `.env`. `.env.example` in the repo documents the variable
name with a placeholder value; your real `.env` with the actual `N:\training data` path never gets
committed, per the Absolute Prohibitions below.

## Domain Vocabulary (from CoNLL04's actual schema — use these exact strings everywhere, not
synonyms)
- **Entity types:** `Peop`, `Org`, `Loc`, `Other`
- **Relation types:** `Located_In`, `Work_For`, `OrgBased_In`, `Live_In`, `Kill`
- **Field names (API/JSON, snake_case, matches CoNLL04's own schema):** `tokens`, `entities`,
  `relations`, `type`, `start`, `end`, `head`, `tail`
- **Frontend/TS variables:** camelCase, with one conversion layer at the fetch boundary — never
  leak snake_case into React component props.

## Color Scheme (a default — say the word if you want different ones)
| Role | Hex |
|---|---|
| Background | `#0B0F14` |
| Entity nodes | `#2DD4BF` |
| Relation edges | `#FB7185` |
| Text / neutral | `#94A3B8` |

## Portfolio Priorities (no external rubric, so this replaces a weights table)
1. **HIGH** — Authenticity: zero pretrained weights anywhere in the NER/RE core.
2. **HIGH** — End-to-end working demo: deployed site + a `git clone` that actually runs locally.
3. **HIGH** — Code quality: typed, documented, no dead code, professional commits.
4. **HIGH** — Model quality: honestly-reported, reasonable (not SOTA) F1 on the CoNLL04 test split.
5. **HIGH** — Visual polish: the graph view needs to look and feel finished, not just function.

## Minimum Testing Floor
Priority #1 is what would break *silently* if untested: someone (or some AI-assisted refactor)
could accidentally point the model at a pretrained checkpoint, or the training loop could silently
no-op. Test approach:
- **Unit test:** asserts the embedding layer's weights are randomly initialized at construction —
  no checkpoint path, no `from_pretrained` call anywhere in the model class.
- **Integration test:** asserts relation-F1 on a small held-out slice strictly improves across at
  least 2 training epochs, proving the weights are actually updating rather than frozen or guessing.

Both must pass in CI before any deploy step runs.
