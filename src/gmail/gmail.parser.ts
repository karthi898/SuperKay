import { gmail_v1 } from 'googleapis';
import { NormalizedMessage } from '../types/message.types';
import logger from '../utils/logger';

export function parseGmailMessage(
  message: gmail_v1.Schema$Message
): NormalizedMessage | null {
  try {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string): string => {
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
    } else if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    }

    if (!from || !subject || !body) {
      logger.warn(
        { messageId: message.id },
        'Missing required email fields'
      );
      return null;
    }

    return {
      channel: 'gmail',
      messageId: message.id!,
      threadId: message.threadId!,
      sender: from,
      subject,
      body: body.substring(0, 5000),
      timestamp: date || new Date().toISOString(),
      labelIds: message.labelIds ?? [],
    };
  } catch (error) {
    logger.error({ error, messageId: message.id }, 'Failed to parse Gmail message');
    return null;
  }
}
