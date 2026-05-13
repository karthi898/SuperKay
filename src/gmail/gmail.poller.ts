import { getGmailClient } from './gmail.client';
import { parseGmailMessage } from './gmail.parser';
import { NormalizedMessage } from '../types/message.types';
import logger from '../utils/logger';
import prisma from '../database/prisma';

export async function fetchUnreadEmails(): Promise<NormalizedMessage[]> {
  try {
    logger.debug('Fetching unread emails');
    const gmail = getGmailClient();

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 10,
    });

    if (!response.data.messages) {
      logger.debug('No unread emails found');
      return [];
    }

    const messages: NormalizedMessage[] = [];

    for (const messageRef of response.data.messages) {
      const messageDetail = await gmail.users.messages.get({
        userId: 'me',
        id: messageRef.id!,
        format: 'full',
      });

      const parsed = parseGmailMessage(messageDetail.data);
      if (parsed) {
        // Check if already processed
        const existing = await prisma.processedEmail.findUnique({
          where: { messageId: parsed.messageId },
        });

        if (!existing) {
          messages.push(parsed);
        }
      }
    }

    logger.info({ count: messages.length }, 'Fetched unread emails');
    return messages;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch unread emails');
    throw error;
  }
}

export async function markAsProcessed(messageId: string): Promise<void> {
  try {
    const gmail = getGmailClient();
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });
    logger.debug({ messageId }, 'Marked email as read');
  } catch (error) {
    logger.error({ error, messageId }, 'Failed to mark email as read');
  }
}
