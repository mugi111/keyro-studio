export type AppErrorCode =
  | "core_unavailable"
  | "unsupported_operation"
  | "invalid_url"
  | "not_found"
  | "validation_error"
  | "action_failed";

export type AppError = {
  code: AppErrorCode;
  message: string;
  detail?: string;
};

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(code: AppErrorCode, message: string, detail?: string): Result<never> {
  return {
    ok: false,
    error: detail === undefined ? { code, message } : { code, message, detail }
  };
}
