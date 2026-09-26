// One structured (JSON) logger for the whole app. JSON logs are what log platforms
// search and filter; pino-pretty turns them into readable lines in development only.
import { pino } from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  // Never let secrets or personal data reach the logs, even by accident.
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password'],
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
});
