// Popup: grab the active tab's URL and POST it to the local server.
const $ = (id) => document.getElementById(id);

const serverInput = $("server");
chrome.storage.local.get("server").then(({ server }) => {
  if (server) serverInput.value = server;
});
serverInput.addEventListener("change", () =>
  chrome.storage.local.set({ server: serverInput.value.trim() }),
);

let currentUrl = "";
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  currentUrl = tab?.url || "";
  $("url").textContent = currentUrl;
});

$("save").addEventListener("click", async () => {
  const server = serverInput.value.trim().replace(/\/$/, "");
  if (!currentUrl) return;
  $("save").disabled = true;
  $("msg").textContent = "저장 중…";
  try {
    const res = await fetch(server + "/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentUrl }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    $("msg").textContent = data.deduped ? "이미 저장됨 ✓" : `저장 완료 ✓ (${data.item.chunkCount} chunks)`;
  } catch (e) {
    $("msg").textContent = "오류: " + e.message;
  } finally {
    $("save").disabled = false;
  }
});
