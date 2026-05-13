import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/env';
import logger from '../utils/logger';

let oauth2Client: OAuth2Client | null = null;

export function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      config.gmail.clientId,
      config.gmail.clientSecret,
      config.gmail.redirectUri
    );
  }
  return oauth2Client;
}

export function setCredentials(tokens: any): void {
  const client = getOAuth2Client();
  client.setCredentials(tokens);
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
