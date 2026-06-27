// Natural-language time parsing for reminders (Korean + basic English).
// Turns "내일 3시까지", "30분 후", "금요일", "tomorrow 9am", "in 2 hours" into a
// future timestamp (ms). Returns null when no time is found, so a plain note
// never gets a bogus reminder. No key, no external service.

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const DEFAULT_HOUR = clampHour(process.env.DEFAULT_REMIND_HOUR, 9); // date-only → 9am

const KO_WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const EN_WD = { sun: 0, mon: 1, tues: 2, wednes: 3, thurs: 4, fri: 5, satur: 6 };

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

  // 3) What time? (hour + minute, or null)
  let hour = null;
  let min = 0;
  if ((m = t.match(/(오전|오후|아침|저녁|밤|새벽|낮)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/))) {
    hour = +m[2];
    if (m[3]) min = +m[3];
    else if (m[4]) min = 30;
    hour = meridiemKo(hour, m[1]);
  } else if ((m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/))) {
    hour = +m[1] % 12 + (m[3] === "pm" ? 12 : 0);
    if (m[2]) min = +m[2];
  } else if (/정오|noon/.test(t)) hour = 12;
  else if (/자정|midnight/.test(t)) hour = 0;
  else if (/아침|morning/.test(t)) hour = 9;
  else if (/점심|lunch/.test(t)) hour = 12;
  else if (/저녁|evening|tonight/.test(t)) hour = 19;
  else if (/밤/.test(t)) hour = 21;

  // 4) Combine.
  if (dayTs == null && hour == null) return null;
  if (dayTs == null) {
    // Only a clock time → today, or tomorrow if it has already passed.
    let ts = atHour(now, hour) + min * MIN;
    if (ts <= now + MIN) ts += DAY;
    return ts;
  }
  const ts = dayTs + (hour == null ? DEFAULT_HOUR : hour) * HOUR + min * MIN;
  return ts > now ? ts : null;
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

// --- helpers ---------------------------------------------------------------

function atHour(ts, h) {
  const d = new Date(ts);
  d.setHours(h, 0, 0, 0);
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

// Resolve a bare hour against an optional Korean meridiem word. With no word, a
// small hour (1–7) is assumed afternoon — "3시에 보자" almost always means 3pm.
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
