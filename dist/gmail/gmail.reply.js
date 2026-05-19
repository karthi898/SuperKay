"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGmailDraft = createGmailDraft;
const gmail_client_1 = require("./gmail.client");
const logger_1 = __importDefault(require("../utils/logger"));
async function createGmailDraft({ threadId, subject, to, replyText, }) {
    try {
        logger_1.default.debug({ threadId }, 'Creating Gmail draft');
        const gmail = (0, gmail_client_1.getGmailClient)();
        const message = [
            `From: me`,
            `To: ${to}`,
            `Subject: Re: ${subject}`,
            `In-Reply-To: ${threadId}`,
            ``,
            replyText,
        ].join('\n');
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        const draft = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: encodedMessage,
                    threadId,
                },
            },
        });
        logger_1.default.info({ threadId, draftId: draft.data.id }, 'Gmail draft created');
        return draft.data.id || null;
    }
    catch (error) {
        logger_1.default.error({ error, threadId }, 'Failed to create Gmail draft');
        return null;
    }
}
//# sourceMappingURL=gmail.reply.js.map