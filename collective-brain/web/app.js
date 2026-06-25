// Voice Inbox — web app.
// Capture: browser Web Speech API dictates → Puter.js classifies → POST /capture.
// The server embeds the transcript so it's searchable/askable alongside links.
// No API keys anywhere: STT is the browser's, the LLM is Puter's.

const $ = (id) => document.getElementById(id);
const api = (path, opts) => fetch(path, opts).then((r) => r.json());
const TYPE_EMOJI = { task: "✅", idea: "💡", note: "📝", question: "❓" };

// --- Voice capture (Web Speech API) -----------------------------------------
let recog = null;
let recording = false;
let finalText = "";

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function startRec() {
  if (!speechSupported()) {
    $("micHint").textContent =
      "이 브라우저는 실시간 받아쓰기를 지원하지 않아요 (Chrome 권장). 아래 키보드 입력이나 텔레그램을 쓰세요.";
    $("typefallback")?.setAttribute("open", "");
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR();
  recog.lang = "ko-KR";
  recog.continuous = true;
  recog.interimResults = true;
  finalText = "";

  recog.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += tr + " ";
      else interim += tr;
    }
    $("liveText").textContent = (finalText + interim).trim() || "듣는 중…";
  };
  recog.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      $("micHint").textContent = "마이크 권한이 필요해요.";
      stopRec(true);
    }
  };
  // Chrome stops on silence; restart while the user is still recording.
  recog.onend = () => {
    if (recording) recog.start();
  };

  recog.start();
  recording = true;
  $("micBtn").classList.add("rec");
  $("micBtn").textContent = "⏹";
  $("micHint").textContent = "듣는 중… 다시 탭하면 저장";
  $("liveText").textContent = "듣는 중…";
}

async function stopRec(cancel = false) {
  recording = false;
  try {
    recog && recog.stop();
  } catch {}
  $("micBtn").classList.remove("rec");
  $("micBtn").textContent = "🎙️";
  $("micHint").textContent = "탭하고 말하세요 · 멈추면 자동 분류됩니다";

  const text = finalText.trim();
  finalText = "";
  if (cancel || !text) {
    $("liveText").textContent = "";
    return;
  }
  await captureText(text);
}

function toggleRec() {
  recording ? stopRec() : startRec();
}

// --- Classify (Puter.js) + store --------------------------------------------
async function captureText(text) {
  $("liveText").textContent = "🤖 정리하는 중…";
  let triage = null;
  try {
    triage = await puterTriage(text);
  } catch {
    /* server will classify with its heuristic */
  }
  try {
    const res = await api("/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(triage || {}), source: "pwa" }),
    });
    if (res.error) throw new Error(res.error);
    flash(`${TYPE_EMOJI[res.item.type] || "📝"} ${res.item.title}`);
    $("liveText").textContent = "";
    loadInbox();
    loadStats();
  } catch (e) {
    $("liveText").textContent = "저장 오류: " + e.message;
  }
}

async function puterTriage(text) {
  if (!window.puter?.ai?.chat) return null;
  const prompt =
    "다음 메모를 분류해서 JSON만 출력해. 형식: " +
    '{"type":"task|idea|note|question","title":"50자 이내 한국어 제목","tags":["키워드"],"actions":["할일(있으면)"]}\n\n메모: ' +
    text;
  const resp = await puter.ai.chat(prompt);
  const raw = typeof resp === "string" ? resp : resp?.message?.content ?? String(resp);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const p = JSON.parse(m[0]);
  return {
    type: ["task", "idea", "note", "question"].includes(p.type) ? p.type : undefined,
    title: p.title,
    tags: Array.isArray(p.tags) ? p.tags : [],
    actions: Array.isArray(p.actions) ? p.actions : [],
  };
}

// --- Inbox -------------------------------------------------------------------
let inboxFilter = "all";

async function loadInbox() {
  const { items } = await api("/api/items?limit=200");
  const captures = (items || []).filter((i) => i.kind === "capture");
  const box = $("inbox");
  const shown = captures.filter((i) => inboxFilter === "all" || i.type === inboxFilter);

  if (!shown.length) {
    box.innerHTML =
      "<li class='meta'>아직 없어요. 위 마이크를 눌러 한마디 남겨보세요.</li>";
    return;
  }
  box.innerHTML = "";
  for (const it of shown) {
    const li = document.createElement("li");
    li.className = "capture-item" + (it.done ? " done" : "");
    const isTask = it.type === "task";
    const tags = (it.tags || []).map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("");
    li.innerHTML = `
      ${isTask ? `<input type="checkbox" class="check" ${it.done ? "checked" : ""} />` : `<span class="emoji">${TYPE_EMOJI[it.type] || "📝"}</span>`}
      <div class="body">
        <div class="title">${escapeHtml(it.title)}</div>
        <div class="meta">
          <span class="badge t-${it.type}">${it.type}</span>
          ${tags}
          <span class="when">${timeAgo(it.createdAt)}</span>
          ${it.source === "telegram" ? "<span class='src'>✈️</span>" : ""}
        </div>
        ${it.text && it.text !== it.title ? `<details class="full"><summary>전문</summary><p>${escapeHtml(it.text)}</p></details>` : ""}
      </div>
      <button class="del" title="삭제" data-id="${it.id}">✕</button>`;

    if (isTask) {
      li.querySelector(".check").onclick = async (e) => {
        await api(`/api/items/${it.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: e.target.checked }),
        });
        loadInbox();
      };
    }
    li.querySelector(".del").onclick = async () => {
      await api(`/api/items/${it.id}`, { method: "DELETE" });
      loadInbox();
      loadStats();
    };
    box.appendChild(li);
  }
}

// --- Ask / Search (retrieval + Puter RAG) ------------------------------------
async function search() {
  const q = $("q").value.trim();
  if (!q) return;
  $("answer").classList.add("hidden");
  $("results").innerHTML = "<p class='msg'>검색 중…</p>";
  const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
  renderResults(results);
  return results;
}

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

  const context = results.map((r, i) => `[${i + 1}] (${r.source.title})\n${r.text}`).join("\n\n");
  const prompt =
    "너는 내 음성 인박스 비서다. 아래 발췌(내가 남긴 메모·할일·저장 링크)만 근거로 한국어로 간결히 답하고, " +
    "각 문장 끝에 근거를 [번호]로 표기해라. 없으면 모른다고 말해라.\n\n질문: " +
    q +
    "\n\n발췌:\n" +
    context;

  try {
    if (!window.puter?.ai?.chat) throw new Error("Puter.js 로드 실패");
    const resp = await puter.ai.chat(prompt);
    const text = typeof resp === "string" ? resp : resp?.message?.content ?? String(resp);
    answerEl.innerHTML =
      escapeHtml(text) +
      `<div class="cite">출처: ` +
      results.map((r, i) => sourceLink(r.source, i)).join(" ") +
      `</div>`;
  } catch (e) {
    answerEl.textContent = "답변 생성 오류: " + e.message + " (검색 결과는 아래 참고)";
  } finally {
    setBusy("askBtn", false);
  }
}

function renderResults(results) {
  const box = $("results");
  if (!results || !results.length) {
    box.innerHTML = "<p class='msg'>관련 결과가 없어요.</p>";
    return;
  }
  box.innerHTML = "";
  for (const r of results) {
    const div = document.createElement("div");
    div.className = "result";
    const label =
      r.source.kind === "capture"
        ? `<span class="src-cap">${TYPE_EMOJI[r.source.type] || "📥"} ${escapeHtml(r.source.title)}</span>`
        : `<a href="${r.source.url}" target="_blank">${escapeHtml(r.source.title)}</a>`;
    div.innerHTML = `<span class="score">${r.score}</span>
      <div class="snippet">${escapeHtml(r.text.slice(0, 280))}…</div>${label}`;
    box.appendChild(div);
  }
}

function sourceLink(s, i) {
  return s.kind === "capture"
    ? `<span class="cap-cite">[${i + 1}]</span>`
    : `<a href="${s.url}" target="_blank">[${i + 1}]</a>`;
}

// --- Link save (original ingest) --------------------------------------------
async function save() {
  const url = $("saveUrl").value.trim();
  if (!url) return;
  setBusy("saveBtn", true);
  $("saveMsg").textContent = "추출 + 임베딩 중…";
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
    loadStats();
  } catch (e) {
    $("saveMsg").textContent = "오류: " + e.message;
  } finally {
    setBusy("saveBtn", false);
  }
}

// --- misc --------------------------------------------------------------------
async function loadStats() {
  const s = await api("/api/stats");
  $("stats").textContent = `${s.items} items · ${s.chunks} chunks`;
}

function flash(text) {
  $("micHint").textContent = "저장됨 → " + text;
  setTimeout(() => {
    if (!recording) $("micHint").textContent = "탭하고 말하세요 · 멈추면 자동 분류됩니다";
  }, 2500);
}

function setBusy(id, busy) {
  $(id).disabled = busy;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(ts).toLocaleDateString();
}

// --- wire up ----------------------------------------------------------------
$("micBtn").onclick = toggleRec;
$("typeBtn").onclick = () => {
  const v = $("typeInput").value.trim();
  if (v) {
    $("typeInput").value = "";
    captureText(v);
  }
};
$("typeInput").addEventListener("keydown", (e) => e.key === "Enter" && $("typeBtn").click());
$("refreshBtn").onclick = loadInbox;
$("askBtn").onclick = ask;
$("searchBtn").onclick = search;
$("q").addEventListener("keydown", (e) => e.key === "Enter" && ask());
$("saveBtn").onclick = save;
$("saveUrl")?.addEventListener("keydown", (e) => e.key === "Enter" && save());

for (const chip of document.querySelectorAll("#filters .chip")) {
  chip.onclick = () => {
    document.querySelectorAll("#filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    inboxFilter = chip.dataset.f;
    loadInbox();
  };
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

loadInbox();
loadStats();
