// Notification fan-out for reminders. Pushes to every configured channel and
// returns true if any delivered. All channels are free / key-less:
//   • ntfy   — set NTFY_TOPIC (optionally NTFY_URL for a self-hosted server)
//   • telegram — set TELEGRAM_BOT_TOKEN (+ TELEGRAM_CHAT_ID for digests)
// With nothing configured it logs to the console so dev still sees reminders.
import { broadcast } from "./telegram.js";

const NTFY_URL = (process.env.NTFY_URL || "https://ntfy.sh").replace(/\/$/, "");
const NTFY_TOPIC = process.env.NTFY_TOPIC;

export function remindersConfigured() {
  return Boolean(NTFY_TOPIC || process.env.TELEGRAM_BOT_TOKEN);
}

export function channelSummary() {
  const on = [];
  if (NTFY_TOPIC) on.push(`ntfy (${NTFY_TOPIC})`);
  if (process.env.TELEGRAM_BOT_TOKEN) on.push("telegram");
  return on.length ? on.join(" + ") : "console only (set NTFY_TOPIC or TELEGRAM_BOT_TOKEN)";
}

// JSON publishing keeps the UTF-8 title/message intact (header form is latin-1).
async function ntfy({ title, text, priority }) {
  if (!NTFY_TOPIC) return false;
  try {
    const r = await fetch(NTFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title,
        message: text,
        tags: ["alarm_clock"],
        ...(priority ? { priority } : {}),
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function notify({ title, text, chatId, priority }) {
  const results = await Promise.allSettled([
    ntfy({ title, text, priority }),
    broadcast(`${title}\n${text}`, chatId),
  ]);
  const ok = results.some((r) => r.status === "fulfilled" && r.value);
  if (!ok) console.log(`🔔 ${title} — ${text.replace(/\n/g, " ")}`);
  return ok;
}
