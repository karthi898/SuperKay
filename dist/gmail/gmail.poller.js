"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUnreadEmails = fetchUnreadEmails;
exports.markAsProcessed = markAsProcessed;
const gmail_client_1 = require("./gmail.client");
const gmail_parser_1 = require("./gmail.parser");
const logger_1 = __importDefault(require("../utils/logger"));
const prisma_1 = __importDefault(require("../database/prisma"));
async function fetchUnreadEmails() {
    try {
        logger_1.default.debug('Fetching unread emails');
        const gmail = (0, gmail_client_1.getGmailClient)();
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread',
            maxResults: 10,
        });
        if (!response.data.messages) {
            logger_1.default.debug('No unread emails found');
            return [];
        }
        const messages = [];
        for (const messageRef of response.data.messages) {
            const messageDetail = await gmail.users.messages.get({
                userId: 'me',
                id: messageRef.id,
                format: 'full',
            });
            const parsed = (0, gmail_parser_1.parseGmailMessage)(messageDetail.data);
            if (parsed) {
                // Check if already processed
                const existing = await prisma_1.default.processedEmail.findUnique({
                    where: { messageId: parsed.messageId },
                });
                if (!existing) {
                    messages.push(parsed);
                }
            }
        }
        logger_1.default.info({ count: messages.length }, 'Fetched unread emails');
        return messages;
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to fetch unread emails');
        throw error;
    }
}
async function markAsProcessed(messageId) {
    try {
        const gmail = (0, gmail_client_1.getGmailClient)();
        await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: {
                removeLabelIds: ['UNREAD'],
            },
        });
        logger_1.default.debug({ messageId }, 'Marked email as read');
    }
    catch (error) {
        logger_1.default.error({ error, messageId }, 'Failed to mark email as read');
    }
}
//# sourceMappingURL=gmail.poller.js.map