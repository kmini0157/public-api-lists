// Telegram capture surface. Set TELEGRAM_BOT_TOKEN to enable, then point the
// bot's webhook at  POST /telegram/webhook  (see README). Send the bot a voice
// message (or text) and it transcribes → classifies → stores, then replies with
// what it filed.
import { transcribe } from "./stt.js";
import { formatRemind } from "./datetime.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID; // default target for digests
const apiUrl = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const fileUrl = (p) => `https://api.telegram.org/file/bot${TOKEN}/${p}`;

export function telegramEnabled() {
  return Boolean(TOKEN);
}

async function send(chatId, text) {
  if (!TOKEN) return false;
  try {
    const r = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Reminder/digest channel. Sends to the capture's own chat when known, else to
// the configured TELEGRAM_CHAT_ID. No-op (false) if telegram isn't set up.
export async function broadcast(text, chatId) {
  const to = chatId || CHAT;
  if (!TOKEN || !to) return false;
  return send(to, text);
}

async function download(fileId) {
  const meta = await fetch(apiUrl("getFile") + `?file_id=${fileId}`).then((r) => r.json());
  if (!meta.ok) throw new Error("getFile failed");
  const ab = await fetch(fileUrl(meta.result.file_path)).then((r) => r.arrayBuffer());
  return Buffer.from(ab);
}

const EMOJI = { task: "✅", idea: "💡", note: "📝", question: "❓" };

// deps = { storeCapture, triage } injected from the server to avoid a cycle.
export async function handleUpdate(update, { storeCapture, triage }) {
  if (!TOKEN) return;
  const msg = update.message || update.edited_message;
  if (!msg) return;
  const chatId = msg.chat.id;

  let text = (msg.text || msg.caption || "").trim();
  const voice = msg.voice || msg.audio || msg.video_note;

  try {
    if (voice) {
      await send(chatId, "🎙️ 받아쓰는 중…");
      text = await transcribe(await download(voice.file_id));
    }
    if (!text) {
      await send(chatId, "음성 메시지나 텍스트를 보내주세요.");
      return;
    }
    const t = await triage(text);
    const item = await storeCapture({ text, ...t, source: "telegram", chatId });
    const tagLine = item.tags?.length ? `\n#${item.tags.join(" #")}` : "";
    const remindLine = item.remindAt ? `\n⏰ ${formatRemind(item.remindAt)} 알림` : "";
    await send(
      chatId,
      `${EMOJI[item.type] || "📝"} ${item.type} 저장됨\n“${item.title}”${tagLine}${remindLine}`,
    );
  } catch (e) {
    await send(chatId, "처리 중 오류가 났어요: " + e.message);
    throw e;
  }
}
