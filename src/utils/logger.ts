import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const transport = isDev ? require('pino-pretty')({ colorize: true, translateTime: 'SYS:standard' }) : undefined;

const logger = pino({ level: process.env.LOG_LEVEL || 'info' }, transport);

export default logger;
