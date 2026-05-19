import { callOpenAIText } from './openai.client';
import logger from '../utils/logger';

export async function polishDraft(
  casualDraft: string,
  context: { sender: string; subject: string }
): Promise<string> {
  const prompt = `You are a professional email assistant. Polish this casual draft into a concise, professional reply.
Keep the same intent and meaning. Do NOT add new commitments or fabricate details.
Return ONLY the polished email text — no subject line, no greeting prefix, no extra commentary.

Original Email Context:
From: ${context.sender}
Subject: ${context.subject}

Casual Draft:
${casualDraft}`;

  const polished = await callOpenAIText(prompt);
  logger.debug('Draft polished');
  return polished;
}
