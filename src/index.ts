import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { config } from './config/env';
import logger from './utils/logger';
import { getAuthUrl, setCredentials, getOAuth2Client, setOnTokenRefresh, getGmailClient } from './gmail/gmail.client';
import { fetchUnreadEmails, fetchEmailsByQuery, markAsProcessed } from './gmail/gmail.poller';
import { classifyEmail } from './ai/classify';
import { generateDraftReply } from './ai/draftReply';
import { polishDraft } from './ai/polishDraft';
import { sendSlackAlert } from './slack/slack.notify';
import { createGmailDraft } from './gmail/gmail.reply';
import prisma from './database/prisma';

const fastify = Fastify({
  logger: true,
});

fastify.register(fastifyCors);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// OAuth callback
fastify.get('/auth/callback', async (request, reply) => {
  const { code } = request.query as { code: string };

  if (!code) {
    return reply.code(400).send({ error: 'Missing authorization code' });
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    setCredentials(tokens);

    logger.info('Gmail authentication successful');
    return reply.send({
      message: 'Successfully authenticated with Gmail',
      tokens,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to authenticate with Gmail');
    return reply.code(500).send({ error: 'Authentication failed' });
  }
});

// Get auth URL
fastify.get('/auth/url', async () => {
  return { authUrl: getAuthUrl() };
});

// Mobile OAuth — redirect browser to Google
fastify.get('/auth/google/mobile', async (_request, reply) => {
  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
  });
  return reply.redirect(authUrl);
});

// Mobile OAuth callback — exchange code, create session, redirect to app
fastify.get('/auth/google/callback/mobile', async (request, reply) => {
  const { code, error } = request.query as { code?: string; error?: string };

  if (error || !code) {
    return reply.redirect(`superkay://auth?error=${encodeURIComponent(error ?? 'missing_code')}`);
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.email) {
      return reply.redirect('superkay://auth?error=no_email');
    }

    const user = await prisma.user.upsert({
      where: { email: userInfo.email },
      update: {
        name: userInfo.name ?? undefined,
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
      create: {
        email: userInfo.email,
        name: userInfo.name ?? undefined,
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    });

    const sessionToken = crypto.randomUUID();
    await prisma.mobileSession.create({
      data: {
        token: sessionToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Track this user for token-refresh persistence
    setCredentials(tokens, user.id);

    // Start polling if not already running (first sign-in after cold boot)
    if (!pollingInterval) startPolling(user.id);

    // Kick off a background initial sync so existing inbox emails appear immediately
    performInitialSync(user.id).catch((err) => logger.error({ err }, 'Background initial sync failed'));

    logger.info({ email: userInfo.email }, 'Mobile OAuth complete');
    return reply.redirect(`superkay://auth?token=${sessionToken}`);
  } catch (err) {
    logger.error({ err }, 'Mobile OAuth callback failed');
    return reply.redirect('superkay://auth?error=auth_failed');
  }
});

async function sendExpoPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (!pushToken.startsWith('ExponentPushToken[')) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ to: pushToken, title, body, data: data ?? {}, sound: 'default', priority: 'high' }),
  });
}

// Load credentials from Bearer token, returns userId or null
async function loadSession(authHeader?: string): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const session = await prisma.mobileSession.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.accessToken) {
    setCredentials({
      access_token: session.user.accessToken,
      refresh_token: session.user.refreshToken ?? undefined,
      expiry_date: session.user.tokenExpiry?.getTime(),
    }, session.userId);
  }
  return session.userId;
}

// Shared processing logic used by both /process and the polling interval
async function runProcessingCycle(userId: string | null): Promise<number> {
  const emails = await fetchUnreadEmails();
  if (emails.length === 0) return 0;

  let count = 0;
  for (const email of emails) {
    try {
      let classification = await classifyEmail(email);
      if (email.subject.startsWith('Re:') || email.subject.startsWith('Fwd:')) {
        classification = {
          ...classification,
          important: true,
          priority: Math.max(classification.priority, 7),
          reason: 'Automatic: This is a reply or forwarded message',
        };
      }
      const urgentWords = ['urgent', 'action required', 'critical', 'asap', 'emergency'];
      if (!classification.important && urgentWords.some((w) => email.subject.toLowerCase().includes(w))) {
        classification = {
          ...classification,
          important: true,
          category: 'IMPORTANT',
          priority: Math.max(classification.priority, 7),
        };
      }

      await prisma.processedEmail.create({
        data: {
          messageId: email.messageId,
          threadId: email.threadId,
          sender: email.sender,
          subject: email.subject,
          body: email.body,
          category: classification.category,
          summary: classification.summary,
          important: classification.important,
          priority: classification.priority,
          confidence: classification.confidence,
          ...(userId ? { userId } : {}),
        },
      });

      try {
        await sendSlackAlert({
          from: email.sender,
          subject: email.subject,
          priority: classification.priority,
          reason: classification.reason,
          summary: classification.summary,
          threadId: email.threadId,
        });
      } catch (slackError) {
        logger.error({ slackError: slackError instanceof Error ? slackError.message : String(slackError) }, 'Slack alert failed, continuing');
      }

      if (classification.reply_needed) {
        const draftReply = await generateDraftReply(email);
        if (draftReply) {
          await createGmailDraft({
            threadId: email.threadId,
            subject: email.subject,
            to: email.sender,
            replyText: draftReply,
          });
        }
      }

      // Push notification for important emails
      if (classification.important && userId) {
        try {
          const user = await prisma.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
          if (user?.pushToken) {
            sendExpoPushNotification(user.pushToken, email.subject, `From: ${email.sender}`, { messageId: email.messageId })
              .catch((err) => logger.error({ err }, 'Push notification failed'));
          }
        } catch (pushErr) {
          logger.error({ pushErr }, 'Failed to look up push token');
        }
      }

      await markAsProcessed(email.messageId);
      count++;
    } catch (error) {
      logger.error({ error, messageId: email.messageId }, 'Failed to process email');
    }
  }
  logger.info({ count }, 'Processing cycle complete');
  return count;
}

// Bulk import of recent inbox emails — uses Gmail labels (no AI) so it's fast and never rate-limited
async function performInitialSync(userId: string): Promise<number> {
  try {
    const emails = await fetchEmailsByQuery('in:inbox newer_than:30d', 50);
    if (emails.length === 0) return 0;

    const rows = emails.map((email) => {
      const labels = email.labelIds ?? [];
      const isReply = email.subject.startsWith('Re:') || email.subject.startsWith('Fwd:');
      const important = labels.includes('IMPORTANT') || isReply;
      const urgentWords = ['urgent', 'action required', 'critical', 'asap', 'emergency'];
      const isUrgent = urgentWords.some((w) => email.subject.toLowerCase().includes(w));
      return {
        messageId: email.messageId,
        threadId: email.threadId,
        sender: email.sender,
        subject: email.subject,
        body: email.body,
        category: important || isUrgent ? 'IMPORTANT' : 'ROUTINE',
        summary: email.subject,
        important: important || isUrgent,
        priority: important || isUrgent ? 7 : 3,
        confidence: 0.6,
        userId,
      };
    });

    // Insert all at once, skipping duplicates
    let count = 0;
    for (const row of rows) {
      try {
        await prisma.processedEmail.create({ data: row });
        count++;
      } catch {
        // Duplicate messageId — already synced, skip silently
      }
    }

    logger.info({ count }, 'Initial inbox sync complete');
    return count;
  } catch (err) {
    logger.error({ err }, 'Initial inbox sync failed');
    return 0;
  }
}

// Process emails manually
fastify.post('/process', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  try {
    logger.info('Manual email processing started');
    const count = await runProcessingCycle(userId);
    return reply.send({ message: count === 0 ? 'No unread emails' : 'Emails processed', processed: count });
  } catch (error) {
    logger.error({ error }, 'Failed to process emails');
    return reply.code(500).send({ error: 'Processing failed' });
  }
});

// Full inbox sync — imports up to 50 recent emails regardless of read status
fastify.post('/sync', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  try {
    const count = await performInitialSync(userId);
    return reply.send({ synced: count });
  } catch (error) {
    logger.error({ error }, 'Sync failed');
    return reply.code(500).send({ error: 'Sync failed' });
  }
});

// Get processed emails
fastify.get('/emails', async (request) => {
  const userId = await loadSession(request.headers.authorization);
  const emails = await prisma.processedEmail.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { emails, count: emails.length };
});

// Get processed emails by category
fastify.get('/emails/category/:category', async (request) => {
  const { category } = request.params as { category: string };
  const emails = await prisma.processedEmail.findMany({
    where: { category },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { emails, count: emails.length };
});

// Auto-generate a draft reply for a message (no user input needed)
fastify.get('/draft/:messageId', async (request, reply) => {
  const { messageId } = request.params as { messageId: string };
  const email = await prisma.processedEmail.findUnique({ where: { messageId } });
  if (!email) return reply.code(404).send({ error: 'Email not found' });
  try {
    const draft = await generateDraftReply({
      channel: 'gmail',
      messageId: email.messageId,
      threadId: email.threadId,
      sender: email.sender,
      subject: email.subject,
      body: email.body,
      timestamp: email.createdAt.toISOString(),
    });
    return reply.send({ draft: draft ?? '' });
  } catch (err) {
    logger.error({ err }, 'Failed to generate draft');
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'Generate failed' });
  }
});

// Get all emails in a thread
fastify.get('/thread/:threadId', async (request) => {
  const { threadId } = request.params as { threadId: string };
  const userId = await loadSession(request.headers.authorization);
  const emails = await prisma.processedEmail.findMany({
    where: { threadId, ...(userId ? { userId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  return { emails };
});

// Fetch full Gmail thread with all messages (sent + received) as chat data
fastify.get('/thread/:threadId/full', async (request, reply) => {
  const { threadId } = request.params as { threadId: string };
  const userId = await loadSession(request.headers.authorization);

  let userEmail = '';
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    userEmail = user?.email ?? '';
  }

  try {
    const gmail = getGmailClient();
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });

    function extractText(payload: Record<string, unknown> | null | undefined): string {
      if (!payload) return '';
      if (payload['mimeType'] === 'text/plain') {
        const bodyData = (payload['body'] as Record<string, unknown> | null)?.['data'];
        if (typeof bodyData === 'string') return Buffer.from(bodyData, 'base64').toString('utf-8');
      }
      const parts = payload['parts'] as Record<string, unknown>[] | null;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const t = extractText(part);
          if (t) return t;
        }
      }
      // Fallback: strip HTML tags so HTML-only emails aren't silently dropped
      if (payload['mimeType'] === 'text/html') {
        const bodyData = (payload['body'] as Record<string, unknown> | null)?.['data'];
        if (typeof bodyData === 'string') {
          const html = Buffer.from(bodyData, 'base64').toString('utf-8');
          return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
      return '';
    }

    const messages = (thread.data.messages ?? [])
    .filter((msg) => !msg.labelIds?.includes('DRAFT'))
    .map((msg) => {
      const headers = msg.payload?.headers ?? [];
      const h = (name: string) => headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      const from = h('From');
      const emailMatch = from.match(/<([^>]+)>/);
      const senderEmail = emailMatch ? emailMatch[1] : from.trim();
      const rawName = emailMatch ? from.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '') : '';
      const senderName = rawName || senderEmail.split('@')[0];

      let body = extractText(msg.payload as Record<string, unknown>);
      // Strip quoted reply chains
      body = body
        .split('\n')
        .filter((line) => !line.startsWith('>'))
        .join('\n')
        .replace(/\n*On .+wrote:[\s\S]*/s, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return {
        id: msg.id!,
        senderName,
        senderEmail,
        isMe: userEmail.length > 0 && senderEmail.toLowerCase() === userEmail.toLowerCase(),
        body: body.substring(0, 2000),
        timestamp: h('Date') || new Date().toISOString(),
      };
    }).filter((m) => m.body.length > 0);

    const participants = [...new Set(messages.map((m) => m.senderEmail))];
    return { messages, isGroup: participants.length > 2, participantCount: participants.length };
  } catch (err) {
    logger.error({ err, threadId }, 'Failed to fetch full thread');
    return reply.code(500).send({ error: 'Failed to fetch thread' });
  }
});

// Save Expo push token for the current user
fastify.post('/push-token', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const { token } = request.body as { token: string };
  if (!token) return reply.code(400).send({ error: 'token is required' });
  await prisma.user.update({ where: { id: userId }, data: { pushToken: token } });
  return { ok: true };
});

interface AttachmentPayload {
  name: string;
  mimeType: string;
  base64: string;
  size: number;
}

function buildRawEmail(
  to: string,
  subject: string,
  body: string,
  attachments: AttachmentPayload[]
): string {
  if (attachments.length === 0) {
    return [
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      `To: ${to}`,
      `Subject: ${subject}`,
      '',
      body,
    ].join('\r\n');
  }

  const boundary = `superkay_${Date.now()}`;
  const lines: string[] = [
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ];

  for (const att of attachments) {
    const b64Lines = att.base64.match(/.{1,76}/g) ?? [att.base64];
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.name}"`,
      '',
      ...b64Lines
    );
  }

  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

// Compose and send a brand-new email (not a reply)
fastify.post('/compose', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const { to, subject, body, attachments = [] } = request.body as {
    to: string;
    subject: string;
    body: string;
    attachments?: AttachmentPayload[];
  };
  if (!to?.trim() || !subject?.trim() || !body?.trim()) {
    return reply.code(400).send({ error: 'to, subject, and body are required' });
  }
  try {
    const gmail = getGmailClient();
    const raw = buildRawEmail(to.trim(), subject.trim(), body.trim(), attachments);
    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
    return reply.send({ sent: true });
  } catch (err) {
    logger.error({ err }, 'Failed to compose email');
    return reply.code(500).send({ error: 'Send failed' });
  }
});

// AI-generate a complete email draft (subject + body) from a plain-language intent
fastify.post('/compose/draft', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  const { to, intent, tone = 'professional' } = request.body as {
    to?: string;
    intent: string;
    tone?: string;
  };
  if (!intent?.trim()) return reply.code(400).send({ error: 'intent is required' });

  const prompt = `You are SuperKay, an AI email assistant. Draft a complete email.
${to ? `Recipient: ${to}` : ''}
Tone: ${tone}
What to say: ${intent}

Respond with ONLY this JSON (no markdown, no explanation):
{"subject": "the subject line here", "body": "the full email body here"}`;

  try {
    const { callOpenAIText } = await import('./ai/openai.client');
    const raw = await callOpenAIText(prompt);
    // Extract JSON even if the model wraps it in markdown fences
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
    if (!parsed.subject?.trim() || !parsed.body?.trim()) throw new Error('Incomplete draft');
    return reply.send(parsed);
  } catch (err) {
    logger.error({ err }, 'Failed to AI-draft email');
    return reply.code(500).send({ error: 'Draft generation failed' });
  }
});

// Convert CSV row data into a base64-encoded Excel (.xlsx) attachment
fastify.post('/compose/table', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  const { rows, filename = 'table' } = request.body as {
    rows: string[][];
    filename?: string;
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    return reply.code(400).send({ error: 'rows is required' });
  }

  try {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const base64 = buf.toString('base64');
    const safeName = (filename || 'table').replace(/[^a-zA-Z0-9_-]/g, '_');
    return reply.send({
      name: `${safeName}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64,
      size: buf.length,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to generate Excel');
    return reply.code(500).send({ error: 'Excel generation failed' });
  }
});

// Polish a casual draft into a professional reply (preview only — does not send)
fastify.post('/reply', async (request, reply) => {
  const { messageId, casualDraft } = request.body as { messageId: string; casualDraft: string };
  if (!messageId || !casualDraft?.trim()) {
    return reply.code(400).send({ error: 'messageId and casualDraft are required' });
  }
  const email = await prisma.processedEmail.findUnique({ where: { messageId } });
  if (!email) {
    return reply.code(404).send({ error: 'Email not found' });
  }
  try {
    const polished = await polishDraft(casualDraft, { sender: email.sender, subject: email.subject });
    return reply.send({ polished });
  } catch (err) {
    logger.error({ err }, 'Failed to polish draft');
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'Polish failed' });
  }
});

// Send a polished reply via Gmail and create a draft record
fastify.post('/reply/send', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const { messageId, polishedText } = request.body as { messageId: string; polishedText: string };
  if (!messageId || !polishedText?.trim()) {
    return reply.code(400).send({ error: 'messageId and polishedText are required' });
  }
  const email = await prisma.processedEmail.findUnique({ where: { messageId } });
  if (!email) {
    return reply.code(404).send({ error: 'Email not found' });
  }
  try {
    const gmail = getGmailClient();

    // Fetch the original message's RFC 2822 Message-ID header so clients
    // thread by In-Reply-To / References, not just Gmail's threadId.
    let rfcMessageId = '';
    try {
      const original = await gmail.users.messages.get({
        userId: 'me',
        id: email.messageId,
        format: 'metadata',
        metadataHeaders: ['Message-ID'],
      });
      rfcMessageId =
        original.data.payload?.headers?.find(
          (h) => h.name?.toLowerCase() === 'message-id'
        )?.value ?? '';
    } catch {
      // Non-fatal — fall back to threadId-only threading
    }

    const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    const headers: string[] = [
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      `To: ${email.sender}`,
      `Subject: ${subject}`,
    ];
    if (rfcMessageId) {
      headers.push(`In-Reply-To: ${rfcMessageId}`);
      headers.push(`References: ${rfcMessageId}`);
    }
    headers.push('', polishedText);

    const raw = headers.join('\r\n');
    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded, threadId: email.threadId },
    });
    await prisma.processedEmail.update({
      where: { messageId },
      data: { repliedAt: new Date(), escalationStatus: 'REPLIED' },
    });
    return reply.send({ sent: true });
  } catch (err) {
    logger.error({ err }, 'Failed to send reply');
    return reply.code(500).send({ error: 'Send failed' });
  }
});

let pollingInterval: NodeJS.Timeout | null = null;
let pollingUserId: string | null = null;

function startPolling(userId: string | null) {
  if (pollingInterval) return;
  pollingUserId = userId;
  pollingInterval = setInterval(async () => {
    try {
      await runProcessingCycle(pollingUserId);
    } catch (error) {
      logger.error({ error }, 'Polling cycle failed');
    }
  }, config.polling.intervalMs);
  logger.info({ intervalMs: config.polling.intervalMs }, 'Email polling started');
}

fastify.post('/polling/start', async () => {
  if (pollingInterval) return { message: 'Polling already running' };
  startPolling(pollingUserId);
  return { message: 'Polling started', intervalMs: config.polling.intervalMs };
});

fastify.post('/polling/stop', async () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info('Email polling stopped');
    return { message: 'Polling stopped' };
  }
  return { message: 'Polling not running' };
});

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, shutting down`);
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    await prisma.$disconnect();
    await fastify.close();
    process.exit(0);
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info({ port: config.server.port }, 'Server started successfully');

    // Load most recent user credentials and auto-start polling
    const user = await prisma.user.findFirst({
      where: { accessToken: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    setOnTokenRefresh(async (userId, tokens) => {
      await prisma.user.update({
        where: { id: userId },
        data: {
          accessToken: tokens.access_token ?? undefined,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        },
      });
      logger.info({ userId }, 'Refreshed tokens saved to DB');
    });

    if (user?.accessToken) {
      setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken ?? undefined,
        expiry_date: user.tokenExpiry?.getTime(),
      }, user.id);
      startPolling(user.id);
      logger.info({ email: user.email }, 'Auto-polling started with stored credentials');
    } else {
      logger.info('No stored credentials — polling will start after first sign-in');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

start();
