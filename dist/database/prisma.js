"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const logger_1 = __importDefault(require("../utils/logger"));
const prisma = new client_1.PrismaClient();
prisma.$connect()
    .then(() => {
    logger_1.default.info('Connected to database');
})
    .catch((error) => {
    logger_1.default.error({ error }, 'Failed to connect to database');
    process.exit(1);
});
exports.default = prisma;
//# sourceMappingURL=prisma.js.map