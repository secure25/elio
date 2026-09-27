# Elio — a fully functional personal AI agent

A self-hosted, from-scratch clone of **Meta's Muse** (renamed **Elio**) (launched Sep 2026): a chat-first agent
that *does* tasks — browses the web, sends email, manages your calendar, researches and
negotiates — with Muse's signature safety architecture rebuilt end-to-end:

| Muse concept | This clone |
|---|---|
| Muse Secure VM (per-user isolated agent computer) | Everything runs locally in this app; state in SQLite at `data/` |
| **Sentinel** (separate approval agent, system-level) | `src/lib/sentinel.ts` — a distinct policy engine; every effectful action passes it; sensitive ones queue for *your* click |
| Credential surrogation (agent never sees secrets) | AES-256-GCM vault; the model only ever sees `{{vault:label}}` tokens; real values are resolved *only* inside connector code |
| Browser sub-agent (a11y tree, no raw HTML, no JS) | Playwright browser; the model sees an accessibility tree with element refs, never HTML, and cannot run page JavaScript |
| Visible browser (watch it work) | Live screenshot panel in the chat UI — a frame is captured after every browser action and streamed to `GET /api/browser/screenshot` |
| Approval gates + full audit trail | Approvals inbox (chat + `/approvals`) and complete audit log at `/audit` |
| Long-term memory, "forget X" | Auto-extracted durable facts, `/memory` page, `forget` tool |
| Proactive suggestions | **Morning digest**: every day at a configurable hour, Elio summarizes background goal progress, pending approvals, calendar/inbox signals, and suggests next actions — shown as a chat banner, a `/digests` page, and a sidebar unread badge |
| Works after you close the app | Tasks run server-side in a queue; results land back in the conversation |
| One-time virtual cards | Vault surrogation + approval flow; final payment step is deliberately left to you |

## Stack

- **Next.js 15 + TypeScript + Tailwind** (App Router, Node runtime)
- **SQLite via `node:sqlite`** — no native compilation needed
- **LLM: free-tier cloud models via a pluggable adapter**
  - default: **Google Gemini** free tier (`gemini-flash-latest` alias, free API key from AI Studio)
  - one-line swap: **Groq** or **OpenRouter** free models (OpenAI-compatible adapter)
- **Real integrations**: Gmail + Google Calendar (hand-rolled OAuth 2.0, REST), live web
  (fetch + DuckDuckGo search), real browser (Playwright)

## Quick start

```bash
npm install
cp .env.example .env    # then fill in the values below
npm run dev             # http://localhost:3210
```

### 1. LLM key (required, free)

Get a free key at <https://aistudio.google.com/apikey> → set in `.env`:

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key
```

Prefer Groq or OpenRouter free models instead? Set `LLM_PROVIDER=groq` (+ `GROQ_API_KEY`)
or `LLM_PROVIDER=openrouter` (+ `OPENROUTER_API_KEY`).

### 2. Vault secret (required)

```
VAULT_SECRET=<any long random string>
```

Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 3. Google OAuth (optional — for Gmail/Calendar)

1. <https://console.cloud.google.com> → create project → **APIs & Services → Library** →
   enable **Gmail API** and **Calendar API**.
2. **OAuth consent screen**: External, add yourself as a test user.
3. **Credentials → Create credentials → OAuth client ID** → type *Web application* →
   add Authorized redirect URI: `http://localhost:3210/api/oauth/google/callback`
4. Put the client ID/secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Then connect Gmail/Calendar on the **Connectors** page in the app.

### 4. Voice mode (optional)

Toggle **🔊 Voice** in the chat bar. You talk with the mic (or hold **Space**), Elio
replies out loud, and it stops talking the moment you start. Design:

- **Listening** — browser **Web Speech API** (Chrome/Edge): audio is transcribed by the
  browser, never uploaded to this app; the transcript enters chat like typed text.
- **Speaking** — two engines you can switch between **live** in
  **Settings → Behavior → Speech Engine** (no restart; stored in the DB, default `auto`;
  `TTS_PROVIDER` env is the fallback default when nothing is stored there):
  - **ElevenLabs (cloud)** — high-fidelity neural voice via the official REST API;
    configurable via `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL_ID`, defaults: Roger (male) /
    `eleven_multilingual_v2`. Spoken text is sent to ElevenLabs.
    **Free-plan caveat (verified):** free accounts can synthesize with the ~20 *premade*
    voices already in the account (Roger, Sarah, Laura, …), but **Voice Library voices**
    — e.g. the classic default "Rachel" — are paid-only via the API (`402 paid_plan_required`).
    Use a premade ID or create your own voice in the Voice Lab (Voice Design is free; instant
    voice cloning needs Starter).
  - **Offline (private)** — spoken text **never leaves this machine**. Engine chain:
    **Piper** neural TTS (`npm run setup:voice`, male `en_US-ryan-medium` model by
    default; pick another with `VOICE_MODEL=en_US-joe-medium npm run setup:voice`),
    falling back to **Windows SAPI**.

  In auto mode, if the cloud engine fails (dead key, quota, network), Elio degrades to the
  best local engine automatically, re-probes the cloud after 5 minutes, and
  `/api/voice/status` plus the chat voice bar show the exact reason instead of failing silently.
  (Same behavior as `local`, except auto *starts* with the cloud engine.)

  Synthesis is cached on disk per engine+voice+text, so repeated phrases play instantly.
- **Privacy** — in offline mode nothing ever leaves the machine (STT in-browser, TTS
  on-device). In auto mode with an ElevenLabs key, synthesis text goes to ElevenLabs
  (their cloud) — that's the trade-off for maximum voice quality; STT still never leaves
  the browser.

> Piper's original repo was archived in Oct 2025; the maintained fork is
> [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0) with the
> MIT-era Windows binaries still available for a lighter install.

#### Want a unique ElevenLabs voice? (free)

1. Sign in at [elevenlabs.io](https://elevenlabs.io) → **Voices → Create new voice**.
2. Pick **Voice Design** (free): describe the voice in plain text (e.g. *"warm, calm
   American female, late 20s, friendly assistant"*), generate a few candidates, preview,
   and save the one you like. *(Instant Voice Cloning — cloning a real recording of a
   person — needs the paid Starter plan.)*
3. The saved voice appears in your account; click it and copy its **voice ID**
   (or open its details page and copy the ID under the name).
4. Set it in `.env`:
   ```
   ELEVENLABS_VOICE_ID=<your-voice-id>
   ```
   and restart the dev server. Custom voices you own always work via the API, on any plan.
5. Verify: `GET /api/voice/status` shows the new voice with no `note`, and the chat voice
   bar reads `ElevenLabs · <voice id>` with no warning.

### 5. Browser sub-agent (optional)

```bash
npm run setup:browser   # one-time Chromium download for Playwright
```

Once installed, the chat page shows the **Secure workspace — live browser** panel: every
`browser.goto/click/fill/submit` captures a screenshot frame you can watch in real time
(1.5s polling while the agent works, expandable). The agent itself still only sees the
accessibility tree — the screenshots are for you, not the model.

## What you can ask it

- *"Find me a used road bike under $800 near Austin and email me the top 3 listings"*
  → browses, researches, drafts the email, **pauses for your approval**, sends.
- *"Check my calendar tomorrow morning and propose a lunch slot to Alex"*
  → reads real calendar, drafts email, waits for approval.
- *"Remember I'm vegetarian and allergic to peanuts"* → stored to memory, reused later.
- *"Forget I mentioned the Austin move"* → memory forgotten.

### Real-world errands: bookings, orders, and phone messages

- **Bookings** — *"Book me a table for two at a good Thai place Friday 7pm and put it on my
  calendar"* → Elio researches options on the open web, creates the reservation as a
  **calendar event (Sentinel approval required)**, and can text you the confirmation.
- **Orders** — Elio browses and fills checkout forms, but **never enters card numbers or
  passwords** — it stops at the payment step and hands the final click to you (money moves
  only after Sentinel approval). For food pickup/delivery over the phone path, it can
  message you the order summary via Telegram/WhatsApp.
- **Phone messages** — connect **Telegram** (free Bot API) and/or **WhatsApp** (Cloud API,
  Meta-hosted, free tier) in Connectors; Elio can then message **you** (confirmations,
  reminders, order updates) — every send gated by the Sentinel, recipient locked in your
  encrypted vault, replies land in your normal messaging app.
- **Reminders** — *"remind me to call the dentist tomorrow 9am"* → durable reminder, fired
  on schedule as a chat message or a phone ping (Telegram/WhatsApp) — whichever you ask for.
- **Standing watches (monitors)** — *"watch the price of X and tell me when it drops under
  $30"*, *"keep an eye on my refund"* → Elio re-checks on a schedule (hourly / every 6h /
  daily), records a baseline, and **reports only when something changes** — in your chat,
  on the Tasks page, and in the morning digest. Pause or stop watches any time.
- **Background goals** — give a goal, Elio plans, works through it step by step, monitors
  progress, pauses for approvals when needed, and keeps operating while you're away.

Any `browser.submit`, `gmail.send`, `calendar.create/delete`, `message.send`, or payment-class
action is **blocked until you click Approve** — in the chat or on the Approvals page.
Everything, including Sentinel decisions and approvals, is permanently visible in the Audit trail.

## Proactive daily digest

An in-process scheduler (booted via Next.js `instrumentation.ts`) checks every 15 minutes
whether the daily digest is due (default **08:00**, configurable on the Digest page). If the
app wasn't running at the scheduled time, the digest is generated on the next start (catch-up).

The digest gathers real state — completed/in-progress/failed tasks, pending approvals,
next calendar events (if connected), unread mail count (if connected), recent memories —
then composes a summary + suggested next actions. With an LLM key configured it's written
by the model; without one, a clean deterministic digest is produced so you always get the
morning report. Preview anytime with **Generate now** on `/digests`.

### Actionable digests

Reply to the digest in chat and Elio acts — common replies are handled **deterministically**
(no LLM call: instant, free, and works even without an API key):

- **"retry the failed one"** / "run it again" → restarts failed tasks in the background


### Email delivery (opt-in)

On `/digests`, enable **Email it to me** (available once Gmail is connected on the
Connectors page). The morning digest is then delivered to your own inbox — the address of
the connected Google account — so you get it even when the app isn't open.

Safety model for unattended sending:
- You opt in explicitly; the toggle immediately sends the latest digest once so you can
  confirm delivery.
- The recipient is **hard-locked** to the connected account's own address (`grant.account_email`)
  — the pipeline physically cannot email anyone else.
- It uses a dedicated `gmail.send_digest` Sentinel rule and is **not an agent tool**: the LLM
  can never invoke it, and regular `gmail.send` still always requires your click-through approval.
- Every delivery (and the opt-in itself) is audit-logged; each digest row records its email
  status (`✉ emailed` / `email pending` / `email failed`). If Gmail isn't connected yet at
  delivery time, the scheduler retries once the connector is available.

## Architecture

```
src/
  lib/
    db.ts                 SQLite schema + helpers (node:sqlite)
    vault.ts              AES-256-GCM vault, surrogation, redaction
    sentinel.ts           policy engine: allow / ask / deny + approval queue
    google-oauth.ts       OAuth flow, encrypted token storage, auto-refresh
    memory.ts             long-term memory + LLM extraction + forget
    llm/
      types.ts            provider-agnostic adapter interface
      gemini.ts           Gemini free-tier adapter
      openai-compatible.ts Groq / OpenRouter adapter
      index.ts            provider selection from env
    connectors/
      web.ts              fetch + search (read-only)
      browser.ts          Playwright a11y-tree browser, gated submission
      gmail.ts            list/read (OTP-filtered) + approval-gated send
      gcal.ts             list + approval-gated create/delete
    agent/
      tools.ts            tool registry (schemas → connectors)
      loop.ts             LLM ↔ tools loop, steps persisted, events
      runner.ts           task queue, background execution, resume
  app/
    page.tsx              chat UI w/ live step timeline + approval cards
    tasks|approvals|audit|memory|connectors|settings/
    api/                  chat, approvals, audit, memories, settings,
                          connectors, oauth/start, oauth/callback, tasks
tests/                    sentinel policy, vault surrogation, OTP filter,
                          agent loop (fake LLM)
```

## Safety model

- The agent **never** sees passwords, tokens, or card numbers — vault surrogates only.
- Gmail reads filter one-time passcodes and password-reset links before the model sees them.
- Unknown/uncategorized effectful actions **fail closed** (human approval required).
- `gmail.delete` is denied outright.
- The browser tool cannot execute page JavaScript; form *submission* is approval-gated.
- Card/payment entry is always left to the human; the agent is instructed to stop and hand over.

## Scripts

```bash
npm run dev            # dev server on :3210
npm run build && npm start
npm test               # vitest
npm run typecheck      # tsc --noEmit
npm run setup:browser  # optional Chromium for the browser agent
npm run setup:voice    # optional Piper neural TTS (male en_US-ryan-medium, ~63 MB)
```
