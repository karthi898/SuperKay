import { NormalizedMessage } from '../types/message.types';
import { callOpenAI } from './openai.client';
import logger from '../utils/logger';

const DRAFT_REPLY_PROMPT = `You are an email assistant that generates professional, concise reply drafts.

Generate a SHORT, professional reply (2-3 sentences max) to this email.
Do NOT:
- Commit to anything specific
- Make promises
- Provide complex technical solutions
- Send this automatically (it's a DRAFT only)

Return ONLY valid JSON with this structure:
{"draft_reply": "your draft here"}`;

export async function generateDraftReply(
  message: NormalizedMessage
): Promise<string | null> {
  const prompt = `${DRAFT_REPLY_PROMPT}

Email to reply to:
From: ${message.sender}
Subject: ${message.subject}
Body: ${message.body}

Return ONLY valid JSON.`;

  try {
    logger.debug({ messageId: message.messageId }, 'Generating draft reply');
    const response = await callOpenAI(prompt);
    const result = JSON.parse(response) as { draft_reply: string };
    logger.debug(
      { messageId: message.messageId },
      'Draft reply generated'
    );
    return result.draft_reply;
  } catch (error) {
    logger.error(
      { error, messageId: message.messageId },
      'Failed to generate draft reply'
    );
    return null;
  }
}
