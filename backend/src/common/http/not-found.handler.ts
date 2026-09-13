import { HttpStatus } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { buildErrorEnvelope, readRequestId } from './api-error.js';

/**
 * Catches requests that matched no route at all.
 *
 * Nest's exception filters only see exceptions raised by its own router and
 * handlers. A URL that matches nothing never reaches Nest — Express's default
 * final handler answers it with an HTML error page, which breaks the promise
 * that every failure returns the same JSON envelope.
 *
 * Registering this after the routes closes that gap. It builds its response
 * through the same {@link buildErrorEnvelope} the filter uses, so the two paths
 * cannot diverge.
 */
export function notFoundHandler(request: Request, response: Response, next: NextFunction): void {
  if (response.headersSent) {
    next();
    return;
  }

  response.status(HttpStatus.NOT_FOUND).json(
    buildErrorEnvelope({
      status: HttpStatus.NOT_FOUND,
      message: `Cannot ${request.method} ${request.originalUrl}`,
      path: request.originalUrl,
      requestId: readRequestId(request),
    }),
  );
}
