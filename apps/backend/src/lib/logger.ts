import winston from 'winston';
import { getServerConfig } from '../config/env';

const isProduction = getServerConfig().NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: isProduction ? 'http' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      // Production logs are ingested as structured JSON. Local output remains colorized and
      // compact for a developer tailing the process.
      format: isProduction
        ? winston.format.json()
        : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

// Morgan formats request lines from attacker-controlled fields (URL, Referer, User-Agent)
// without escaping them, and the console transport writes raw text -- strip ANSI escape
// sequences and other control bytes so a crafted header can't forge or hide log lines on
// an operator's terminal (CWE-117/150 style log/terminal injection).
const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = new RegExp(
  `[${ESC}${CSI}][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
  'g'
);
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function sanitizeLogLine(message: string): string {
  return message.replace(ANSI_ESCAPE_PATTERN, '').replace(CONTROL_CHAR_PATTERN, '');
}

export const morganStream = {
  write: (message: string) => logger.http(sanitizeLogLine(message.trim())),
};
