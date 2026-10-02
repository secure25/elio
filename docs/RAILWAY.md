# Deploying Elio on Railway

## TL;DR — the one rule

**Elio's SQLite database must live on a Railway volume.** If it stays in the
container's writable layer, every redeploy silently wipes: all user accounts,
sessions, the Telegram chat ID (vault), memories, reminders — everything.
Symptoms of a wiped DB:

- "Invalid email or password" for an account you *know* you registered
- "Telegram isn't fully connected" right after you linked it
- having to sign up again "as a new user" after every deploy

## Verify your deployment

1. Deploy log shows the resolved path on boot:

   ```
   [elio] database: /data/muse.db     ← good (volume mount)
   [elio] database: /app/data/muse.db ← BAD (container layer — will be wiped)
   ```

2. In Railway: your service → **Volumes** tab → a volume must be **mounted at
   `/data`** (the exact mount path matters).

3. Set the env var so the app actually uses it:

   ```
   ELIO_DATA_DIR=/data
   ```

## Required environment variables

| Variable | Purpose |
|---|---|
| `ELIO_DATA_DIR=/data` | DB + vault + downloads live here (volume) |
| `LLM_PROVIDER` | `qwen`, `gemini`, `groq`, `openrouter`, or `cleanapis` |
| `QWEN_BASE_URL` / `QWEN_MODEL` / `QWEN_API_TOKEN` | Self-hosted llama-server endpoint (e.g. Tailscale) |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` | Failover providers |
| `EXA_API_KEY` | Web search |
| `VAULT_SECRET` | AES-256-GCM key for credential vault. **Changing it makes stored secrets undecryptable** |
| `TELEGRAM_BOT_TOKEN` | From BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret Telegram sends in the `x-telegram-bot-api-secret-token` header |
| `NEXT_PUBLIC_APP_URL=https://<your-app>.up.railway.app` | Used for webhook registration + password-reset links |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail connector OAuth |

## Telegram wiring (one-time, survives redeploys once on a volume)

1. Register the webhook **with** the secret:

   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d "url=https://<your-app>.up.railway.app/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

2. Message the bot **once** from your Telegram account (e.g. `/start`) — the
   first message auto-links your chat ID into the vault. No app-side step.

3. Test both directions: the bot replies to your messages, and in-app
   "send me a Telegram message" arrives on your phone.

## Password reset email

The forgot-password flow emails the reset link through the Gmail connector,
hard-locked to the account owner's connected address. Gmail must be connected
(with the same address as the Elio account) for reset emails to arrive.

## After changing `VAULT_SECRET` or wiping the volume

Re-run once, by hand: `/start` on Telegram (re-links chat ID) → Settings →
Connectors (Gmail OAuth) → re-enter any other vault credentials. Everything
else (users, sessions) survives once the DB is on the volume.
