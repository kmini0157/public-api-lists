// Tiny zero-dependency JSON store.
// Holds items (saved sources) and their embedded chunks. Good enough for a
// personal / small-group MVP (thousands of chunks searched in-memory).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = new URL("../data/brain.json", import.meta.url).pathname;

const empty = { items: [], chunks: [] };
let db = null;
let flushing = null;

async function ensureLoaded() {
  if (db) return db;
  if (existsSync(DB_PATH)) {
    db = JSON.parse(await readFile(DB_PATH, "utf8"));
    db.items ??= [];
    db.chunks ??= [];
  } else {
    db = structuredClone(empty);
  }
  return db;
}

async function flush() {
  // Serialize writes so concurrent ingests don't clobber the file.
  flushing = (flushing ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(DB_PATH), { recursive: true });
    await writeFile(DB_PATH, JSON.stringify(db));
  });
  return flushing;
}

export async function addItem(item, chunks) {
  await ensureLoaded();
  db.items.push(item);
  db.chunks.push(...chunks);
  await flush();
  return item;
}

export async function listItems({ limit = 50 } = {}) {
  await ensureLoaded();
  return [...db.items]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(({ embedding, ...rest }) => rest);
}

export async function allChunks() {
  await ensureLoaded();
  return db.chunks;
}

export async function getItem(id) {
  await ensureLoaded();
  return db.items.find((i) => i.id === id) ?? null;
}

// Patch a stored item in place (e.g. toggle a task's `done`, fix its `type`).
export async function updateItem(id, patch) {
  await ensureLoaded();
  const it = db.items.find((i) => i.id === id);
  if (!it) return null;
  Object.assign(it, patch);
  await flush();
  return it;
}

export async function findByUrl(url) {
  await ensureLoaded();
  return db.items.find((i) => i.url === url) ?? null;
}

export async function deleteItem(id) {
  await ensureLoaded();
  db.items = db.items.filter((i) => i.id !== id);
  db.chunks = db.chunks.filter((c) => c.itemId !== id);
  await flush();
}

export async function stats() {
  await ensureLoaded();
  return { items: db.items.length, chunks: db.chunks.length };
}
