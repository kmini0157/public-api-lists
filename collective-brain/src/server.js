// Collective Brain — server.
// Responsibilities: ingest a URL (extract -> chunk -> embed -> store),
// semantic search, and retrieval for the client-side RAG answer.
// LLM answer generation happens in the browser via Puter.js (key-less),
// so this server never needs an LLM API key.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { extract, chunk } from "./extract.js";
import { embedPassage, embedQuery, cosine, warmup } from "./embed.js";
import * as store from "./store.js";

const app = new Hono();
app.use("/api/*", cors()); // allow the browser extension to call us
app.use("/ingest", cors());

const newId = () =>
  `${Date.now().toString(36)}-${Math.floor(performance.now() % 1e6).toString(36)}`;

// --- Ingest: save a source ---------------------------------------------------
app.post("/ingest", async (c) => {
  const { url, note } = await c.req.json().catch(() => ({}));
  if (!url || !/^https?:\/\//.test(url)) {
    return c.json({ error: "valid http(s) url required" }, 400);
  }

  const existing = await store.findByUrl(url);
  if (existing) return c.json({ ok: true, deduped: true, item: shape(existing) });

  let title, content;
  try {
    ({ title, content } = await extract(url));
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
  if (!content) return c.json({ error: "no readable content found" }, 422);

  const id = newId();
  const pieces = chunk(content);
  const chunks = [];
  for (let i = 0; i < pieces.length; i++) {
    chunks.push({
      id: `${id}#${i}`,
      itemId: id,
      text: pieces[i],
      embedding: await embedPassage(pieces[i]),
    });
  }

  const item = {
    id,
    url,
    title,
    note: note || "",
    excerpt: content.slice(0, 280),
    chunkCount: chunks.length,
    createdAt: Date.now(),
  };
  await store.addItem(item, chunks);
  return c.json({ ok: true, item: shape(item) });
});

// --- Recent items ------------------------------------------------------------
app.get("/api/items", async (c) => {
  const items = await store.listItems({ limit: Number(c.req.query("limit")) || 50 });
  return c.json({ items });
});

app.delete("/api/items/:id", async (c) => {
  await store.deleteItem(c.req.param("id"));
  return c.json({ ok: true });
});

// --- Semantic search / retrieval ---------------------------------------------
// Returns the top-k matching chunks with their source item. The web app uses
// these both for the search list and as context for the Puter.js RAG answer.
app.get("/api/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  const k = Number(c.req.query("k")) || 8;
  if (!q) return c.json({ results: [] });

  const qv = await embedQuery(q);
  const chunks = await store.allChunks();
  const scored = chunks
    .map((ch) => ({ ch, score: cosine(qv, ch.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const results = [];
  for (const { ch, score } of scored) {
    const item = await store.getItem(ch.itemId);
    if (!item) continue;
    results.push({
      score: Number(score.toFixed(4)),
      text: ch.text,
      source: { id: item.id, title: item.title, url: item.url },
    });
  }
  return c.json({ results });
});

app.get("/api/stats", async (c) => c.json(await store.stats()));

// --- Static web app ----------------------------------------------------------
app.use("/*", serveStatic({ root: "./web" }));

function shape({ embedding, ...rest }) {
  return rest;
}

const port = Number(process.env.PORT) || 8787;
console.log(`Collective Brain → http://localhost:${port}`);
console.log("Warming up embedding model (first run downloads ~120MB)…");
warmup().then(
  () => console.log("Embedding model ready."),
  (e) => console.error("Model warmup failed:", e.message),
);
serve({ fetch: app.fetch, port });
