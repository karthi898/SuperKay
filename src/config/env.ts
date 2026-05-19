import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'GROQ_API_KEY',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_WEBHOOK_URL) {
  console.warn('[config] Neither SLACK_BOT_TOKEN nor SLACK_WEBHOOK_URL is set — Slack alerts will be skipped.');
}

export const config = {
  openai: {
    apiKey: process.env.GROQ_API_KEY!,
    model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID!,
    clientSecret: process.env.GMAIL_CLIENT_SECRET!,
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    botToken: process.env.SLACK_BOT_TOKEN || '',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  polling: {
    intervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '30000', 10),
  },
};
