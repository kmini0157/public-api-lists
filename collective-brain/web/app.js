// Collective Brain — web app.
// Server does extraction + embedding + retrieval. The RAG *answer* is generated
// here in the browser via Puter.js, so no LLM API key is ever needed.

const $ = (id) => document.getElementById(id);
const api = (path, opts) => fetch(path, opts).then((r) => r.json());

// --- Save --------------------------------------------------------------------
async function save() {
  const url = $("saveUrl").value.trim();
  if (!url) return;
  setBusy("saveBtn", true);
  $("saveMsg").textContent = "추출 + 임베딩 중… (긴 글은 수십 초 걸릴 수 있어요)";
  try {
    const res = await api("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (res.error) throw new Error(res.error);
    $("saveMsg").textContent = res.deduped
      ? `이미 저장됨: ${res.item.title}`
      : `저장 완료: ${res.item.title} (${res.item.chunkCount} chunks)`;
    $("saveUrl").value = "";
    loadItems();
    loadStats();
  } catch (e) {
    $("saveMsg").textContent = "오류: " + e.message;
  } finally {
    setBusy("saveBtn", false);
  }
}

// --- Search (retrieval only) -------------------------------------------------
async function search() {
  const q = $("q").value.trim();
  if (!q) return;
  $("answer").classList.add("hidden");
  $("results").innerHTML = "<p class='msg'>검색 중…</p>";
  const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
  renderResults(results);
  return results;
}

// --- Ask (retrieval + Puter.js RAG answer) -----------------------------------
async function ask() {
  const q = $("q").value.trim();
  if (!q) return;
  setBusy("askBtn", true);
  const results = await search();
  if (!results?.length) {
    setBusy("askBtn", false);
    return;
  }
  const answerEl = $("answer");
  answerEl.classList.remove("hidden");
  answerEl.textContent = "답변 생성 중…";

  const context = results
    .map((r, i) => `[${i + 1}] (${r.source.title})\n${r.text}`)
    .join("\n\n");
  const prompt =
    `너는 우리 그룹의 지식 비서다. 아래 발췌만 근거로 한국어로 간결히 답하고, ` +
    `각 문장 끝에 사용한 근거를 [번호]로 표기해라. 발췌에 없으면 모른다고 말해라.\n\n` +
    `질문: ${q}\n\n발췌:\n${context}`;

  try {
    if (!window.puter?.ai?.chat) throw new Error("Puter.js 로드 실패");
    const resp = await puter.ai.chat(prompt);
    const text = typeof resp === "string" ? resp : resp?.message?.content ?? String(resp);
    answerEl.innerHTML =
      escapeHtml(text) +
      `<div class="cite" style="margin-top:10px">출처: ` +
      results
        .map((r, i) => `<a href="${r.source.url}" target="_blank">[${i + 1}]</a>`)
        .join(" ") +
      `</div>`;
  } catch (e) {
    answerEl.textContent = "답변 생성 오류: " + e.message + " (검색 결과는 아래 참고)";
  } finally {
    setBusy("askBtn", false);
  }
}

// --- Recent items ------------------------------------------------------------
async function loadItems() {
  const { items } = await api("/api/items");
  const ul = $("items");
  ul.innerHTML = "";
  if (!items.length) {
    ul.innerHTML = "<li class='meta'>아직 저장된 자료가 없어요. 위에서 링크를 저장해보세요.</li>";
    return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    li.innerHTML = `<div>
        <a href="${it.url}" target="_blank">${escapeHtml(it.title)}</a>
        <div class="meta">${new Date(it.createdAt).toLocaleString()} · ${it.chunkCount} chunks</div>
      </div>
      <button class="del" title="삭제" data-id="${it.id}">✕</button>`;
    li.querySelector(".del").onclick = async () => {
      await api(`/api/items/${it.id}`, { method: "DELETE" });
      loadItems();
      loadStats();
    };
    ul.appendChild(li);
  }
}

async function loadStats() {
  const s = await api("/api/stats");
  $("stats").textContent = `${s.items} sources · ${s.chunks} chunks`;
}

function renderResults(results) {
  const box = $("results");
  if (!results.length) {
    box.innerHTML = "<p class='msg'>관련 결과가 없어요.</p>";
    return;
  }
  box.innerHTML = "";
  for (const r of results) {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `<span class="score">${r.score}</span>
      <div class="snippet">${escapeHtml(r.text.slice(0, 280))}…</div>
      <a href="${r.source.url}" target="_blank">${escapeHtml(r.source.title)}</a>`;
    box.appendChild(div);
  }
}

function setBusy(id, busy) {
  $(id).disabled = busy;
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

$("saveBtn").onclick = save;
$("askBtn").onclick = ask;
$("searchBtn").onclick = search;
$("refreshBtn").onclick = loadItems;
$("saveUrl").addEventListener("keydown", (e) => e.key === "Enter" && save());
$("q").addEventListener("keydown", (e) => e.key === "Enter" && ask());

// Prefill ?url= so the browser extension can deep-link into a save.
const pre = new URLSearchParams(location.search).get("url");
if (pre) $("saveUrl").value = pre;

loadItems();
loadStats();
