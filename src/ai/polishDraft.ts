import { callOpenAI } from './openai.client';
import logger from '../utils/logger';

export async function polishDraft(
  casualDraft: string,
  context: { sender: string; subject: string }
): Promise<string> {
  const prompt = `You are a professional email assistant. Polish this casual draft into a concise, professional reply.
Keep the same intent. Do NOT add new commitments or fabricate details.

Original Email Context:
From: ${context.sender}
Subject: ${context.subject}

Casual Draft: ${casualDraft}

Return ONLY valid JSON: {"polished": "your polished reply here"}`;

  const response = await callOpenAI(prompt);
  const result = JSON.parse(response) as { polished: string };
  logger.debug('Draft polished');
  return result.polished;
}
