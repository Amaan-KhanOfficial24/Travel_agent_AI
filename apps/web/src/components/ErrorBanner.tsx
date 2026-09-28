// One way to show any error. The request ID lets support find the exact log line.
import { ApiError } from '../api/client';

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Something went wrong.');
  // When the API points at specific fields, those fields show the details; the banner
  // just tells the user where to look instead of repeating the API's wording.
  const message = e.code === 'VALIDATION_FAILED' && e.details.length ? 'Please correct the highlighted fields.' : e.message;
  return (
    <div className="error-banner" role="alert">
      <strong>{message}</strong>
      {e.requestId && <span className="request-id">Reference: {e.requestId}</span>}
    </div>
  );
}

/** Field-level messages from the API's `details`, keyed by field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.details.map((d) => [d.field, d.message]));
}
