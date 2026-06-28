# 🎙️ Voice Inbox (Collective Brain)

> **말하면, 알아서 정리됩니다.** 떠오른 생각을 한 번 탭하고 말하면 AI가
> **할일 · 아이디어 · 메모 · 질문**으로 자동 분류해 인박스에 쌓고, 나중에
> *"지난주에 사야겠다고 한 거 뭐였지?"* 하고 물으면 **근거와 함께** 답합니다.
> 할일은 *"내일 3시까지"* 같은 말에서 **알림 시각을 자동으로 잡아** 제때 알려줍니다.

즉석 음성 포착(instant capture)에 초점을 맞춘, **무료·키 없는** 개인 음성 인박스입니다.
원래의 *Collective Brain*(링크 저장 → RAG) 엔진을 그대로 재사용하고 그 위에
음성 캡처 · 자동 분류 · 인박스 · PWA · 텔레그램을 얹었습니다. 운영비 ≈ $0.

| 단계 | 사용 | 비용 / 키 |
| --- | --- | --- |
| 음성 받아쓰기 (PWA) | 브라우저 **Web Speech API** | 무료, **키 없음** |
| 자동 분류 (할일/아이디어/메모/질문) | [Puter.js](https://developer.puter.com/) `puter.ai.chat` (브라우저) | 무료, **키 없음** |
| 임베딩 (한국어 포함 다국어) | [Transformers.js](https://huggingface.co/docs/transformers.js) `multilingual-e5-small` (WASM, 로컬) | 무료, **키 없음** |
| 벡터 검색 | JSON 스토어 + 인메모리 코사인 | 무료 |
| 질문 답변 (RAG) | Puter.js (브라우저) | 무료, **키 없음** |
| 리마인드 알림 | 자연어 시간 파싱 + [ntfy](https://ntfy.sh/) / 텔레그램 / 브라우저 알림 | 무료, **키 없음** |
| 링크 추출 (아티클/유튜브/PDF) | [Jina Reader](https://jina.ai/reader/) `r.jina.ai` | 무료, **키 없음** |
| 텔레그램 음성 (선택) | 봇 + 로컬 **Whisper**(Transformers.js) + ffmpeg | 무료 (봇 토큰만) |
| 서버 | [Hono](https://hono.dev/) on Node | 무료 |

왜 의존하게 되나: **포착 마찰이 거의 0**(말만 하면 됨), 분류를 사람이 안 하고
AI가 함, 그리고 쌓일수록 검색·질문 가치가 커져 외장 두뇌가 됩니다.

---

## 빠른 시작

```bash
cd collective-brain
npm install        # hono + transformers.js (순수 JS/WASM)
npm start          # http://localhost:8787  (첫 실행 시 임베딩 모델 ~120MB 다운로드)
```

<http://localhost:8787> 을 열고(마이크 권한 허용) **🎙️ 버튼**을 눌러 말하세요.
멈추면 자동 분류되어 인박스에 들어갑니다. 그 다음 무엇이든 질문하세요.

> 첫 요청은 임베딩 모델을 받고 워밍업하는 동안 느립니다. 이후엔 빠릅니다.
> 실시간 받아쓰기는 Chrome / Edge / Android Chrome에서 가장 잘 됩니다
> (Web Speech API 미지원 브라우저에선 키보드 입력 또는 텔레그램을 쓰세요).

## 📲 홈 화면에 설치 (PWA)

manifest + 서비스워커가 들어 있어 설치형 앱처럼 쓸 수 있습니다.

- **iOS Safari**: 공유 → "홈 화면에 추가"
- **Android Chrome / 데스크톱**: 주소창의 설치 아이콘

홈 화면 아이콘 → 열자마자 녹음, 즉석 포착에 최적화돼 있습니다.

## ✈️ 텔레그램 캡처 (선택 — 두 번째 입구)

폰에서 가장 마찰이 낮은 입구입니다. 잠금화면·운전 중에도 길게 눌러 음성 메시지를
보내면 서버가 받아쓰고 분류해 저장합니다.

1. [@BotFather](https://t.me/BotFather)로 봇을 만들고 토큰을 받습니다.
2. `ffmpeg`을 설치합니다(음성 디코딩용). PWA 경로는 필요 없습니다.
3. 환경변수와 함께 서버를 띄웁니다:
   ```bash
   TELEGRAM_BOT_TOKEN=123:abc \
   TELEGRAM_WEBHOOK_SECRET=mysecret \
   npm start
   ```
4. 공개 URL(예: Cloudflare Tunnel / ngrok)로 웹훅을 등록합니다:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<공개주소>/telegram/webhook&secret_token=mysecret"
   ```
5. 봇에게 음성/텍스트를 보내면 `✅ task 저장됨 "…"` 처럼 답합니다.

> 서버 측 분류는 기본적으로 키 없는 휴리스틱입니다. 더 좋은 분류를 원하면
> OpenAI 호환 엔드포인트를 연결하세요: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.

## ⏰ 리마인드 (할일이 알아서 돌아옴)

"포착만 하고 안 봄" 문제를 없애는 핵심 기능입니다. 할일을 말하면:

1. **자동 시간 파싱** — *"내일 3시까지 우유 사기"*, *"30분 후 전화"*, *"금요일 보고서"*,
   *"tomorrow 9am standup"* 같은 한국어·영어 표현에서 알림 시각(`remindAt`)을 잡습니다
   (`src/datetime.js`, 키 없음). 시각만 있고 날짜가 없으면 오늘/내일로, 날짜만 있으면
   오전 9시로 잡습니다.
2. **반복 알림** — *"매주 월요일 9시 팀미팅"*, *"매일 아침 약 먹기"*, *"격주 수요일 청소"*,
   *"매월 15일 월세"*, *"every monday standup"* 처럼 반복 표현이 있으면 자동으로
   반복 일정이 됩니다. 한 번 울리면 **다음 회차로 자동 재예약**되고, 반복 할일을
   체크하면 완료가 아니라 다음 일정으로 넘어갑니다 (인박스의 `반복 해제`로 중단).
3. **스케줄러** — 서버가 1분마다 도래한 할일을 확인해 알림을 보내고,
   매일 한 번 **다이제스트**(열린 할일 + 최근 캡처)를 보냅니다.
4. **알림 채널** (전부 무료) — 아무것도 설정 안 하면 콘솔에만 찍히고,
   설정하면 아래로 나갑니다:
   - **ntfy** — `NTFY_TOPIC`만 정하면 폰 앱으로 push (키 없음)
   - **텔레그램** — 캡처한 그 채팅으로 회신, 다이제스트는 `TELEGRAM_CHAT_ID`로
   - **브라우저 알림** — 탭이 열려 있을 때 "🔔 알림 켜기"로 권한을 주면 표시
5. **인박스에서 조정** — 할일마다 ⏰ 마감 뱃지(지나면 빨강), 🔁 반복 뱃지와
   `+1시간` · `내일 아침` · `해제` · `반복 해제` 버튼이 있습니다. 다이제스트는
   `POST /api/digest`로 즉시 보낼 수도 있습니다.

## 작동 원리

```
                           ┌──────── PWA (브라우저) ────────┐
  🎙️ 말하기 → Web Speech API 받아쓰기 → Puter.js 분류 → POST /capture
                           └───────────────┬───────────────┘
  ✈️ 텔레그램 음성 → 서버 Whisper → 휴리스틱/LLM 분류 ──┤
                                                       ▼
        chunk → e5 임베딩 → JSON 스토어 (할일/아이디어/메모/질문 + 태그)
                                                       ▲
        질문/검색 ── GET /api/search?q= ──► top-k chunks
                                                       ▼
            웹앱이 chunks를 Puter.js에 넘김 → 근거 표시된 답변 (키 없음)
```

## API

| Method | Path | 용도 |
| --- | --- | --- |
| `POST` | `/capture` | `{ text, type?, title?, tags?, actions?, source? }` → 분류(없으면 서버가) · 임베딩 · 저장 |
| `POST` | `/ingest` | `{ url, note? }` → 링크 추출 · 임베딩 · 저장 (URL 중복제거) |
| `GET` | `/api/search?q=&k=` | 의미 검색 top-k chunks (출처 포함) |
| `GET` | `/api/items?limit=` | 최근 항목 (캡처 + 링크) |
| `PATCH` | `/api/items/:id` | `{ done?, type?, title?, remindAt?, snoozeMinutes?, repeat? }` — 완료 토글(반복이면 다음 회차로) / 분류 수정 / 알림 설정·스누즈·해제 / `repeat:null`로 반복 중단 |
| `DELETE` | `/api/items/:id` | 항목 + chunks 삭제 |
| `GET` | `/api/stats` | 개수 |
| `POST` | `/api/digest` | 오늘의 다이제스트 즉시 전송 (자동으로도 하루 1회) |
| `POST` | `/telegram/webhook` | 텔레그램 업데이트 수신 (토큰 설정 시) |

## 환경변수

| 변수 | 기본 | 설명 |
| --- | --- | --- |
| `PORT` | `8787` | 서버 포트 |
| `TELEGRAM_BOT_TOKEN` | — | 설정 시 텔레그램 캡처 활성화 |
| `TELEGRAM_WEBHOOK_SECRET` | — | 웹훅 시크릿 토큰 (권장) |
| `TELEGRAM_CHAT_ID` | — | 다이제스트/알림 기본 수신 채팅 (캡처는 그 채팅으로 회신) |
| `NTFY_TOPIC` | — | 설정 시 ntfy push 알림 활성화 |
| `NTFY_URL` | `https://ntfy.sh` | 셀프호스트 ntfy 서버 주소 |
| `DIGEST_HOUR` | `9` | 매일 다이제스트 보낼 시각 (0–23) |
| `DEFAULT_REMIND_HOUR` | `9` | 날짜만 있는 할일의 기본 알림 시각 |
| `REMINDER_TICK_MS` | `60000` | 스케줄러 확인 주기 (ms) |
| `WHISPER_MODEL` | `Xenova/whisper-base` | 텔레그램 STT 모델 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | — | 서버 측 분류에 OpenAI 호환 LLM 사용 (선택) |

## 브라우저 확장 (링크 원클릭 저장)

1. `chrome://extensions` → **개발자 모드** 켜기
2. **압축해제된 확장 프로그램 로드** → `collective-brain/extension` 선택
3. 툴바 아이콘(또는 우클릭) → **Save to Collective Brain**

## 다음 단계 (같은 무료 스택)

- ✅ ~~할일 리마인드 / 다이제스트 push (ntfy / 텔레그램)~~ — 구현됨
- ✅ ~~반복 알림 (매일 / 매주 X / 격주 / 매월)~~ — 구현됨
- 🗓️ Resend 이메일 다이제스트, 캘린더(.ics) 내보내기, 평일(월–금) 반복
- 👥 다중 사용자 + 인증 (Appwrite / Supabase)
- ☁️ 배포: Cloudflare Workers + D1/R2; 코퍼스가 커지면 JSON 스토어를
  Vectorize / Qdrant / Pinecone로 교체
- 🔁 중복 병합, 저장 검색, "오늘 한 일" 자동 요약

## 메모

- JSON 스토어(`data/brain.json`, git-ignore)는 개인/소그룹 MVP용입니다. 코퍼스가
  커지면 `store.js` + `embed.js` 유사도 단계를 실제 벡터 DB로 교체하세요.
- 전부 키 없음 설계입니다. 어떤 제공자의 무료 정책이 바뀌면 해당 어댑터
  (`extract.js` / `embed.js` / `stt.js` / Puter 호출)만 교체하면 됩니다.
- 임베딩 모델은 첫 실행 시 Hugging Face에서 다운로드합니다. 외부망이 막힌
  환경에선 미리 받아두거나 모델을 로컬에 캐시해야 합니다.
