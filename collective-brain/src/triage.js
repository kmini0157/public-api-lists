// Triage — turn a raw note into { type, title, tags, actions }.
// type ∈ task | idea | note | question.
//
// The PWA classifies in the browser with Puter.js (better quality, key-less) and
// sends the result along. This module is the SERVER-SIDE fallback, used mainly
// for Telegram captures. By default it's a fast key-less heuristic; if you wire
// up any OpenAI-compatible endpoint (LLM_BASE_URL + LLM_API_KEY) it uses that.

const STOP = new Set(
  ("the a an and or but to of in for on at with i you it is are was my me we our this that " +
    "그 저 이 그리고 그냥 좀 약간 진짜 너무 정말 그래서 근데 하고 해서 " +
    "거 게 건 것 수 등 및 또 또는 한 좀 잘 더 안 못 다 거의")
    .split(/\s+/),
);

const RX = {
  question: /\?|^\s*(왜|뭐|무엇|뭘|어떻게|언제|어디|누가|어느|얼마)\b|\b(why|what|how|when|where|who|which|whose)\b/i,
  task: /(해야|하기로|해야겠|사야|사기|연락|보내|예약|마감|까지|잊지|리마인드|챙겨|확인|처리|끝내|신청|등록|to-?do|remember to|need to|have to|must|don'?t forget|buy|call|email|schedule|book|fix|send|finish|pay)/i,
  idea: /(아이디어|어떨까|하면 좋|만들면|만들어볼|콘셉|컨셉|기획|떠올|생각났|영감|feature|idea|what if|maybe we|we could|concept|brainstorm)/i,
};

export async function triage(text) {
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    try {
      return await llmTriage(text);
    } catch (e) {
      console.error("LLM triage failed, falling back to heuristic:", e.message);
    }
  }
  return heuristicTriage(text);
}

export function heuristicTriage(text) {
  const t = text.trim();
  let type = "note";
  if (RX.question.test(t)) type = "question";
  else if (RX.task.test(t)) type = "task";
  else if (RX.idea.test(t)) type = "idea";

  const firstSentence = t.split(/(?<=[.!?。…])\s+|\n/)[0] || t;
  const title = firstSentence.slice(0, 50).trim();
  const tags = keywords(t, 3);
  const actions = type === "task" ? splitActions(t) : [];
  return { type, title, tags, actions };
}

// Strip common Korean particles so tags read as stems ("음악을" → "음악").
const JOSA = /(으로|에서|에게|한테|까지|부터|에는|와는|과는|이라|라고|에|은|는|이|가|을|를|의|도|만|와|과|로)$/;

function keywords(t, n) {
  const freq = new Map();
  for (const raw of t.toLowerCase().match(/[a-z][a-z0-9]+|[가-힣]{2,}/g) || []) {
    const w = /[가-힣]/.test(raw) ? raw.replace(JOSA, "") : raw;
    if (w.length < 2 || STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function splitActions(t) {
  return t
    .split(/(?<=[.!?。…])\s+|\n|,|·| 그리고 /)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && RX.task.test(s))
    .slice(0, 5);
}

async function llmTriage(text) {
  const body = {
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'Classify the note. Reply with ONLY JSON: ' +
          '{"type":"task|idea|note|question","title":"<=50 chars","tags":["..."],"actions":["..."]}. ' +
          "Keep the title in the note's own language (Korean ok). actions only for tasks.",
      },
      { role: "user", content: text },
    ],
  };
  const r = await fetch(process.env.LLM_BASE_URL.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  }).then((res) => res.json());

  const content = r.choices?.[0]?.message?.content || "{}";
  const p = JSON.parse(content);
  return {
    type: ["task", "idea", "note", "question"].includes(p.type) ? p.type : "note",
    title: (p.title || text.slice(0, 50)).trim(),
    tags: Array.isArray(p.tags) ? p.tags : [],
    actions: Array.isArray(p.actions) ? p.actions : [],
  };
}
