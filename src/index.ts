import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { google } from 'googleapis';
import { config } from './config/env';
import logger from './utils/logger';
import { getAuthUrl, setCredentials, getOAuth2Client } from './gmail/gmail.client';
import { fetchUnreadEmails, markAsProcessed } from './gmail/gmail.poller';
import { classifyEmail } from './ai/classify';
import { generateDraftReply } from './ai/draftReply';
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
    });
  }
  return session.userId;
}

// Process emails manually
fastify.post('/process', async (request, reply) => {
  const userId = await loadSession(request.headers.authorization);
  try {
    logger.info('Manual email processing started');
    const emails = await fetchUnreadEmails();

    if (emails.length === 0) {
      return reply.send({ message: 'No unread emails', processed: 0 });
    }

    let processedCount = 0;

    for (const email of emails) {
      try {
        // Classify email
        let classification = await classifyEmail(email);

        // Force important flag for replies/forwards - these are responses we should know about
        if (email.subject.startsWith('Re:') || email.subject.startsWith('Fwd:')) {
          logger.info({ subject: email.subject }, 'Detected reply/forward - marking as important');
          classification.important = true;
          classification.priority = Math.max(classification.priority, 7);
          classification.reason = 'Automatic: This is a reply or forwarded message';
        }

        // Store in database
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

        // Send Slack alert for ALL emails
        try {
          await sendSlackAlert({
            from: email.sender,
            subject: email.subject,
            priority: classification.priority,
            reason: classification.reason,
            summary: classification.summary,
            threadId: email.threadId,
          });
          logger.info({ subject: email.subject, sender: email.sender }, 'Slack alert sent for email');
        } catch (slackError) {
          logger.error({ 
            slackError: slackError instanceof Error ? slackError.message : String(slackError),
            subject: email.subject,
            sender: email.sender
          }, 'Failed to send Slack alert, but continuing with email processing');
        }

        // Generate draft reply if needed
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

        // Mark as processed
        await markAsProcessed(email.messageId);
        processedCount++;
      } catch (error) {
        logger.error(
          { error, messageId: email.messageId },
          'Failed to process email'
        );
      }
    }

    logger.info({ count: processedCount }, 'Email processing completed');
    return reply.send({
      message: 'Emails processed',
      processed: processedCount,
      total: emails.length,
    });
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

// Polling interval
let pollingInterval: NodeJS.Timeout | null = null;

fastify.post('/polling/start', async () => {
  if (pollingInterval) {
    return { message: 'Polling already running' };
  }

  pollingInterval = setInterval(async () => {
    try {
      logger.debug('Running scheduled email check');
      const emails = await fetchUnreadEmails();

      for (const email of emails) {
        try {
          const classification = await classifyEmail(email);

          // Force important flag for replies/forwards
          let finalClassification = classification;
          if (email.subject.startsWith('Re:') || email.subject.startsWith('Fwd:')) {
            logger.info({ subject: email.subject }, 'Detected reply/forward during polling - marking as important');
            finalClassification = {
              ...classification,
              important: true,
              priority: Math.max(classification.priority, 7),
              reason: 'Automatic: This is a reply or forwarded message',
            };
          }

          await prisma.processedEmail.create({
            data: {
              messageId: email.messageId,
              threadId: email.threadId,
              sender: email.sender,
              subject: email.subject,
              body: email.body,
              category: finalClassification.category,
              summary: finalClassification.summary,
              important: finalClassification.important,
              priority: finalClassification.priority,
              confidence: finalClassification.confidence,
            },
          });

          // Send Slack alert for ALL emails
          try {
            await sendSlackAlert({
              from: email.sender,
              subject: email.subject,
              priority: finalClassification.priority,
              reason: finalClassification.reason,
              summary: finalClassification.summary,
              threadId: email.threadId,
            });
            logger.info({ subject: email.subject, sender: email.sender }, 'Slack alert sent for email during polling');
          } catch (slackError) {
            logger.error({ 
              slackError: slackError instanceof Error ? slackError.message : String(slackError),
              subject: email.subject,
              sender: email.sender
            }, 'Failed to send Slack alert during polling, but continuing');
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
        } catch (error) {
          logger.error(
            { error, messageId: email.messageId },
            'Failed to process email in polling'
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Polling cycle failed');
    }
  }, config.polling.intervalMs);

  logger.info(
    { intervalMs: config.polling.intervalMs },
    'Email polling started'
  );
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
    logger.info(
      { port: config.server.port },
      'Server started successfully'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

start();
