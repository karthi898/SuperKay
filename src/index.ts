import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { google } from 'googleapis';
import { config } from './config/env';
import logger from './utils/logger';
import { getAuthUrl, setCredentials, getOAuth2Client, setOnTokenRefresh } from './gmail/gmail.client';
import { fetchUnreadEmails, markAsProcessed } from './gmail/gmail.poller';
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

    logger.info({ email: userInfo.email }, 'Mobile OAuth complete');
    return reply.redirect(`superkay://auth?token=${sessionToken}`);
  } catch (err) {
    logger.error({ err }, 'Mobile OAuth callback failed');
    return reply.redirect('superkay://auth?error=auth_failed');
  }
});

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

      await markAsProcessed(email.messageId);
      count++;
    } catch (error) {
      logger.error({ error, messageId: email.messageId }, 'Failed to process email');
    }
  }
  logger.info({ count }, 'Processing cycle complete');
  return count;
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
  const { messageId, polishedText } = request.body as { messageId: string; polishedText: string };
  if (!messageId || !polishedText?.trim()) {
    return reply.code(400).send({ error: 'messageId and polishedText are required' });
  }
  const email = await prisma.processedEmail.findUnique({ where: { messageId } });
  if (!email) {
    return reply.code(404).send({ error: 'Email not found' });
  }
  try {
    const gmail = (await import('./gmail/gmail.client')).getGmailClient();
    const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    const raw = [
      `To: ${email.sender}`,
      `Subject: ${subject}`,
      ``,
      polishedText,
    ].join('\n');
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
