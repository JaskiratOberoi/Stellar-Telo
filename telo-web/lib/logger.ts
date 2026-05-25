import 'server-only';
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Never log credentials, PII, or card data — redact common offenders.
  redact: {
    paths: [
      'password',
      '*.password',
      'TELO_SQL_PASSWORD',
      'req.headers.authorization',
      'req.headers.cookie',
      'card',
      '*.card',
    ],
    censor: '[redacted]',
  },
});
