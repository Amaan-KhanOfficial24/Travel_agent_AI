// The last stop for every error. It decides what the client sees (a safe, consistent
// JSON shape) and what we log (full detail, including the stack for real bugs).
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, notFound } from '../errors.js';

// Any request that reached this point matched no route.
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Malformed JSON is detected by express.json() before our code runs.
  if (err?.type === 'entity.parse.failed') {
    err = new AppError(400, 'MALFORMED_JSON', 'Request body is not valid JSON');
  }

  if (err instanceof AppError) {
    // Expected error: log at warn, send its code and message.
    req.log.warn({ code: err.code, status: err.status }, err.message);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
    });
  }

  // Unexpected error = a bug. Log everything, but never leak internals to the client.
  req.log.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side', requestId: req.id },
  });
};
