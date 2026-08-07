# FILE 01 — PROJECT OVERVIEW — TextMosaic

*All values below are copied character-for-character from File 00. If anything here looks
different from File 00, File 00 wins and this file has a bug.*

## Description
TextMosaic turns raw text into an interactive 3D knowledge graph: named entities become nodes,
relationships between them become labeled edges. Unlike API-wrapper tools in this space, every bit
of the actual language understanding — entity recognition and relation extraction — is a model
**trained from scratch by this project**, not called from a hosted AI provider.

## Portfolio Priorities (no external rubric — see File 00)
1. **HIGH** — Authenticity: zero pretrained weights in the NER/RE core.
2. **HIGH** — End-to-end working demo: deployed site + a `git clone` that actually runs locally.
3. **HIGH** — Code quality: typed, documented, no dead code, professional commits.
4. **HIGH** — Model quality: honestly-reported, reasonable (not SOTA) F1 on the CoNLL04 test split.
5. **HIGH** — Visual polish: the graph view needs to look and feel finished, not just function.

With all five HIGH, there's no "sacrifice a HIGH for a LOW" tiebreaker (see File 00's note on
this). The practical tiebreaker is build order: 1 and 2 are prerequisites for 3–5 even being
judgeable, so they're built first regardless of how much time is left.

## Tech Stack + Justification
| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn | Modern, typed JSON API; interactive API documentation is intentionally disabled in the deployed app |
| ML | PyTorch, self-trained BiLSTM + two heads | No pretrained weights — see File 00 Head Architecture |
| Data | HF `datasets` lib, CoNLL04 only | A data source, not a model — doesn't compromise Priority 1 |
| Frontend | React + Vite, TypeScript strict | Fast dev loop, strong typing catches schema drift early |
| 3D graph | `react-force-graph-3d` | Purpose-built for exactly this (force-directed 3D, Three.js-based) — not `@lnsy/network-visualization`, which does not appear to exist as a real package |
| Backend host | Hugging Face Spaces, Docker SDK | Free CPU tier has enough RAM for all 3 model tiers loaded at once; natural fit since training data tooling already lives in this ecosystem |
| Frontend host | Cloudflare Pages | Static hosting for the Vite build |

## Identifiers
- App name: **TextMosaic**
- Repo: `https://github.com/NoorRattan/TextMosaic.git`
- Branch: `main`

## Deployment Architecture
```
[ Cloudflare Pages ]  --(fetch, CORS)-->  [ HF Space: Docker, port 7860 ]
   React + Vite build                        FastAPI + 3 baked-in model checkpoints
   react-force-graph-3d                       (speed / balanced / accuracy)
```
No database. No user accounts. The API is stateless — nothing is persisted server-side between
requests. If that changes later, this section needs a revision, and so does File 03/04's "no
datastore" note.

## Prohibitions (verbatim — applies to every file and every commit)
- No evaluation scores, strategies, or "ROADMAP"/"MAXIMIZATION"/"SCORE" filenames.
- No raw prompt logs or session transcripts.
- No API keys, service account JSON, or `.env` files (only `.env.example`).
- No `# FIX #N`, `// UPDATED (Prompt 0N)`, or `TODO: implement`.
- No commit messages with "FIX #", "Prompt", "AI", "evaluator", "submission", or "score".
- Professional commit format: `feat: add feature`, `fix: resolve race`, `refactor: extract service`,
  `test: add coverage`, `docs: update guide`, `chore: bump version`, `style: apply formatting`.

## Implemented Visual Palette
The default palette in File 00 remains the semantic palette for graph entities and edges. The
implemented product interface uses the user-approved editorial palette below so the application is
not visually reduced to a generic dark dashboard.

| Role | Hex |
|---|---|
| Interface field | `#14221F` |
| Paper surface | `#F0E9DC` |
| Signal accent | `#D16243` |
| Secondary accent | `#D6DF94` |

## Typography
- UI text: **DM Sans** (a modern grotesque with robust small-text readability)
- Editorial display: **Instrument Serif** (used sparingly for product emphasis)
- Data and controls: **DM Mono**

## Known Quirks (platform-specific, verified earlier this conversation)
- HF Spaces Docker SDK expects the container listening on **port 7860** — `Dockerfile`'s `CMD` and
  `uvicorn --port` must say 7860, not 8000.
- HF Spaces' disk is ephemeral and **resets on every restart** — this is why model weights are
  baked into the image rather than downloaded at runtime (see File 00 Deployment).
- PyTorch's autograd computes gradients automatically (`loss.backward()`) — this is not a point of
  difference from a framework like Thinc; the real reason for choosing raw PyTorch here is
  architectural flexibility, not "PyTorch shows math that other libraries hide." Worth stating
  correctly if this shows up in any writeup.
- Package versions are pinned as **minimums** (e.g. `torch>=2.9`), not exact patch versions — a
  search for the current PyTorch release returned inconsistent version numbers across sources, so
  asserting a specific patch number here would be a confident guess, not a verified fact. The real
  resolved versions get locked into a committed lockfile at first install (Session 1), which is the
  actually-verified source of truth.
