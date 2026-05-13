import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'OPENAI_API_KEY',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REDIRECT_URI',
  'SLACK_WEBHOOK_URL',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID!,
    clientSecret: process.env.GMAIL_CLIENT_SECRET!,
    redirectUri: process.env.GMAIL_REDIRECT_URI!,
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  polling: {
    intervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '30000', 10),
  },
};
