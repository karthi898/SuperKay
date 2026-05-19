import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/env';
import logger from '../utils/logger';

let oauth2Client: OAuth2Client | null = null;
let _currentUserId: string | null = null;
let _onTokenRefresh: ((userId: string, tokens: { access_token?: string | null; expiry_date?: number | null }) => Promise<void>) | null = null;

export function setOnTokenRefresh(
  handler: (userId: string, tokens: { access_token?: string | null; expiry_date?: number | null }) => Promise<void>
): void {
  _onTokenRefresh = handler;
}

export function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      config.gmail.clientId,
      config.gmail.clientSecret,
      config.gmail.redirectUri
    );
    oauth2Client.on('tokens', (tokens) => {
      logger.info('Gmail tokens auto-refreshed');
      if (_currentUserId && _onTokenRefresh) {
        _onTokenRefresh(_currentUserId, tokens).catch((e) =>
          logger.error({ e }, 'Failed to persist refreshed tokens')
        );
      }
    });
  }
  return oauth2Client;
}

export function setCredentials(tokens: any, userId?: string): void {
  const client = getOAuth2Client();
  client.setCredentials(tokens);
  if (userId !== undefined) _currentUserId = userId;
  logger.info('Gmail credentials set');
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  });
  return authUrl;
}

export function getGmailClient() {
  return google.gmail({ version: 'v1', auth: getOAuth2Client() });
}
