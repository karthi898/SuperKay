"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKnownSender = isKnownSender;
exports.clearSenderCache = clearSenderCache;
const prisma_1 = __importDefault(require("../database/prisma"));
const logger_1 = __importDefault(require("../utils/logger"));
const senderCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const cache = new Map();
async function isKnownSender(sender) {
    const cached = cache.get(sender);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.isKnown;
    }
    try {
        const processed = await prisma_1.default.processedEmail.findFirst({
            where: { sender },
        });
        const isKnown = !!processed;
        cache.set(sender, { isKnown, timestamp: Date.now() });
        return isKnown;
    }
    catch (error) {
        logger_1.default.error({ error, sender }, 'Failed to check if sender is known');
        return false;
    }
}
function clearSenderCache() {
    cache.clear();
    logger_1.default.debug('Sender cache cleared');
}
//# sourceMappingURL=sender.memory.js.map