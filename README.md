# AI Inbox Assistant

A production-quality AI-powered email assistant that intelligently processes, classifies, and responds to emails using OpenAI and Gmail.

## Features

- ✅ Reads unread Gmail emails
- ✅ Normalizes email data
- ✅ Uses OpenAI to classify importance and summarize emails
- ✅ Sends Slack alerts for important emails
- ✅ Generates Gmail draft replies for routine emails
- ✅ Stores processed emails in SQLite with Prisma ORM
- ✅ Prevents duplicate processing
- ✅ Scheduled polling every 30 seconds
- ✅ Built-in safety mechanisms against prompt injection

## Architecture

```
Unread Gmail Poller
        ↓
Message Normalizer
        ↓
OpenAI Classification Engine
        ↓
┌──────────────┬───────────────┐
↓              ↓               ↓
Slack Alert   Draft Reply   Store in DB
```

## Tech Stack

- **Backend**: Node.js, TypeScript, Fastify
- **AI**: OpenAI API (GPT-4 Turbo)
- **Email**: Gmail API
- **Database**: SQLite + Prisma ORM
- **Notifications**: Slack Incoming Webhooks
- **Logging**: Pino

## Prerequisites

- Node.js 18+
- npm or yarn
- Google Cloud account (for Gmail API)
- OpenAI API key
- Slack workspace (for webhooks)

## Setup Instructions

### 1. Clone and Install

```bash
git clone <repo-url>
cd ai-inbox-assistant
npm install
```

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the Gmail API
4. Create OAuth2 credentials:
   - Type: Web application
   - Authorized redirect URIs: `http://localhost:3000/auth/callback`
5. Download the credentials JSON
6. Note your `Client ID` and `Client Secret`

### 3. Slack Webhook Setup

1. Go to your Slack workspace
2. Create an Incoming Webhook:
   - Visit https://api.slack.com/apps
   - Create New App > From scratch
   - Enable Incoming Webhooks
   - Add New Webhook to Workspace
   - Choose a channel (or direct message)
3. Copy the Webhook URL

### 4. OpenAI API Setup

1. Sign up at [OpenAI](https://platform.openai.com/)
2. Create an API key
3. Ensure you have API credits

### 5. Environment Configuration

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Fill in the values:

```env
# OpenAI
OPENAI_API_KEY=sk_test_...
OPENAI_MODEL=gpt-4-turbo-preview

# Gmail OAuth2
GMAIL_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=<your-client-secret>
GMAIL_REDIRECT_URI=http://localhost:3000/auth/callback

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL="file:./dev.db"

# Polling
POLLING_INTERVAL_MS=30000
```

### 6. Prisma Setup

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 7. Gmail Authentication

```bash
npm run dev
```

In another terminal:

```bash
curl http://localhost:3000/auth/url
```

Visit the auth URL in your browser, authorize the application, and you'll be redirected with your tokens.

## Running Locally

### Development Mode

```bash
npm run dev
```

The server starts on `http://localhost:3000`

### Production Build

```bash
npm run build
npm start
```

## API Endpoints

### Health Check

```bash
GET /health
```

Returns: `{ "status": "ok" }`

### Get Auth URL

```bash
GET /auth/url
```

Returns the Google OAuth authorization URL.

### OAuth Callback

```bash
GET /auth/callback?code=<auth-code>
```

Handles OAuth callback and stores credentials.

### Process Emails (Manual)

```bash
POST /process
```

Fetches unread emails, classifies them, sends alerts, and creates drafts.

Returns:
```json
{
  "message": "Emails processed",
  "processed": 5,
  "total": 5
}
```

### Get Processed Emails

```bash
GET /emails
```

Returns last 50 processed emails.

### Get Emails by Category

```bash
GET /emails/category/IMPORTANT
```

Returns processed emails by category: `IMPORTANT`, `ROUTINE`, or `NOISE`.

### Start Polling

```bash
POST /polling/start
```

Starts automatic email polling every 30 seconds.

Returns:
```json
{
  "message": "Polling started",
  "intervalMs": 30000
}
```

### Stop Polling

```bash
POST /polling/stop
```

Stops automatic email polling.

## Classification Output

Emails are classified with:

```json
{
  "important": boolean,
  "priority": 1-10,
  "category": "IMPORTANT" | "ROUTINE" | "NOISE",
  "summary": "concise summary",
  "reason": "why classified this way",
  "reply_needed": boolean,
  "draft_reply": "generated reply or null",
  "confidence": 0.0-1.0
}
```

## Safety Features

- ✅ Defense against prompt injection in emails
- ✅ No auto-sending of emails (drafts only)
- ✅ No automatic deletion or archiving
- ✅ No execution of email instructions
- ✅ Duplicate prevention via unique message IDs
- ✅ Confidence scoring to catch uncertain classifications
- ✅ Comprehensive error handling

## Database Schema

```prisma
model ProcessedEmail {
  id        String   @id @default(cuid())
  messageId String   @unique
  threadId  String
  sender    String
  subject   String
  body      String
  category  String   @default("ROUTINE")
  summary   String
  important Boolean  @default(false)
  priority  Int      @default(1)
  confidence Float   @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## Development Commands

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Open Prisma Studio
npm run prisma:studio

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Workflow Example

1. **Start the server**: `npm run dev`
2. **Authenticate Gmail**: Visit the auth URL and authorize
3. **Start polling**: `curl -X POST http://localhost:3000/polling/start`
4. **Check emails**: `curl http://localhost:3000/emails`
5. **Receive Slack alerts** for important emails automatically
6. **Check Gmail drafts** for suggested replies
7. **Review database**: `npm run prisma:studio`

## Future Improvements

- [ ] User authentication and multi-account support
- [ ] Gmail webhook integration (remove polling)
- [ ] Web UI for managing emails
- [ ] Advanced filtering and search
- [ ] Custom classification rules per user
- [ ] Email attachments handling
- [ ] Conversation threading
- [ ] Analytics dashboard
- [ ] Auto-learning from user feedback
- [ ] Support for other email providers
- [ ] Batch processing optimization
- [ ] Rate limiting and backoff strategies

## Troubleshooting

### Gmail Authentication Failed

- Verify Client ID and Secret are correct
- Check redirect URI matches exactly
- Ensure Gmail API is enabled in Google Cloud Console

### OpenAI API Errors

- Verify API key is valid
- Check API quota and billing
- Ensure model name is correct

### Slack Notifications Not Sending

- Verify Webhook URL is correct
- Check Slack workspace and channel
- Review server logs for errors

### Database Issues

- Delete `dev.db` and run migrations again
- Check `prisma/schema.prisma` for syntax errors
- Ensure DATABASE_URL is set correctly

## License

MIT

## Support

For issues or questions, please create a GitHub issue.
