import { getGmailClient } from './gmail.client';
import logger from '../utils/logger';

interface DraftReplyParams {
  threadId: string;
  subject: string;
  to: string;
  replyText: string;
}

export async function createGmailDraft({
  threadId,
  subject,
  to,
  replyText,
}: DraftReplyParams): Promise<string | null> {
  try {
    logger.debug({ threadId }, 'Creating Gmail draft');
    const gmail = getGmailClient();

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

    logger.info({ threadId, draftId: draft.data.id }, 'Gmail draft created');
    return draft.data.id || null;
  } catch (error) {
    logger.error({ error, threadId }, 'Failed to create Gmail draft');
    return null;
  }
}
