#!/usr/bin/env bash
# Deploy SuperKay to Google Cloud Run with Neon Postgres + Secret Manager.
# Free tier covers all usage for personal email volumes.
#
# Prereqs:
#  - gcloud CLI installed and authenticated:   gcloud auth login
#  - GCP project created with billing enabled (free tier still requires it)
#  - Neon Postgres DB created → grab connection string
#
# Usage:
#   PROJECT_ID=my-gcp-project \
#   NEON_DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/superkay?sslmode=require" \
#   GROQ_API_KEY=gsk_... \
#   GMAIL_CLIENT_ID=... \
#   GMAIL_CLIENT_SECRET=... \
#   SLACK_BOT_TOKEN=xoxb-... \
#   SLACK_SIGNING_SECRET=... \
#   SLACK_CHANNEL_ID=C0... \
#   TELEGRAM_BOT_TOKEN=... \
#   TELEGRAM_CHAT_ID=... \
#   ./scripts/deploy.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID env var}"
NEON_DATABASE_URL="${NEON_DATABASE_URL:?Set NEON_DATABASE_URL env var}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-superkay}"

# Optional vars (warn if missing but don't block).
GROQ_API_KEY="${GROQ_API_KEY:-}"
GMAIL_CLIENT_ID="${GMAIL_CLIENT_ID:-}"
GMAIL_CLIENT_SECRET="${GMAIL_CLIENT_SECRET:-}"
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-}"
SLACK_SIGNING_SECRET="${SLACK_SIGNING_SECRET:-}"
SLACK_CHANNEL_ID="${SLACK_CHANNEL_ID:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

echo "==> Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT_ID"

echo "==> Building and deploying to Cloud Run..."
gcloud builds submit \
  --project "$PROJECT_ID" \
  --config cloudbuild.yaml \
  --substitutions=_REGION="$REGION",_SERVICE="$SERVICE"

SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(status.url)')

echo "==> Service deployed: $SERVICE_URL"

# ----- Grant the Cloud Run service account access to Secret Manager -----
echo "==> Granting Secret Manager access to Cloud Run service account..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.admin" \
  --condition=None \
  > /dev/null

# ----- Set env vars on the Cloud Run service -----
echo "==> Setting env vars on Cloud Run service..."
ENV_VARS="DATABASE_URL=${NEON_DATABASE_URL}"
ENV_VARS+=",GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"
ENV_VARS+=",GMAIL_REDIRECT_URI=${SERVICE_URL}/auth/callback"
[ -n "$GROQ_API_KEY" ]        && ENV_VARS+=",GROQ_API_KEY=${GROQ_API_KEY}"
[ -n "$GMAIL_CLIENT_ID" ]     && ENV_VARS+=",GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID}"
[ -n "$GMAIL_CLIENT_SECRET" ] && ENV_VARS+=",GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET}"
[ -n "$SLACK_BOT_TOKEN" ]     && ENV_VARS+=",SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}"
[ -n "$SLACK_SIGNING_SECRET" ] && ENV_VARS+=",SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}"
[ -n "$SLACK_CHANNEL_ID" ]    && ENV_VARS+=",SLACK_CHANNEL_ID=${SLACK_CHANNEL_ID}"
[ -n "$TELEGRAM_BOT_TOKEN" ]  && ENV_VARS+=",TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}"
[ -n "$TELEGRAM_CHAT_ID" ]    && ENV_VARS+=",TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}"

gcloud run services update "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --set-env-vars "$ENV_VARS" \
  > /dev/null

# ----- Cloud Scheduler jobs (free tier: 3 jobs free) -----
echo "==> Creating Cloud Scheduler jobs..."

# Allow Scheduler service account to invoke Cloud Run (if private).
# We deploy with --allow-unauthenticated in cloudbuild.yaml, so this is fine,
# but creating the jobs idempotently:

create_or_update_job() {
  local name="$1"
  local schedule="$2"
  local path="$3"
  if gcloud scheduler jobs describe "$name" --location="$REGION" --project="$PROJECT_ID" > /dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" \
      --location="$REGION" --project="$PROJECT_ID" \
      --schedule="$schedule" \
      --uri="${SERVICE_URL}${path}" \
      --http-method=POST \
      > /dev/null
  else
    gcloud scheduler jobs create http "$name" \
      --location="$REGION" --project="$PROJECT_ID" \
      --schedule="$schedule" \
      --uri="${SERVICE_URL}${path}" \
      --http-method=POST \
      > /dev/null
  fi
  echo "    job: $name ($schedule) -> $path"
}

create_or_update_job superkay-process    "* * * * *" /process
create_or_update_job superkay-escalate   "* * * * *" /escalate/check

echo ""
echo "================================================================"
echo "  ✅ SuperKay is deployed and running 24/7."
echo "================================================================"
echo ""
echo "  Service URL:   $SERVICE_URL"
echo ""
echo "  Next steps (do each ONCE):"
echo ""
echo "  1. Add this redirect URI to your Gmail OAuth client in"
echo "     Google Cloud Console (APIs & Services → Credentials):"
echo "       ${SERVICE_URL}/auth/callback"
echo ""
echo "  2. Update your Slack app's Interactivity Request URL to:"
echo "       ${SERVICE_URL}/slack/actions"
echo ""
echo "  3. Authenticate Gmail on the deployed instance — visit:"
echo "       ${SERVICE_URL}/auth/url"
echo "     Open the returned URL, authorize, done. Token is saved to"
echo "     Google Secret Manager (survives restarts forever)."
echo ""
echo "  After step 3, you can close this terminal and forget about it."
echo "  Cloud Scheduler pings /process and /escalate/check every minute."
echo "================================================================"
