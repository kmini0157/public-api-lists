// Right-click → "Save to Collective Brain" on any page or link.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-page",
    title: "Save to Collective Brain",
    contexts: ["page", "link", "selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url) return;
  const { server = "http://localhost:8787" } = await chrome.storage.local.get("server");
  try {
    await fetch(server.replace(/\/$/, "") + "/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    notify("저장 완료 ✓", url);
  } catch (e) {
    notify("저장 실패", String(e.message || e));
  }
});

function notify(title, message) {
  // Badge feedback (notifications permission not required).
  chrome.action.setBadgeText({ text: "✓" });
  chrome.action.setTitle({ title: `${title}\n${message}` });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}
