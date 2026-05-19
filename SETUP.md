# SuperKay — Setup Guide

End-to-end pipeline:

```
Gmail (unread)
   │
   ▼
Groq LLM classify + summarise (important?)
   │
   ├─ Important ─▶ Slack alert (clean summary)  ──┐
   │                                              ├─ 10 min no reply ─▶ Telegram bot pings you
   │              Reply from Slack ──▶ AI polishes your casual text ──▶ sends real email
   │
   └─ Not important ─▶ AUTO-SEND polite reply (skipped for no-reply senders)
```

All free-tier: Groq for the LLM, Gmail API, Slack, your own Telegram bot, Google Cloud Run, Neon Postgres, Google Secret Manager.

**Deploy once, forget forever.** After the one-time setup below, the app runs 24/7 on Google Cloud Run, pinged every minute by Cloud Scheduler. You don't run anything on your machine.

---

## 1. Accounts to create (10 min total)

### a) Groq (AI classifier)
1. Sign up at <https://console.groq.com> — free, no credit card.
2. Create an API key.
3. Save as `GROQ_API_KEY`.

### b) Gmail API
1. <https://console.cloud.google.com/> → create a project (this is also your `PROJECT_ID`).
2. APIs & Services → **Enable Gmail API**.
3. OAuth consent screen → External, add your email as a test user.
4. Credentials → **Create credentials → OAuth client ID → Web application**.
5. Authorized redirect URIs (add both):
   - `http://localhost:3000/auth/callback` (for local testing)
   - `https://<service-url>/auth/callback` (added after first deploy)
6. Save Client ID + Client Secret.

### c) Slack
1. <https://api.slack.com/apps> → **Create new app → From scratch**.
2. **OAuth & Permissions** → Bot Token Scopes: `chat:write`, `chat:write.public`.
3. Install to workspace → copy **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`.
4. **Basic Information** → Signing Secret → `SLACK_SIGNING_SECRET`.
5. **Interactivity & Shortcuts** → toggle on → leave URL blank for now; you'll set it after deploy.
6. Create a dedicated channel (e.g. `#superkay-alerts`), invite the bot (`/invite @YourBotName`), and copy the channel ID (channel name at top → bottom of details panel). Save as `SLACK_CHANNEL_ID`.

### d) Telegram bot (escalation channel)
1. In Telegram, message **`@BotFather`** → `/newbot`.
2. Pick display name + username ending in `bot`. Save the token → `TELEGRAM_BOT_TOKEN`.
3. Open chat with your new bot, send any message (e.g. `hi`).
4. Run: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` — find `chat.id` in the JSON. Save → `TELEGRAM_CHAT_ID`.
5. Sanity test:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
     -d "chat_id=<CHAT_ID>" -d "text=hello"
   ```

### e) Neon Postgres (persistent database, free)
1. Sign up at <https://neon.tech> — free, no credit card.
2. Create a project (e.g. `superkay`).
3. Copy the **connection string** (looks like `postgresql://user:pass@ep-xxx.neon.tech/superkay?sslmode=require`).
4. Save as `NEON_DATABASE_URL`.

### f) Google Cloud project (for Cloud Run + Secret Manager)
1. Already done in step (b). Make sure **billing is enabled** on the project — Google requires it even for free-tier usage, but you won't be charged for the volumes here.
2. Install the `gcloud` CLI: <https://cloud.google.com/sdk/docs/install>
3. `gcloud auth login`
4. `gcloud config set project YOUR_PROJECT_ID`

---

## 2. Optional: test locally first (skip to step 3 if you want to go straight to deploy)

```bash
cd /Users/karthikshambuni/SuperKay
cp .env.example .env   # then fill in values (already done if you used this guide)
npm install
npx prisma migrate dev --name init   # against your Neon DB
npm run check                        # verifies env, Slack, Gmail, Groq, Telegram
npm run dev
```

Visit <http://localhost:3000/auth/url>, open the OAuth URL, authorize Gmail.

For Slack interactivity locally, you need ngrok:
```bash
ngrok http 3000
# put https://xxxx.ngrok-free.app/slack/actions into Slack's Interactivity URL
```

> The local SQLite file is gone now that you've switched to Postgres. The `npx prisma migrate dev` command above creates the schema on Neon.

---

## 3. Deploy to Cloud Run (one command, ~3 min)

```bash
cd /Users/karthikshambuni/SuperKay

# Clean up old SQLite migrations (they're sqlite-only — Postgres needs fresh ones)
rm -rf prisma/migrations

PROJECT_ID=your-gcp-project \
NEON_DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/superkay?sslmode=require" \
GROQ_API_KEY=gsk_... \
GMAIL_CLIENT_ID=...apps.googleusercontent.com \
GMAIL_CLIENT_SECRET=GOCSPX-... \
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
SLACK_CHANNEL_ID=C0... \
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_CHAT_ID=... \
./scripts/deploy.sh
```

The script:
1. Enables Cloud Run, Cloud Build, Cloud Scheduler, Secret Manager APIs.
2. Builds the Docker image and deploys to Cloud Run (min-instances=1).
3. Grants the Cloud Run service account access to Secret Manager.
4. Sets all your env vars on the service.
5. Creates two Cloud Scheduler jobs that hit `/process` and `/escalate/check` every minute.
6. Prints the service URL and the 3 final manual steps.

### After deploy — 3 one-time steps the script reminds you about:

1. **Add the Cloud Run redirect URI** to your Gmail OAuth client:
   - Google Cloud Console → APIs & Services → Credentials → your OAuth client
   - Add: `https://<service-url>/auth/callback`
2. **Update Slack** → Interactivity & Shortcuts → Request URL:
   - `https://<service-url>/slack/actions`
3. **Authenticate Gmail on the deployed instance:**
   - Visit `https://<service-url>/auth/url`
   - Open the returned URL, approve
   - Token is saved to Google Secret Manager → survives all restarts forever

That's it. The app now runs 24/7. You can close your laptop.

---

## 4. Endpoints

| Method | Path                       | Purpose                                      |
| ------ | -------------------------- | -------------------------------------------- |
| GET    | `/health`                  | Liveness check                               |
| GET    | `/auth/url`                | Get Gmail OAuth URL                          |
| GET    | `/auth/callback`           | OAuth redirect target                        |
| POST   | `/process`                 | Pull + classify + alert/auto-reply once (Cloud Scheduler hits this) |
| POST   | `/escalate/check`          | Run escalation check once (Cloud Scheduler hits this) |
| POST   | `/slack/actions`           | Slack interactivity webhook                  |
| GET    | `/emails`                  | Last 50 processed emails                     |
| GET    | `/emails/category/:cat`    | Filter by `IMPORTANT` / `ROUTINE` / `NOISE`  |

---

## 5. Behavior

| Email type        | What happens                                                              |
| ----------------- | ------------------------------------------------------------------------- |
| Important         | Slack alert with summary + Reply/Dismiss buttons. Gmail draft created.    |
|                   | If no reply / dismiss in 10 min → Telegram bot pings you.                 |
| Routine / Noise   | Polite auto-reply sent automatically.                                     |
| no-reply@ sender  | Stored only — no reply sent, no Slack alert.                              |

When you reply via Slack, you can type **casual text** (e.g. `tell him I'll get back tomorrow`). The LLM rewrites it into a proper email before sending.

Tunables in env vars:
- `ESCALATION_TIMEOUT_MINUTES` — default 10
- `ESCALATION_CHECK_INTERVAL_MS` — how often the watcher checks (default 30 s)

---

## 6. Free-tier costs (current pricing as of 2026)

| Service              | Free tier                                | Your typical usage  |
| -------------------- | ---------------------------------------- | ------------------- |
| Cloud Run            | 2M req/mo, 360k GB-sec, 180k vCPU-sec    | ~50k req/mo         |
| Cloud Scheduler      | 3 jobs free                              | 2 jobs              |
| Secret Manager       | 6 active secret versions, 10k accesses/mo| 1 secret, ~30 acc/mo|
| Cloud Build          | 120 build-min/day                        | ~3 min/deploy       |
| Neon Postgres        | 0.5 GB storage, always-on                | ~10 MB / 10k emails |
| Groq API             | Generous free tier (rate-limited)        | well under          |
| Telegram Bot API     | Unlimited                                | -                   |

You should pay **$0/month** at this volume.

---

## 7. Phase 2 — future channels

Code is structured so adding WhatsApp / Telegram inbound / Instagram is mostly:
1. New `src/<channel>/<channel>.poller.ts` returning `NormalizedMessage[]`.
2. Calling `handleEmail()` (rename later) — same downstream logic.
3. New outbound `<channel>.reply.ts` triggered from the Slack reply modal.

`NormalizedMessage` already supports a `channel` discriminator.

---

## 8. Troubleshooting

| Symptom                                       | Fix                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `prisma migrate deploy` fails on Cloud Run    | Check `DATABASE_URL` is set and reachable from Cloud Run.           |
| Cloud Run boots but Gmail auth missing        | Visit `/auth/url` on the deployed URL once.                         |
| Slack escalation never fires                  | Confirm `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are set.          |
| Secret Manager access denied                  | Re-run deploy script (it sets IAM); or grant manually:              |
|                                               | `gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:<NUM>-compute@developer.gserviceaccount.com --role=roles/secretmanager.admin` |
| Cloud Scheduler isn't hitting Cloud Run       | Check `gcloud scheduler jobs list --location=us-central1` — should show two jobs `superkay-process` and `superkay-escalate`. |
| Want to update the deployed code              | `./scripts/deploy.sh` again — it's idempotent.                       |
