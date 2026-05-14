# Gmail to Slack Integration - Debugging Guide

## Issue Summary
Gmail responses are not triggering Slack notifications, even though the Slack webhook URL works (tested with curl).

## Root Causes Identified

### 1. **Silent Failures in Error Handling**
- The `sendSlackAlert()` function was catching errors but not re-throwing them
- Email processing would continue even if Slack notifications failed
- **Fixed**: Now errors are logged with full details and propagated

### 2. **Slack Alerts Only Sent for "Important" Emails**
- Replies must be classified as `important: true` by the AI to trigger a Slack notification
- Incoming responses might not be marked as important by default
- **Solution**: Check classification logic or adjust AI prompts

### 3. **Polling Might Not Be Running**
- Emails are only fetched if either:
  - You call `POST /polling/start` to enable automatic polling
  - You manually call `POST /process`
- If polling isn't running, new emails won't be detected

### 4. **Missing Logs for Debug Information**
- Default log level is `info`, which doesn't show why emails aren't being alerted
- Need to enable debug logging to see classification details

---

## Debugging Steps

### Step 1: Enable Debug Logging
Add to your `.env` file:
```
LOG_LEVEL=debug
```
Restart your application.

### Step 2: Verify Polling is Running
Check your application logs for:
```
"Running scheduled email check"
```
This message should appear every 30 seconds. If it doesn't:

**Start polling:**
```bash
curl -X POST http://localhost:3000/polling/start
```

Response should be:
```json
{
  "message": "Polling started",
  "intervalMs": 30000
}
```

### Step 3: Check Emails in Database
```bash
curl http://localhost:3000/emails | jq
```

Look for:
- Recent emails (check timestamps)
- Their `category` values (should be "IMPORTANT", "ROUTINE", or "NOISE")
- Their `important` flag (true/false)

Example:
```json
{
  "emails": [
    {
      "id": 1,
      "sender": "colleague@example.com",
      "subject": "Re: Project Update",
      "category": "ROUTINE",
      "important": false,  // ← THIS IS THE ISSUE
      "priority": 2,
      "createdAt": "2026-05-14T10:30:00Z"
    }
  ]
}
```

### Step 4: Test Classification Directly
To understand why replies aren't being classified as important:

1. Look at your AI prompt in [src/ai/classify.ts](src/ai/classify.ts)
2. The rules prioritize "known contacts, managers, clients, urgent issues, time-sensitive"
3. **Your replies might have a generic sender** that doesn't match these criteria

### Step 5: Manual Email Processing Test
To test if Slack alerts work for NEW emails:

1. Send yourself an email from a known contact
2. Run:
   ```bash
   curl -X POST http://localhost:3000/process
   ```
3. Check logs for:
   - `Email classified` - Did it classify correctly?
   - `Slack alert sent` - Was the alert sent?
   - `Failed to send Slack notification` - Any errors?

---

## Solutions

### Solution 1: Improve Email Classification
The AI might not recognize replies as important. Modify [src/ai/classify.ts](src/ai/classify.ts):

```typescript
const SYSTEM_PROMPT = `...
Classification Rules:
- IMPORTANT: From known contacts, managers, clients, urgent issues, time-sensitive, RE: (replies), direct responses
- ROUTINE: Regular communication, updates, confirmations
- NOISE: Newsletters, marketing, spam, automated notifications
...`
```

### Solution 2: Force Important Classification for Replies
Add a check in email classification to mark any email with "Re:" or "Fwd:" as important:

In [src/index.ts](src/index.ts), add before storing in database:
```typescript
let classification = await classifyEmail(email);

// Force important flag for replies
if (email.subject.startsWith('Re:') || email.subject.startsWith('Fwd:')) {
  classification.important = true;
  classification.priority = Math.max(classification.priority, 7);
}
```

### Solution 3: Create a Separate Thread Tracking System
Track sent draft replies and monitor their threads:

```typescript
// After creating a draft, store the thread ID
await prisma.trackedThread.create({
  data: {
    threadId: email.threadId,
    subject: email.subject,
    initiatingEmail: email.messageId,
  },
});

// When processing emails, check if they're replies to tracked threads
const trackedThread = await prisma.trackedThread.findUnique({
  where: { threadId: email.threadId },
});

if (trackedThread) {
  // This is a reply to something we sent - always alert
  await sendSlackAlert(...);
}
```

### Solution 4: Verify Slack Webhook URL
Make sure your Slack webhook URL is correct:

```bash
# Test directly
curl -X POST https://hooks.slack.com/services/T.../B.../XXX \
  -H 'Content-type: application/json' \
  -d '{
    "text": "Test message from debug"
  }'
```

---

## Common Issues & Fixes

| Issue | Symptom | Fix |
|-------|---------|-----|
| Polling not running | No "Running scheduled email check" in logs | Call `POST /polling/start` |
| Emails not fetched | Database is empty | Check Gmail OAuth2 credentials |
| Emails fetched but not alerted | Database has emails with `important: false` | Check classification rules |
| Slack calls failing silently | No error in logs (old code) | Update to latest code with error handling |
| Wrong Slack webhook | No errors but messages don't appear | Test webhook URL directly with curl |

---

## Next Steps

1. **Enable debug logging** and restart
2. **Start polling** if not already running
3. **Send a test email** from a known contact
4. **Check logs** for classification and Slack alert messages
5. **Review database** to confirm emails are stored correctly
6. **Implement Solution 2 or 3** if classification isn't working as expected

## Log Files Location
- Development logs: Check your terminal running the Node.js server
- The logs include timestamps and should show all the steps mentioned above
