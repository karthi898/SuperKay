"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callOpenAI = callOpenAI;
const openai_1 = require("openai");
const env_1 = require("../config/env");
const logger_1 = __importDefault(require("../utils/logger"));
const client = new openai_1.OpenAI({
    apiKey: env_1.config.openai.apiKey,
});
async function callOpenAI(prompt) {
    try {
        logger_1.default.debug('Calling OpenAI API');
        const response = await client.chat.completions.create({
            model: env_1.config.openai.model,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
        });
        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('No response from OpenAI');
        }
        return content;
    }
    catch (error) {
        logger_1.default.error({ error }, 'OpenAI API call failed');
        throw error;
    }
}
exports.default = client;
//# sourceMappingURL=openai.client.js.map