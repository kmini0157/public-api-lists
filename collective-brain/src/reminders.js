// Reminder scheduler. Every minute it (1) fires reminders for tasks whose
// remindAt has arrived and (2) sends one daily digest of open tasks. State is
// derived from the store, so a restart never double-fires a past reminder
// (remindedAt is persisted) — at worst it re-sends the day's digest once.
import * as store from "./store.js";
import { notify } from "./notify.js";
import { formatRemind } from "./datetime.js";

const DAY = 86_400_000;
const TICK = Number(process.env.REMINDER_TICK_MS) || 60_000;
const DIGEST_HOUR = clampHour(process.env.DIGEST_HOUR, 9);

let timer = null;
let lastDigestDay = null;

export function startScheduler() {
  if (timer) return;
  const run = () => tick().catch((e) => console.error("reminder tick failed:", e.message));
  timer = setInterval(run, TICK);
  run();
  console.log(`Reminders: scheduler on (tick ${TICK / 1000}s · daily digest ${DIGEST_HOUR}:00).`);
}

async function tick(now = Date.now()) {
  await fireDue(now);
  await maybeDigest(now);
}

async function fireDue(now) {
  const due = await store.dueReminders(now);
  for (const it of due) {
    await notify({
      title: `⏰ ${it.title}`,
      text: reminderBody(it, now),
      chatId: it.chatId,
      priority: it.remindAt < now - DAY ? 4 : undefined, // long-overdue → louder
    });
    await store.updateItem(it.id, { remindedAt: now });
  }
}

function reminderBody(it, now) {
  const overdue = it.remindAt < now - 90_000;
  const lines = [overdue ? `예정: ${formatRemind(it.remindAt, now)} (지남)` : "지금 할 시간이에요"];
  if (it.actions?.length) lines.push(...it.actions.map((a) => `• ${a}`));
  else if (it.text && it.text !== it.title) lines.push(it.text.slice(0, 200));
  return lines.join("\n");
}

async function maybeDigest(now) {
  const d = new Date(now);
  if (d.getHours() < DIGEST_HOUR) return;
  const key = d.toDateString();
  if (lastDigestDay === key) return;
  lastDigestDay = key;
  await runDigest(now);
}

// Build + send the digest. Exported so the server can trigger it on demand.
export async function runDigest(now = Date.now()) {
  const tasks = await store.openTasks();
  const recent = (await store.listItems({ limit: 500 })).filter(
    (i) => i.kind === "capture" && now - i.createdAt < DAY,
  );
  const text = buildDigest(tasks, recent, now);
  await notify({ title: "📋 오늘의 인박스", text });
  return text;
}

function buildDigest(tasks, recent, now) {
  if (!tasks.length && !recent.length) return "열린 할일이 없어요. 깔끔하네요 ✨";
  const overdue = tasks.filter((t) => t.remindAt && t.remindAt <= now);
  const lines = [`열린 할일 ${tasks.length}개${overdue.length ? ` · 지난 ${overdue.length}개` : ""}`];
  for (const t of tasks.slice(0, 10)) {
    lines.push(`• ${t.title}${t.remindAt ? ` — ${formatRemind(t.remindAt, now)}` : ""}`);
  }
  if (tasks.length > 10) lines.push(`…외 ${tasks.length - 10}개`);
  if (recent.length) lines.push(`\n최근 24시간 새 캡처 ${recent.length}개`);
  return lines.join("\n");
}

function clampHour(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}
