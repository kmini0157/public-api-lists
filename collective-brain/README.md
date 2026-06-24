# 🧠 Collective Brain

> **Forward anything, ask anything.** A zero-cost *collective second brain* for a small group.
> Save articles, YouTube videos, and PDFs from anywhere; later just ask
> *"what did we figure out about X?"* and get an answer **with sources**.

Built entirely on **free, key-less** building blocks so it runs for ≈ $0:

| Stage | What we use | Cost / key |
| --- | --- | --- |
| Content extraction (article / YouTube / PDF) | [Jina Reader](https://jina.ai/reader/) `r.jina.ai` | free, **no key** |
| Embeddings (multilingual, incl. Korean) | [Transformers.js](https://huggingface.co/docs/transformers.js) `multilingual-e5-small` (WASM, local) | free, **no key**, no native build |
| Vector search | JSON store + in-memory cosine | free |
| RAG answer generation | [Puter.js](https://developer.puter.com/) `puter.ai.chat` (browser) | free, **no key** |
| Server | [Hono](https://hono.dev/) on Node | free |
| Capture | Web app + MV3 browser extension | free |

Why it's sticky: capture is one click, value compounds as the corpus grows, and
the whole group searches a shared memory — a bookmark graveyard it is not.

---

## Quick start

```bash
cd collective-brain
npm install        # installs hono + transformers.js (pure JS/WASM)
npm start          # http://localhost:8787  (first run downloads ~120MB model)
```

Open <http://localhost:8787>, paste a link, hit **저장**. Then ask a question.

> The first request is slow while the embedding model downloads & warms up.
> Subsequent ingests/searches are fast.

## Browser extension (one-click capture)

1. Go to `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `collective-brain/extension` folder.
3. Click the toolbar icon (or right-click any page/link) → **Save to Collective Brain**.

The extension posts the current URL to your local server's `/ingest`. Set the
server address in the popup if you host it elsewhere.

## How it works

```
            ┌────────── browser extension / web ──────────┐
  capture → │  POST /ingest { url }                        │
            └──────────────────────┬──────────────────────┘
                                   ▼
   Jina Reader (clean text) → chunk → e5 embeddings → JSON store
                                   ▲
            search/ask ── GET /api/search?q= ──► top-k chunks
                                   ▼
        web app feeds chunks to Puter.js → cited answer (no API key)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/ingest` | `{ url, note? }` → extract, embed, store (deduped by URL) |
| `GET` | `/api/search?q=&k=` | top-k matching chunks with sources |
| `GET` | `/api/items?limit=` | recent saved sources |
| `DELETE` | `/api/items/:id` | remove a source and its chunks |
| `GET` | `/api/stats` | counts |

## Roadmap (next, all on the same free stack)

- 🎙️ Voice memo capture → Whisper/Puter STT → ingest
- 🗓️ Weekly digest push via ntfy / Resend
- 👥 Multi-user groups + auth (Appwrite / Supabase)
- ☁️ Deploy: Cloudflare Workers + D1/R2 (or any Node host); swap JSON store for
  Vectorize / Qdrant / Pinecone when the corpus grows
- 🔁 Dedup & re-summarize, tags, and saved searches

## Notes

- The JSON store (`data/brain.json`, git-ignored) is fine for a personal /
  small-group MVP. For larger corpora switch the `store.js` + `embed.js`
  similarity step to a real vector DB.
- Everything here is key-less by design. If a provider changes its free tier,
  only the relevant adapter (`extract.js` / `embed.js` / Puter call) needs swapping.
