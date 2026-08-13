---
title: TextMosaic
emoji: 🧩
colorFrom: indigo
colorTo: blue
sdk: static
pinned: false
---

# TextMosaic

TextMosaic turns dense text into an interactive knowledge map: concepts become
clickable nodes, directed relationships become labeled edges, and every node
shows an exact quotation plus a plain-English explanation.

**[Open the live product](https://noorrattan.github.io/TextMosaic/)**

## Private, free, and browser-only

TextMosaic is a static GitHub Pages app. It does not call a backend, an LLM, or
an AI API. A compact ONNX named-entity-recognition model, its tokenizer, and
its WebAssembly runtime are bundled with the site. They run in the visitor's
browser; pasted text is never uploaded.

The graph layer combines the on-device ML entity signals with deterministic,
source-grounded relationship patterns. This is intentional: every edge remains
traceable to the sentence that supports it instead of being invented by a
generative model.

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

## Model provenance

The included quantized model is the `model_int8.onnx` variant from
[`onnx-community/NeuroBERT-NER-ONNX`](https://huggingface.co/onnx-community/NeuroBERT-NER-ONNX),
used only as a downloaded static asset. Once the site is loaded, it makes no
request to Hugging Face or any other model host.

## Verification

```powershell
cd frontend
npm run typecheck
npm run lint
npm run test -- --run
npm run build:pages
npm run format
```
