import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

export function createLogger(serviceName: string, level: string): Logger {
  return pino({
    name: serviceName,
    level,
    redact: {
      paths: [
        '*.password',
        '*.pass',
        '*.apiKey',
        '*.api_key',
        'config.pass',
        'config.password',
        'config.apiKey',
        'headers.authorization',
      ],
      censor: '***',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}
