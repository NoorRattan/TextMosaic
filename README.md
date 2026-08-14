# TextMosaic

TextMosaic turns dense text into an interactive knowledge map: concepts become
clickable nodes, explicit relationships become labeled directed edges, and each
item carries a verbatim source quote plus a template-based explanation.

**[Open the live product](https://noorrattan.github.io/TextMosaic/)**

## Private, free, and browser-only

TextMosaic is a static GitHub Pages app. It does not call a backend, an LLM, or
an AI API. A compact ONNX named-entity-recognition model, its tokenizer, and
its WebAssembly runtime are bundled with the site. They run in the visitor's
browser; pasted text is never uploaded.

The graph layer combines on-device named-entity signals with deterministic,
source-grounded relationship rules. This is intentional: every edge is
traceable to the sentence that supports it. TextMosaic does not call OpenAI,
Gemini, Claude, or any other public inference API, and it does not generate
unstated explanations or relationships.

The first map may take a moment while the browser loads roughly 23 MB of local
model/runtime assets. Later maps reuse the browser cache.

## Run locally

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. No environment variables or server process are
required.

## Deploy for free

GitHub Pages is the only deployment target:

```powershell
git push origin main
```

The Pages workflow builds `frontend/` with the `/TextMosaic/` base path and
publishes its static assets. The bundled model files are ordinary static files,
not Git LFS objects, because GitHub Pages does not serve Git LFS assets.

## Model provenance and scope

The included quantized model is the `model_int8.onnx` variant from
[`onnx-community/NeuroBERT-NER-ONNX`](https://huggingface.co/onnx-community/NeuroBERT-NER-ONNX),
used only as a downloaded static asset. Once the site is loaded, it makes no
request to Hugging Face or any other model host.

The released browser model is a bundled named-entity model, not a universal
medical, legal, physics, or research relation model trained by this project.
It can show source-grounded concepts from any pasted English passage and maps
only explicit relationship wording that its local rules recognize. It does not
make diagnoses, provide legal advice, or infer facts the source does not state.

The repository also contains a local FastAPI training prototype based on the
CoNLL04 news-style corpus. It is exercised by CI but is not part of the live
GitHub Pages request path. A genuinely broad self-trained relation model would
require a licensed, labelled multi-domain corpus and measured evaluation before
the product could honestly claim that coverage.

## CoNLL04 prototype validation scores

These are the metrics stored in the three local checkpoint files after
training with seed `29` for up to 30 CPU epochs. They are validation scores for
the news-style CoNLL04 prototype—not benchmark results for the browser model,
and not evidence of medical, legal, research, physics, or job-text coverage.

| Tier | Best epoch | NER F1 | Relation F1 with gold entity spans | End-to-end relation F1 with predicted entity spans |
| --- | ---: | ---: | ---: | ---: |
| speed | 14 | 59.8% | 50.9% | 35.1% |
| balanced | 23 | 61.3% | 52.3% | 39.4% |
| accuracy | 24 | 66.8% | 52.0% | 38.2% |

The gold-span relation score measures only relation classification when the
correct entity boundaries are supplied. The end-to-end score is the more
realistic pipeline measure because it includes entity detection errors.

## Verification

```powershell
cd frontend
npm run typecheck
npm run lint
npm run test -- --run
npm run build:pages
npm run format
```
