"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDraftReply = generateDraftReply;
const openai_client_1 = require("./openai.client");
const logger_1 = __importDefault(require("../utils/logger"));
const DRAFT_REPLY_PROMPT = `You are an email assistant that generates professional, concise reply drafts.

Generate a SHORT, professional reply (2-3 sentences max) to this email.
Do NOT:
- Commit to anything specific
- Make promises
- Provide complex technical solutions
- Send this automatically (it's a DRAFT only)

Return ONLY valid JSON with this structure:
{"draft_reply": "your draft here"}`;
async function generateDraftReply(message) {
    const prompt = `${DRAFT_REPLY_PROMPT}

Email to reply to:
From: ${message.sender}
Subject: ${message.subject}
Body: ${message.body}

Return ONLY valid JSON.`;
    try {
        logger_1.default.debug({ messageId: message.messageId }, 'Generating draft reply');
        const response = await (0, openai_client_1.callOpenAI)(prompt);
        const result = JSON.parse(response);
        logger_1.default.debug({ messageId: message.messageId }, 'Draft reply generated');
        return result.draft_reply;
    }
    catch (error) {
        logger_1.default.error({ error, messageId: message.messageId }, 'Failed to generate draft reply');
        return null;
    }
}
//# sourceMappingURL=draftReply.js.map