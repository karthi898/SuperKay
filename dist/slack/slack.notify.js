"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSlackAlert = sendSlackAlert;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const logger_1 = __importDefault(require("../utils/logger"));
async function sendSlackAlert({ from, subject, priority, reason, summary, threadId, }) {
    try {
        logger_1.default.debug({ subject }, 'Sending Slack notification');
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
        const response = await axios_1.default.post(env_1.config.slack.webhookUrl, payload);
        if (response.status !== 200) {
            throw new Error(`Slack API returned status ${response.status}`);
        }
        logger_1.default.info({ subject, status: response.status }, 'Slack notification sent successfully');
    }
    catch (error) {
        logger_1.default.error({
            error: error instanceof Error ? error.message : String(error),
            subject,
            webhookUrl: env_1.config.slack.webhookUrl
        }, 'Failed to send Slack notification');
        throw error;
    }
}
//# sourceMappingURL=slack.notify.js.map