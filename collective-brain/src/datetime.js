// Natural-language time + recurrence parsing for reminders (Korean + basic
// English). Turns "내일 3시까지", "30분 후", "매주 월요일 9시", "every monday"
// into a remindAt timestamp (+ a repeat rule for recurring ones). Returns null
// when nothing time-like is found, so a plain note never gets a bogus reminder.
// No key, no external service.

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const DEFAULT_HOUR = clampHour(process.env.DEFAULT_REMIND_HOUR, 9); // date-only → 9am

const KO_WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const EN_WD = { sun: 0, mon: 1, tues: 2, wednes: 3, thurs: 4, fri: 5, satur: 6 };
const WD_KO = ["일", "월", "화", "수", "목", "금", "토"];

// Extract just a clock time → { hour, min } or null. Shared by the one-shot and
// recurring parsers. No meridiem word + a small hour (1–7) is read as afternoon
// — "3시에 보자" almost always means 3pm.
export function parseTimeOfDay(text) {
  const t = " " + String(text).toLowerCase() + " ";
  let m;
  if ((m = t.match(/(오전|오후|아침|저녁|밤|새벽|낮)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/))) {
    let hour = +m[2];
    const min = m[3] ? +m[3] : m[4] ? 30 : 0;
    return { hour: meridiemKo(hour, m[1]), min };
  }
  if ((m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/)))
    return { hour: (+m[1] % 12) + (m[3] === "pm" ? 12 : 0), min: m[2] ? +m[2] : 0 };
  if (/정오|noon/.test(t)) return { hour: 12, min: 0 };
  if (/자정|midnight/.test(t)) return { hour: 0, min: 0 };
  if (/아침|morning/.test(t)) return { hour: 9, min: 0 };
  if (/점심|lunch/.test(t)) return { hour: 12, min: 0 };
  if (/저녁|evening|tonight/.test(t)) return { hour: 19, min: 0 };
  if (/밤/.test(t)) return { hour: 21, min: 0 };
  return null;
}

export function parseRemindAt(text, now = Date.now()) {
  const t = " " + String(text).toLowerCase() + " ";
  let m;

  // 1) Pure relative offsets resolve to an exact instant.
  if ((m = t.match(/(\d+)\s*분\s*(?:후|뒤|있다가|이따)/))) return now + +m[1] * MIN;
  if ((m = t.match(/(\d+)\s*시간\s*(?:후|뒤|있다가|이따)/))) return now + +m[1] * HOUR;
  if ((m = t.match(/in\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)/))) {
    const n = +m[1];
    if (m[2].startsWith("min")) return now + n * MIN;
    if (m[2][0] === "h") return now + n * HOUR;
    if (m[2][0] === "w") return atHour(now + n * 7 * DAY, DEFAULT_HOUR);
    return atHour(now + n * DAY, DEFAULT_HOUR);
  }
  if (/(잠시\s*후|곧|이따가?)/.test(t) && !/\d/.test(t)) return now + 3 * HOUR;

  // 2) Which day? (midnight of the target day, or null)
  let dayTs = null;
  const today = atHour(now, 0);
  if (/모레|내일\s*모레/.test(t)) dayTs = today + 2 * DAY;
  else if (/내일|tomorrow/.test(t)) dayTs = today + DAY;
  else if (/오늘|today|tonight/.test(t)) dayTs = today;
  else if ((m = t.match(/(\d+)\s*일\s*(?:후|뒤)/))) dayTs = today + +m[1] * DAY;
  else if ((m = t.match(/(\d+)\s*주\s*(?:후|뒤)/))) dayTs = today + +m[1] * 7 * DAY;
  else if ((m = t.match(/([월화수목금토일])\s*요일/)))
    dayTs = nextWeekday(now, KO_WD[m[1]], /다음\s*주/.test(t));
  else if ((m = t.match(/(sun|mon|tues|wednes|thurs|fri|satur)day/)))
    dayTs = nextWeekday(now, EN_WD[m[1]], /next\s+week/.test(t));
  else if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) dayTs = monthDay(now, +m[1], +m[2]);
  else if (/다음\s*주|next\s+week/.test(t)) dayTs = today + 7 * DAY;

  // 3) What time?
  const tod = parseTimeOfDay(text);

  // 4) Combine.
  if (dayTs == null && tod == null) return null;
  if (dayTs == null) {
    // Only a clock time → today, or tomorrow if it has already passed.
    let ts = atHour(now, tod.hour) + tod.min * MIN;
    if (ts <= now + MIN) ts += DAY;
    return ts;
  }
  const ts = dayTs + (tod ? tod.hour : DEFAULT_HOUR) * HOUR + (tod ? tod.min : 0) * MIN;
  return ts > now ? ts : null;
}

// Detect a repeating schedule. Returns { repeat:{freq,interval}, remindAt } for
// the first occurrence, or null if the note isn't recurring.
//   freq: "daily" | "weekly" | "monthly"   interval: 1 (or 2 for 격주/biweekly)
export function parseRecurrence(text, now = Date.now()) {
  const t = " " + String(text).toLowerCase() + " ";
  let m;
  let weekday = null;
  if ((m = t.match(/([월화수목금토일])\s*요일/))) weekday = KO_WD[m[1]];
  else if ((m = t.match(/(sun|mon|tues|wednes|thurs|fri|satur)day/))) weekday = EN_WD[m[1]];

  let freq = null;
  let interval = 1;
  if (/격주|biweekly|every\s+other\s+week|every\s+two\s+weeks/.test(t)) {
    freq = "weekly";
    interval = 2;
  } else if (/매일|매일같이|every\s*day|daily/.test(t)) {
    freq = "daily";
  } else if (/매주|weekly|every\s+week/.test(t) || (weekday != null && /(every|마다)/.test(t))) {
    freq = "weekly";
  } else if (/매달|매월|monthly|every\s+month/.test(t)) {
    freq = "monthly";
  }
  if (!freq) return null;

  const tod = parseTimeOfDay(text) || { hour: DEFAULT_HOUR, min: 0 };
  let first;
  if (freq === "weekly" && weekday != null) {
    first = atWeekday(now, weekday, tod);
  } else if (freq === "daily" || freq === "weekly") {
    first = atHour(now, tod.hour) + tod.min * MIN;
    if (first <= now) first += DAY; // weekly-with-no-day anchors on today/tomorrow
  } else {
    // monthly: honor a stated "N일" day-of-month, else today's date; this month
    // if still ahead, otherwise next month.
    const dm = t.match(/(\d{1,2})\s*일/);
    const d = new Date(now);
    d.setHours(tod.hour, tod.min, 0, 0);
    if (dm) d.setDate(+dm[1]);
    if (d.getTime() <= now) d.setMonth(d.getMonth() + 1);
    first = d.getTime();
  }
  return { repeat: { freq, interval }, remindAt: first };
}

// Advance a remindAt to the next run, preserving its time-of-day / day-of-month.
export function nextOccurrence(repeat, ts) {
  const d = new Date(ts);
  const n = repeat.interval || 1;
  if (repeat.freq === "daily") d.setDate(d.getDate() + n);
  else if (repeat.freq === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (repeat.freq === "monthly") d.setMonth(d.getMonth() + n);
  return d.getTime();
}

// Short Korean label for a reminder time, e.g. "내일 09:00" or "6/30 15:00".
export function formatRemind(ts, now = Date.now()) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const diff = Math.round((atHour(ts, 0) - atHour(now, 0)) / DAY);
  const day =
    diff === 0 ? "오늘" : diff === 1 ? "내일" : diff === 2 ? "모레" : `${d.getMonth() + 1}/${d.getDate()}`;
  return `${day} ${hh}:${mm}`;
}

// Human label for a repeat rule, e.g. "매주 월", "격주 수", "매일", "매월 15일".
export function describeRepeat(repeat, remindAt) {
  if (!repeat) return "";
  if (repeat.freq === "daily") return "매일";
  if (repeat.freq === "monthly")
    return remindAt ? `매월 ${new Date(remindAt).getDate()}일` : "매월";
  const base = repeat.interval === 2 ? "격주" : "매주";
  return remindAt != null ? `${base} ${WD_KO[new Date(remindAt).getDay()]}` : base;
}

// --- helpers ---------------------------------------------------------------

function atHour(ts, h) {
  const d = new Date(ts);
  d.setHours(h, 0, 0, 0);
  return d.getTime();
}

// Next date matching weekday at the given time — today if it's that day and the
// time is still ahead, otherwise the upcoming one.
function atWeekday(now, wd, tod) {
  const d = new Date(now);
  d.setHours(tod.hour, tod.min, 0, 0);
  let delta = (wd - d.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() <= now) delta = 7;
  d.setDate(d.getDate() + delta);
  return d.getTime();
}

function nextWeekday(now, wd, nextWeek) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  let delta = (wd - d.getDay() + 7) % 7;
  if (delta === 0) delta = 7; // "월요일" means the upcoming one, not today
  return d.getTime() + (delta + (nextWeek ? 7 : 0)) * DAY;
}

function monthDay(now, mon, day) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setMonth(mon - 1, day);
  if (d.getTime() < now) d.setFullYear(d.getFullYear() + 1); // already past → next year
  return d.getTime();
}

function meridiemKo(hour, mer) {
  if (mer === "오후" || mer === "저녁" || mer === "밤" || mer === "낮")
    return hour < 12 ? hour + 12 : hour;
  if (mer === "오전" || mer === "아침" || mer === "새벽") return hour === 12 ? 0 : hour;
  if (!mer && hour >= 1 && hour <= 7) return hour + 12;
  return hour;
}

function clampHour(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}
