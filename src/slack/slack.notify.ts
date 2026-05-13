import axios from 'axios';
import { config } from '../config/env';
import { ClassificationResult } from '../types/message.types';
import logger from '../utils/logger';

export interface SlackAlertParams {
  from: string;
  subject: string;
  priority: number;
  reason: string;
  summary: string;
  threadId: string;
}

export async function sendSlackAlert({
  from,
  subject,
  priority,
  reason,
  summary,
  threadId,
}: SlackAlertParams): Promise<void> {
  try {
    logger.debug({ subject }, 'Sending Slack notification');

    const payload = {
      text: '🚨 IMPORTANT EMAIL',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🚨 *IMPORTANT EMAIL*',
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*From:*\n${from}`,
            },
            {
              type: 'mrkdwn',
              text: `*Priority:*\n${priority}/10`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Subject:*\n${subject}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Reason:*\n${reason}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Summary:*\n${summary}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Thread ID: ${threadId}`,
            },
          ],
        },
      ],
    };

    await axios.post(config.slack.webhookUrl, payload);
    logger.info({ subject }, 'Slack notification sent');
  } catch (error) {
    logger.error({ error, subject }, 'Failed to send Slack notification');
  }
}
