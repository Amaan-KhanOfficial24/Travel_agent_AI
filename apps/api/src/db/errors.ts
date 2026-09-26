// Turns database-driver errors into AppErrors with the right HTTP status.
// Postgres reports every error with a 5-character SQLSTATE code; the driver reports
// connection problems with Node error codes (ECONNREFUSED etc.) or plain messages.
import { AppError } from '../errors.js';

type PgLikeError = { code?: string; constraint?: string; detail?: string; message?: string };

const UNAVAILABLE_NODE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN']);

export function mapDbError(err: unknown): AppError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as PgLikeError;
  const message = e.message ?? '';

  // Could not reach the database at all, or it went away mid-query.
  if (
    (e.code && UNAVAILABLE_NODE_CODES.has(e.code)) ||
    e.code === '57P01' || // admin_shutdown: the server was stopped
    e.code === '57P03' || // cannot_connect_now: starting up / shutting down
    e.code === '08006' || // connection_failure
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('Connection terminated')
  ) {
    return new AppError(503, 'DATABASE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again shortly.');
  }

  switch (e.code) {
    case '57014': // query_canceled: hit statement_timeout
      return new AppError(503, 'DATABASE_TIMEOUT', 'The request took too long. Please try again.');
    case '23505': // unique_violation
      return new AppError(409, 'CONFLICT', conflictMessage(e.constraint));
    case '23503': // foreign_key_violation: the parent row does not exist (any more)
      return new AppError(409, 'CONFLICT', 'A related record no longer exists');
    case '23514': // check_violation: the database caught invalid data the API missed
    case '22P02': // invalid_text_representation
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
      return new AppError(400, 'VALIDATION_FAILED', 'Request contains invalid data', [
        { field: e.constraint ?? 'unknown', message: 'Rejected by database constraint' },
      ]);
    default:
      return undefined; // not a database error we recognise: treat as a bug (500)
  }
}

function conflictMessage(constraint?: string): string {
  if (constraint === 'passengers_unique_person') return 'This passenger is already on the trip';
  return 'This record already exists';
}
