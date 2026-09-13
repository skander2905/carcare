import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Params } from 'nestjs-pino';

export interface LoggerOptionsInput {
  level: string;
  /** Human-readable colourised output. Development only — it is slow. */
  pretty: boolean;
  /** Paths excluded from automatic request logging (probes, mainly). */
  quietPaths: string[];
}

/**
 * Structured logging configuration.
 *
 * Three things here are deliberate:
 *
 * 1. **Request correlation.** Every log line carries a `reqId`, taken from an
 *    inbound `x-request-id` when a proxy already assigned one, and echoed back
 *    on the response. The same id appears in the error envelope, so a user can
 *    quote it and we can find the exact request.
 * 2. **Redaction is allow-by-exception.** Credentials, cookies and tokens are
 *    stripped before serialisation rather than trusted not to appear.
 * 3. **Probes are silent.** A readiness check every few seconds would otherwise
 *    drown the log in noise and cost real money in a hosted log store.
 */
export function buildLoggerOptions({
  level,
  pretty,
  quietPaths,
}: LoggerOptionsInput): Params {
  return {
    pinoHttp: {
      level,

      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const header = req.headers['x-request-id'];
        const inbound = Array.isArray(header) ? header[0] : header;
        const id = inbound && inbound.length > 0 ? inbound : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },

      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.refreshToken',
        ],
        censor: '[redacted]',
      },

      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const url = req.url ?? '';
          return quietPaths.some((path) => url.startsWith(path));
        },
      },

      // 4xx is a client mistake (warn); 5xx is ours (error).
      customLogLevel: (
        _req: IncomingMessage,
        res: ServerResponse,
        err?: Error,
      ) => {
        if (err) return 'error';
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },

      customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
        `${req.method ?? 'GET'} ${req.url ?? '/'} ${res.statusCode}`,

      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  };
}
