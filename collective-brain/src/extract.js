// Content extraction via Jina Reader (https://r.jina.ai) — key-less.
// Handles articles, YouTube (transcript), and PDF URLs uniformly: it returns
// clean markdown with a title. We then chunk it for embedding.

const JINA = "https://r.jina.ai/";

export async function extract(url) {
  const res = await fetch(JINA + url, {
    headers: {
      // Ask Jina for a clean, structured response with a title.
      Accept: "text/plain",
      "X-Return-Format": "markdown",
    },
  });
  if (!res.ok) {
    throw new Error(`Jina Reader failed (${res.status}) for ${url}`);
  }
  const body = await res.text();
  return parseJina(body, url);
}

// Jina prepends a small header block:
//   Title: ...
//   URL Source: ...
//   Markdown Content:
//   <body>
function parseJina(body, url) {
  const titleMatch = body.match(/^Title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const marker = "Markdown Content:";
  const idx = body.indexOf(marker);
  const content = idx >= 0 ? body.slice(idx + marker.length).trim() : body.trim();
  return { title, content };
}

// Split into ~chunkSize-char chunks on paragraph/sentence boundaries with overlap.
export function chunk(text, { size = 900, overlap = 150 } = {}) {
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= size) return clean ? [clean] : [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      // Prefer to break on a paragraph or sentence boundary near the end.
      const slice = clean.slice(start, end);
      const para = slice.lastIndexOf("\n\n");
      const sent = slice.lastIndexOf(". ");
      const cut = para > size * 0.5 ? para : sent > size * 0.5 ? sent + 1 : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}
