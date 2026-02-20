import winston from 'winston';
import { getServerConfig } from '../config/env';

export const logger = winston.createLogger({
  level: getServerConfig().NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

export const morganStream = {
  write: (message: string) => logger.http(message.trim()),
};
