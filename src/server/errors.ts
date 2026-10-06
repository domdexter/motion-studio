import { ZodError } from "zod";

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "LOCKED"
  | "FORBIDDEN"
  | "PRECONDITION"
  | "NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "UNSUPPORTED_MEDIA"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL";

export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LOCKED: 423,
  FORBIDDEN: 403,
  PRECONDITION: 412,
  NOT_CONFIGURED: 412,
  PROVIDER_ERROR: 502,
  UNSUPPORTED_MEDIA: 415,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
  /** Short actionable guidance shown in the GUI (e.g. "Add your API key in Settings"). */
  hint?: string;
  /** GUI route that helps resolve the error (e.g. "/settings#elevenlabs"). */
  action?: { label: string; href: string };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly hint?: string;
  readonly action?: ErrorBody["action"];

  constructor(code: ErrorCode, message: string, extra: { details?: unknown; hint?: string; action?: ErrorBody["action"]; cause?: unknown } = {}) {
    super(message, extra.cause ? { cause: extra.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.details = extra.details;
    this.hint = extra.hint;
    this.action = extra.action;
  }

  get status(): number {
    return STATUS_FOR_CODE[this.code];
  }

  toBody(): ErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.action ? { action: this.action } : {}),
    };
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found.`);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "AppError");
}

/** Normalizes anything thrown into an ErrorBody (never leaks stack traces to the client). */
export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (isAppError(err)) return { status: (err as AppError).status, body: (err as AppError).toBody() };
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: {
        code: "VALIDATION",
        message: err.issues[0]?.message ?? "Invalid input.",
        details: err.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { code: "INTERNAL", message: message || "Unexpected error." } };
}
