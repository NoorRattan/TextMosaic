# BUILD PROGRESS — TextMosaic

## Status: Session 1 complete — data pipeline and dependency environment verified

## Sessions completed: 1

## Planned vs. actual
| Stage | Planned | Actual | Status |
|---|---|---|---|
| Data pipeline (loader, vocab, Dataset) | Session 1 | Config, CoNLL04 loader, training-only vocabulary, BIO/pair Dataset, environment example, ignore rules, and resolved dependency lock | Complete |
| NER head training | Session 2 | — | Not started |
| RE head + joint loss | Session 3 | — | Not started |
| FastAPI + Docker | Session 4 | — | Not started |
| React frontend + deploy | Session 5 | — | Not started |

## Current repo state
- Approved Files 00–04 are restored under `docs/` unchanged from their supplied copies.
- `backend/config.py`, `backend/requirements.txt`, and `backend/requirements-lock.txt` are present.
- `backend/data/` contains `__init__.py`, `conll04_loader.py`, `vocab.py`, and `dataset.py`.
- `.env.example` documents all four variables; `.gitignore` excludes local environment, cache, and Python-generated files.
- `frontend/` remains an empty skeleton, as planned for Session 5.

## Test counts / coverage
- No `pytest` files were added; model tests are intentionally deferred until the model class exists.
- Manual data-pipeline verification passed with the real CoNLL04 download: all three splits loaded, the training-only vocabulary built, BIO tags and directed gold entity pairs validated, self-pairs excluded, and overlapping spans rejected.
- `pip install --dry-run -r backend/requirements-lock.txt` resolved successfully in the clean Python 3.12 environment used to create the lockfile.

## Bugs found
None in the Session 1 implementation checks.

## Known open risk
The live CoNLL04 download and documented schema are now verified. Model initialization, training updates, API behavior, containers, and the frontend remain unimplemented and need their planned-session checks.

## What's next
Session 2: implement `model/architecture.py`, `model/tiers.py`, the first training-loop pass, and the random-initialization test required by File 00.
