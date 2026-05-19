"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const env_1 = require("./config/env");
const logger_1 = __importDefault(require("./utils/logger"));
const gmail_client_1 = require("./gmail/gmail.client");
const gmail_poller_1 = require("./gmail/gmail.poller");
const classify_1 = require("./ai/classify");
const draftReply_1 = require("./ai/draftReply");
const slack_notify_1 = require("./slack/slack.notify");
const gmail_reply_1 = require("./gmail/gmail.reply");
const prisma_1 = __importDefault(require("./database/prisma"));
const fastify = (0, fastify_1.default)({
    logger: true,
});
fastify.register(cors_1.default);
// Health check
fastify.get('/health', async () => {
    return { status: 'ok' };
});
// OAuth callback
fastify.get('/auth/callback', async (request, reply) => {
    const { code } = request.query;
    if (!code) {
        return reply.code(400).send({ error: 'Missing authorization code' });
    }
    try {
        const oauth2Client = (0, gmail_client_1.getOAuth2Client)();
        const { tokens } = await oauth2Client.getToken(code);
        (0, gmail_client_1.setCredentials)(tokens);
        logger_1.default.info('Gmail authentication successful');
        return reply.send({
            message: 'Successfully authenticated with Gmail',
            tokens,
        });
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to authenticate with Gmail');
        return reply.code(500).send({ error: 'Authentication failed' });
    }
});
// Get auth URL
fastify.get('/auth/url', async () => {
    return { authUrl: (0, gmail_client_1.getAuthUrl)() };
});
// Process emails manually
fastify.post('/process', async (request, reply) => {
    try {
        logger_1.default.info('Manual email processing started');
        const emails = await (0, gmail_poller_1.fetchUnreadEmails)();
        if (emails.length === 0) {
            return reply.send({ message: 'No unread emails', processed: 0 });
        }
        let processedCount = 0;
        for (const email of emails) {
            try {
                // Classify email
                let classification = await (0, classify_1.classifyEmail)(email);
                // Force important flag for replies/forwards - these are responses we should know about
                if (email.subject.startsWith('Re:') || email.subject.startsWith('Fwd:')) {
                    logger_1.default.info({ subject: email.subject }, 'Detected reply/forward - marking as important');
                    classification.important = true;
                    classification.priority = Math.max(classification.priority, 7);
                    classification.reason = 'Automatic: This is a reply or forwarded message';
                }
                // Store in database
                await prisma_1.default.processedEmail.create({
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
                // Send Slack alert for ALL emails
                try {
                    await (0, slack_notify_1.sendSlackAlert)({
                        from: email.sender,
                        subject: email.subject,
                        priority: classification.priority,
                        reason: classification.reason,
                        summary: classification.summary,
                        threadId: email.threadId,
                    });
                    logger_1.default.info({ subject: email.subject, sender: email.sender }, 'Slack alert sent for email');
                }
                catch (slackError) {
                    logger_1.default.error({
                        slackError: slackError instanceof Error ? slackError.message : String(slackError),
                        subject: email.subject,
                        sender: email.sender
                    }, 'Failed to send Slack alert, but continuing with email processing');
                }
                // Generate draft reply if needed
                if (classification.reply_needed) {
                    const draftReply = await (0, draftReply_1.generateDraftReply)(email);
                    if (draftReply) {
                        await (0, gmail_reply_1.createGmailDraft)({
                            threadId: email.threadId,
                            subject: email.subject,
                            to: email.sender,
                            replyText: draftReply,
                        });
                    }
                }
                // Mark as processed
                await (0, gmail_poller_1.markAsProcessed)(email.messageId);
                processedCount++;
            }
            catch (error) {
                logger_1.default.error({ error, messageId: email.messageId }, 'Failed to process email');
            }
        }
        logger_1.default.info({ count: processedCount }, 'Email processing completed');
        return reply.send({
            message: 'Emails processed',
            processed: processedCount,
            total: emails.length,
        });
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to process emails');
        return reply.code(500).send({ error: 'Processing failed' });
    }
});
// Get processed emails
fastify.get('/emails', async () => {
    const emails = await prisma_1.default.processedEmail.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    return { emails, count: emails.length };
});
// Get processed emails by category
fastify.get('/emails/category/:category', async (request) => {
    const { category } = request.params;
    const emails = await prisma_1.default.processedEmail.findMany({
        where: { category },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    return { emails, count: emails.length };
});
// Polling interval
let pollingInterval = null;
fastify.post('/polling/start', async () => {
    if (pollingInterval) {
        return { message: 'Polling already running' };
    }
    pollingInterval = setInterval(async () => {
        try {
            logger_1.default.debug('Running scheduled email check');
            const emails = await (0, gmail_poller_1.fetchUnreadEmails)();
            for (const email of emails) {
                try {
                    const classification = await (0, classify_1.classifyEmail)(email);
                    // Force important flag for replies/forwards
                    let finalClassification = classification;
                    if (email.subject.startsWith('Re:') || email.subject.startsWith('Fwd:')) {
                        logger_1.default.info({ subject: email.subject }, 'Detected reply/forward during polling - marking as important');
                        finalClassification = {
                            ...classification,
                            important: true,
                            priority: Math.max(classification.priority, 7),
                            reason: 'Automatic: This is a reply or forwarded message',
                        };
                    }
                    await prisma_1.default.processedEmail.create({
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
                        await (0, slack_notify_1.sendSlackAlert)({
                            from: email.sender,
                            subject: email.subject,
                            priority: finalClassification.priority,
                            reason: finalClassification.reason,
                            summary: finalClassification.summary,
                            threadId: email.threadId,
                        });
                        logger_1.default.info({ subject: email.subject, sender: email.sender }, 'Slack alert sent for email during polling');
                    }
                    catch (slackError) {
                        logger_1.default.error({
                            slackError: slackError instanceof Error ? slackError.message : String(slackError),
                            subject: email.subject,
                            sender: email.sender
                        }, 'Failed to send Slack alert during polling, but continuing');
                    }
                    if (classification.reply_needed) {
                        const draftReply = await (0, draftReply_1.generateDraftReply)(email);
                        if (draftReply) {
                            await (0, gmail_reply_1.createGmailDraft)({
                                threadId: email.threadId,
                                subject: email.subject,
                                to: email.sender,
                                replyText: draftReply,
                            });
                        }
                    }
                    await (0, gmail_poller_1.markAsProcessed)(email.messageId);
                }
                catch (error) {
                    logger_1.default.error({ error, messageId: email.messageId }, 'Failed to process email in polling');
                }
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Polling cycle failed');
        }
    }, env_1.config.polling.intervalMs);
    logger_1.default.info({ intervalMs: env_1.config.polling.intervalMs }, 'Email polling started');
    return { message: 'Polling started', intervalMs: env_1.config.polling.intervalMs };
});
fastify.post('/polling/stop', async () => {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        logger_1.default.info('Email polling stopped');
        return { message: 'Polling stopped' };
    }
    return { message: 'Polling not running' };
});
// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
    process.on(signal, async () => {
        logger_1.default.info(`Received ${signal}, shutting down`);
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }
        await prisma_1.default.$disconnect();
        await fastify.close();
        process.exit(0);
    });
});
const start = async () => {
    try {
        await fastify.listen({ port: env_1.config.server.port, host: '0.0.0.0' });
        logger_1.default.info({ port: env_1.config.server.port }, 'Server started successfully');
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to start server');
        process.exit(1);
    }
};
start();
//# sourceMappingURL=index.js.map