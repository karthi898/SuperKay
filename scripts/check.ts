/**
 * SuperKay setup status check.
 * Usage:  npm run check
 *
 * Tests:
 *   1. Required env vars present
 *   2. Groq API key works
 *   3. Slack bot token valid + channel reachable
 *   4. Gmail token present + still valid
 *   5. CallMeBot (Telegram/WhatsApp/Signal) reachable
 */

import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { OpenAI } from 'openai';

dotenv.config();

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  const icon = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`${icon} ${name.padEnd(30)} ${detail}`);
}

async function checkEnv() {
  const required = [
    'GROQ_API_KEY',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REDIRECT_URI',
  ];
  let allOk = true;
  for (const key of required) {
    if (!process.env[key]) {
      record(`env:${key}`, false, 'missing');
      allOk = false;
    }
  }
  if (allOk) record('env required', true, 'all set');

  // Soft-warn for Slack + CallMeBot
  if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_WEBHOOK_URL) {
    record('env Slack', false, 'no SLACK_BOT_TOKEN or SLACK_WEBHOOK_URL');
  } else if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_CHANNEL_ID) {
    record(
      'env Slack',
      true,
      `${YELLOW}using webhook only — message ts won't be captured, escalation tracking degraded${RESET}`
    );
  } else {
    record('env Slack', true, 'bot token + channel id set');
  }

  const hasTelegram =
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID;
  const hasCb =
    process.env.CALLMEBOT_TELEGRAM_USER ||
    (process.env.CALLMEBOT_WHATSAPP_PHONE && process.env.CALLMEBOT_WHATSAPP_APIKEY) ||
    (process.env.CALLMEBOT_SIGNAL_PHONE && process.env.CALLMEBOT_SIGNAL_APIKEY);

  if (hasTelegram) {
    record('env Telegram bot', true, 'token + chat id set');
  } else if (hasCb) {
    record(
      'env Telegram bot',
      true,
      `${YELLOW}not set — will fall back to CallMeBot (unreliable)${RESET}`
    );
  } else {
    record('env Telegram bot', false, 'no escalation channel configured');
  }
}

async function checkGroq() {
  if (!process.env.GROQ_API_KEY) return;
  try {
    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    const res = await client.chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'reply with: ok' }],
      max_tokens: 4,
    });
    const content = res.choices[0]?.message?.content?.trim() || '';
    record('Groq API', true, `model responded: "${content.slice(0, 20)}"`);
  } catch (error) {
    const e = error as { message?: string; status?: number };
    record('Groq API', false, e.message || 'request failed');
  }
}

async function checkSlack() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    record('Slack auth', false, 'no SLACK_BOT_TOKEN — skipping');
    return;
  }
  try {
    const res = await axios.post(
      'https://slack.com/api/auth.test',
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.data?.ok) {
      record('Slack auth', false, `auth.test: ${res.data?.error || 'unknown'}`);
      return;
    }
    record('Slack auth', true, `team: ${res.data.team}, user: ${res.data.user}`);

    const channelId = process.env.SLACK_CHANNEL_ID;
    if (channelId) {
      try {
        const info = await axios.get('https://slack.com/api/conversations.info', {
          params: { channel: channelId },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (info.data?.ok) {
          const name = info.data.channel?.name || info.data.channel?.user || channelId;
          record('Slack channel', true, `channel reachable: ${name}`);
        } else if (info.data?.error === 'channel_not_found') {
          record(
            'Slack channel',
            false,
            `channel not found — make sure bot is in the channel (run /invite @YourBot in the channel)`
          );
        } else {
          record('Slack channel', false, `error: ${info.data?.error}`);
        }
      } catch (error) {
        const e = error as { message?: string };
        record('Slack channel', false, e.message || 'request failed');
      }
    }
  } catch (error) {
    const e = error as { message?: string };
    record('Slack auth', false, e.message || 'request failed');
  }
}

async function checkGmail() {
  const tokenPath = path.resolve(
    process.cwd(),
    process.env.GMAIL_TOKEN_PATH || '.gmail-tokens.json'
  );
  if (!fs.existsSync(tokenPath)) {
    record('Gmail token', false, `no token file at ${tokenPath} — run /auth/url`);
    return;
  }
  try {
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const oauth2 = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
    oauth2.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    record('Gmail token', true, `authenticated as ${profile.data.emailAddress}`);
  } catch (error) {
    const e = error as { message?: string };
    record('Gmail token', false, e.message || 'request failed — re-auth via /auth/url');
  }
}

async function checkTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) {
    record('Telegram bot', false, 'no TELEGRAM_BOT_TOKEN — skipping');
    return;
  }
  try {
    const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, {
      timeout: 10_000,
    });
    if (!res.data?.ok) {
      record('Telegram bot', false, `getMe failed: ${res.data?.description || 'unknown'}`);
      return;
    }
    record(
      'Telegram bot',
      true,
      `bot: @${res.data.result.username} (${res.data.result.first_name})`
    );
    if (!chatId) {
      record(
        'Telegram chat',
        false,
        'TELEGRAM_CHAT_ID missing — DM your bot, then check getUpdates'
      );
      return;
    }
    // Confirm we can reach this chat without sending anything user-visible.
    const chatRes = await axios.get(
      `https://api.telegram.org/bot${token}/getChat`,
      { params: { chat_id: chatId }, timeout: 10_000 }
    );
    if (chatRes.data?.ok) {
      const name =
        chatRes.data.result.username ||
        `${chatRes.data.result.first_name || ''} ${chatRes.data.result.last_name || ''}`.trim();
      record('Telegram chat', true, `chat reachable: ${name}`);
    } else {
      record(
        'Telegram chat',
        false,
        `getChat failed: ${chatRes.data?.description || 'unknown'}`
      );
    }
  } catch (error) {
    const e = error as { message?: string };
    record('Telegram bot', false, e.message || 'request failed');
  }
}

async function checkCallMeBot() {
  try {
    await axios.get('https://api.callmebot.com/', { timeout: 8000 });
    record('CallMeBot reach', true, 'api.callmebot.com reachable (fallback)');
  } catch {
    record('CallMeBot reach', false, 'api.callmebot.com unreachable');
  }
}

async function main() {
  console.log(`${BOLD}SuperKay status check${RESET}\n`);
  await checkEnv();
  console.log();
  await checkGroq();
  await checkSlack();
  await checkGmail();
  await checkTelegram();
  await checkCallMeBot();
  console.log();

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log(`${GREEN}${BOLD}All checks passed.${RESET}`);
    process.exit(0);
  }
  console.log(`${RED}${BOLD}${failed.length} check(s) failed.${RESET}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Check script crashed:', err);
  process.exit(2);
});
