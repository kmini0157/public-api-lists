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
import { triage } from "./triage.js";
import { handleUpdate, telegramEnabled } from "./telegram.js";
import { parseRemindAt, parseRecurrence, nextOccurrence } from "./datetime.js";
import { startScheduler, runDigest } from "./reminders.js";
import { channelSummary } from "./notify.js";

const app = new Hono();
app.use("/api/*", cors()); // allow the browser extension / PWA to call us
app.use("/ingest", cors());
app.use("/capture", cors());

const CAPTURE_TYPES = new Set(["task", "idea", "note", "question"]);

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

// --- Capture: save a voice/text note -----------------------------------------
// The PWA records speech, classifies it with Puter.js in the browser, and posts
// the transcript + triage here. If triage fields are missing (e.g. a Telegram
// voice note, or a dumb client) the server classifies it itself.
app.post("/capture", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = (body.text || "").trim();
  if (!text) return c.json({ error: "text required" }, 400);

  let { type, title, tags, actions } = body;
  if (!type || !CAPTURE_TYPES.has(type) || !title) {
    const t = await triage(text);
    type = CAPTURE_TYPES.has(type) ? type : t.type;
    title ||= t.title;
    tags ||= t.tags;
    actions ||= t.actions;
  }

  const item = await storeCapture({
    text,
    type,
    title,
    tags,
    actions,
    source: body.source || "pwa",
    remindAt: typeof body.remindAt === "number" ? body.remindAt : undefined,
  });
  return c.json({ ok: true, item: shape(item) });
});

// Embed a free-text note and store it as a capture item (searchable like sources).
// A task's reminder time is taken from an explicit remindAt, otherwise parsed
// from the note itself ("내일 3시까지 …") so capture stays one step.
async function storeCapture({
  text,
  type,
  title,
  tags = [],
  actions = [],
  source = "pwa",
  chatId = null,
  remindAt,
}) {
  const id = newId();
  const pieces = chunk(text);
  const chunks = [];
  for (let i = 0; i < pieces.length; i++) {
    chunks.push({
      id: `${id}#${i}`,
      itemId: id,
      text: pieces[i],
      embedding: await embedPassage(pieces[i]),
    });
  }
  // A recurring phrase ("매주 월요일 …") makes it a task and sets the first run;
  // otherwise a task gets a one-shot reminder parsed from its own text.
  let finalType = CAPTURE_TYPES.has(type) ? type : "note";
  const rec = parseRecurrence(text);
  let repeat = null;
  let remind;
  if (rec) {
    finalType = "task";
    repeat = rec.repeat;
    remind = typeof remindAt === "number" ? remindAt : rec.remindAt;
  } else {
    remind =
      typeof remindAt === "number" ? remindAt : finalType === "task" ? parseRemindAt(text) : null;
  }
  const item = {
    id,
    kind: "capture",
    type: finalType,
    title: (title || text.slice(0, 50)).trim(),
    text,
    tags: Array.isArray(tags) ? tags.slice(0, 6) : [],
    actions: Array.isArray(actions) ? actions.slice(0, 8) : [],
    done: false,
    source,
    chatId: chatId || null,
    repeat,
    remindAt: remind || null,
    remindedAt: null,
    excerpt: text.slice(0, 280),
    chunkCount: chunks.length,
    createdAt: Date.now(),
  };
  await store.addItem(item, chunks);
  return item;
}

// --- Telegram webhook (second capture surface) -------------------------------
// Set TELEGRAM_BOT_TOKEN to enable. Send the bot a voice message or text and it
// transcribes (server-side Whisper), classifies, and stores it.
app.post("/telegram/webhook", async (c) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && c.req.header("x-telegram-bot-api-secret-token") !== secret) {
    return c.json({ ok: false }, 401);
  }
  const update = await c.req.json().catch(() => ({}));
  // Acknowledge fast; do the slow STT/embedding work in the background.
  handleUpdate(update, { storeCapture, triage }).catch((e) =>
    console.error("telegram update failed:", e.message),
  );
  return c.json({ ok: true });
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

// Patch a capture: toggle a task's `done`, or correct its `type`/`title`.
app.patch("/api/items/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const cur = await store.getItem(id);
  if (!cur) return c.json({ error: "not found" }, 404);

  const patch = {};
  if (typeof body.done === "boolean") {
    // Checking off a recurring task rolls it to the next run instead of closing.
    if (body.done && cur.repeat) {
      patch.remindAt = advance(cur.repeat, cur.remindAt);
      patch.remindedAt = null;
    } else {
      patch.done = body.done;
    }
  }
  if (CAPTURE_TYPES.has(body.type)) patch.type = body.type;
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (body.repeat === null) patch.repeat = null; // stop repeating
  // Reminder controls: set/clear an exact time, or snooze N minutes from now.
  // Any change resets remindedAt so the new time fires.
  if (typeof body.snoozeMinutes === "number") {
    patch.remindAt = Date.now() + body.snoozeMinutes * 60_000;
    patch.remindedAt = null;
  } else if (typeof body.remindAt === "number") {
    patch.remindAt = body.remindAt;
    patch.remindedAt = null;
  } else if (body.remindAt === null && patch.remindAt === undefined) {
    patch.remindAt = null;
    patch.remindedAt = null;
  }
  const it = await store.updateItem(id, patch);
  return c.json({ ok: true, item: shape(it) });
});

// Next run strictly after now, from a (possibly stale) anchor time.
function advance(repeat, from) {
  let next = nextOccurrence(repeat, from || Date.now());
  for (let i = 0; next <= Date.now() && i < 1200; i++) next = nextOccurrence(repeat, next);
  return next;
}

// Send the daily digest now (also runs automatically once a day).
app.post("/api/digest", async (c) => c.json({ ok: true, text: await runDigest() }));

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
      source: { id: item.id, title: item.title, url: item.url, kind: item.kind, type: item.type },
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
console.log(`Telegram capture: ${telegramEnabled() ? "enabled" : "disabled (set TELEGRAM_BOT_TOKEN)"}`);
console.log(`Reminder channels: ${channelSummary()}`);
startScheduler();
console.log("Warming up embedding model (first run downloads ~120MB)…");
warmup().then(
  () => console.log("Embedding model ready."),
  (e) => console.error("Model warmup failed:", e.message),
);
serve({ fetch: app.fetch, port });
