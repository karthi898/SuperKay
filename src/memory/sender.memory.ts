import prisma from '../database/prisma';
import logger from '../utils/logger';

const senderCache = new Map<string, boolean>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  isKnown: boolean;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

export async function isKnownSender(sender: string): Promise<boolean> {
  const cached = cache.get(sender);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.isKnown;
  }

  try {
    const processed = await prisma.processedEmail.findFirst({
      where: { sender },
    });
    const isKnown = !!processed;
    cache.set(sender, { isKnown, timestamp: Date.now() });
    return isKnown;
  } catch (error) {
    logger.error({ error, sender }, 'Failed to check if sender is known');
    return false;
  }
}

export function clearSenderCache(): void {
  cache.clear();
  logger.debug('Sender cache cleared');
}
