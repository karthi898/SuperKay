"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOAuth2Client = getOAuth2Client;
exports.setCredentials = setCredentials;
exports.getAuthUrl = getAuthUrl;
exports.getGmailClient = getGmailClient;
const googleapis_1 = require("googleapis");
const env_1 = require("../config/env");
const logger_1 = __importDefault(require("../utils/logger"));
let oauth2Client = null;
function getOAuth2Client() {
    if (!oauth2Client) {
        oauth2Client = new googleapis_1.google.auth.OAuth2(env_1.config.gmail.clientId, env_1.config.gmail.clientSecret, env_1.config.gmail.redirectUri);
    }
    return oauth2Client;
}
function setCredentials(tokens) {
    const client = getOAuth2Client();
    client.setCredentials(tokens);
    logger_1.default.info('Gmail credentials set');
}
function getAuthUrl() {
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
function getGmailClient() {
    return googleapis_1.google.gmail({ version: 'v1', auth: getOAuth2Client() });
}
//# sourceMappingURL=gmail.client.js.map