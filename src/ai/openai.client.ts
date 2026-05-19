import { OpenAI } from 'openai';
import { config } from '../config/env';
import logger from '../utils/logger';

const client = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function callOpenAIText(prompt: string): Promise<string> {
  try {
    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from AI');
    return content.trim();
  } catch (error) {
    logger.error({ error }, 'OpenAI text call failed');
    throw error;
  }
}

export async function callOpenAI(prompt: string): Promise<string> {
  try {
    logger.debug('Calling OpenAI API');
    const response = await client.chat.completions.create({
      model: config.openai.model,
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
  } catch (error) {
    logger.error({ error }, 'OpenAI API call failed');
    throw error;
  }
}

export default client;
