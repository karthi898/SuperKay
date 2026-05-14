"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGmailMessage = parseGmailMessage;
const logger_1 = __importDefault(require("../utils/logger"));
function parseGmailMessage(message) {
    try {
        const headers = message.payload?.headers || [];
        const getHeader = (name) => {
            return headers.find((h) => h.name === name)?.value || '';
        };
        const from = getHeader('From');
        const subject = getHeader('Subject');
        const date = getHeader('Date');
        let body = '';
        if (message.payload?.parts) {
            for (const part of message.payload.parts) {
                if (part.mimeType === 'text/plain' && part.body?.data) {
                    body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                    break;
                }
            }
        }
        else if (message.payload?.body?.data) {
            body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
        }
        if (!from || !subject || !body) {
            logger_1.default.warn({ messageId: message.id }, 'Missing required email fields');
            return null;
        }
        return {
            channel: 'gmail',
            messageId: message.id,
            threadId: message.threadId,
            sender: from,
            subject,
            body: body.substring(0, 5000), // Limit body size
            timestamp: date || new Date().toISOString(),
        };
    }
    catch (error) {
        logger_1.default.error({ error, messageId: message.id }, 'Failed to parse Gmail message');
        return null;
    }
}
//# sourceMappingURL=gmail.parser.js.map