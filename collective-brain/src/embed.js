// Local, key-less embeddings via Transformers.js (WASM — no native build).
// Model: multilingual-e5-small (works well for Korean + English).
// e5 models expect "query:" / "passage:" prefixes — we add them per use.
import { pipeline } from "@huggingface/transformers";

const MODEL = "Xenova/multilingual-e5-small";
let extractorPromise = null;

function getExtractor() {
  extractorPromise ??= pipeline("feature-extraction", MODEL);
  return extractorPromise;
}

async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

export async function embedPassage(text) {
  return embed(`passage: ${text}`);
}

export async function embedQuery(text) {
  return embed(`query: ${text}`);
}

// Vectors are L2-normalized, so dot product == cosine similarity.
export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// Warm the model at boot so the first request isn't slow.
export function warmup() {
  return getExtractor();
}
