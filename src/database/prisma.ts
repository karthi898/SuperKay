import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

prisma.$connect()
  .then(() => {
    logger.info('Connected to database');
  })
  .catch((error) => {
    logger.error({ error }, 'Failed to connect to database');
    process.exit(1);
  });

export default prisma;
