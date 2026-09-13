import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { appConfig } from '../../config/configuration.js';
import { type AppConfig } from '../../config/config.types.js';
import { buildErrorEnvelope, httpErrorName, readRequestId } from '../http/api-error.js';

/** Shape Nest produces for `new HttpException({ message, error }, status)`. */
interface HttpExceptionBody {
  message?: string | string[];
  /** Present in Nest's default bodies; intentionally ignored — see normalize(). */
  error?: string;
  details?: string[];
}

interface NormalizedError {
  status: number;
  message: string;
  error: string;
  details?: string[];
  /** The thing worth putting in the logs; never sent to the client. */
  cause: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Lowest status treated as "our fault" rather than the caller's. */
const SERVER_ERROR_THRESHOLD = 500;

/**
 * Health probes answer to monitoring, not to API clients, and Terminus has its
 * own well-defined payload describing which dependency failed. Rewriting a
 * failing probe into the generic error envelope would throw that detail away —
 * exactly when it is most needed.
 */
const PROBE_PATH_PREFIX = '/health';

/**
 * Terminal error handler. Every failure — expected or not — leaves through here,
 * which is what makes the error envelope genuinely uniform.
 *
 * The security rule it enforces: an exception the application did not raise on
 * purpose never reaches the client. Its message and stack are logged server-side
 * and the caller gets a generic 500 plus a request id to quote in a bug report.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Let Terminus's structured probe payload through untouched.
    if (request.originalUrl.startsWith(PROBE_PATH_PREFIX) && exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const normalized = this.normalize(exception);

    const body = buildErrorEnvelope({
      status: normalized.status,
      message: normalized.message,
      details: normalized.details,
      path: request.originalUrl,
      requestId: readRequestId(request),
    });

    this.log(normalized, request);
    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();

      // `throw new BadRequestException('plain string')`
      if (typeof raw === 'string') {
        return {
          status,
          message: raw,
          error: httpErrorName(status),
          cause: exception,
        };
      }

      const payload = (isRecord(raw) ? raw : {}) as HttpExceptionBody;

      // ValidationPipe reports an array of field messages. Surface the first as
      // the headline and keep the full list in `details`.
      const details = Array.isArray(payload.message) ? payload.message : payload.details;
      const message = Array.isArray(payload.message)
        ? (payload.message[0] ?? 'Validation failed')
        : (payload.message ?? exception.message);

      return {
        status,
        message,
        // Always derived from the status, never taken from the exception body.
        // Nest's own default is "Bad Request" (with a space) while a hand-thrown
        // exception might carry anything at all; deriving it keeps `error` a
        // stable identifier clients can branch on.
        error: httpErrorName(status),
        ...(details && details.length > 0 ? { details } : {}),
        cause: exception,
      };
    }

    // Anything below here is a bug, not a modelled failure.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: this.app.isProduction
        ? 'An unexpected error occurred. Quote the request id when reporting this.'
        : exception instanceof Error
          ? exception.message
          : 'Unknown error',
      error: httpErrorName(HttpStatus.INTERNAL_SERVER_ERROR),
      cause: exception,
    };
  }

  private log(normalized: NormalizedError, request: Request): void {
    const context = {
      statusCode: normalized.status,
      method: request.method,
      path: request.originalUrl,
      err: normalized.cause,
    };

    if (normalized.status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(context, normalized.message);
      return;
    }

    // 4xx is the caller's problem, not an incident — keep it out of error alerts.
    this.logger.warn(context, normalized.message);
  }
}
