import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
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

// Process emails manually
fastify.post('/process', async (request, reply) => {
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
        const classification = await classifyEmail(email);

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
          },
        });

        // Send Slack alert if important
        if (classification.important) {
          await sendSlackAlert({
            from: email.sender,
            subject: email.subject,
            priority: classification.priority,
            reason: classification.reason,
            summary: classification.summary,
            threadId: email.threadId,
          });
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
fastify.get('/emails', async () => {
  const emails = await prisma.processedEmail.findMany({
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
let pollingInterval: NodeJS.Timer | null = null;

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
            },
          });

          if (classification.important) {
            await sendSlackAlert({
              from: email.sender,
              subject: email.subject,
              priority: classification.priority,
              reason: classification.reason,
              summary: classification.summary,
              threadId: email.threadId,
            });
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
