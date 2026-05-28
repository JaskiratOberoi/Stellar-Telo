/**
 * Error taxonomy. Stored procedures return { ok, error_code, message };
 * those codes are mapped to typed, user-safe AppErrors. Never leak raw SQL.
 */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'OUT_OF_SCOPE'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT' // e.g. vailid collision after retries
  | 'RATE_UNRESOLVED'
  | 'RATE_LIMITED'
  | 'DB_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Map an SP status row to an AppError (or null if ok). */
export function spErrorToAppError(row: {
  ok?: boolean | number;
  error_code?: string | null;
  message?: string | null;
}): AppError | null {
  const ok = row.ok === true || row.ok === 1;
  if (ok) return null;
  const code = (row.error_code ?? 'INTERNAL') as AppErrorCode;
  return new AppError(code, row.message ?? 'Operation failed');
}
