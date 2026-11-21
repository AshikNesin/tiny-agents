import { HTTPException } from "hono/http-exception";

const STATUS_PHRASES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export interface HttpErrorOutput {
  statusCode: number;
  error: string;
  message: string;
  code: string;
  data?: unknown;
}

export class HttpError extends Error {
  readonly statusCode: number;

  readonly code: string;

  readonly isOperational: boolean;

  readonly data?: unknown;

  constructor(statusCode: number, message?: string, data?: unknown, code?: string, cause?: Error) {
    const phrase = STATUS_PHRASES[statusCode] ?? "Unknown Error";
    super(message ?? phrase, { cause });

    this.statusCode = statusCode;
    this.code = code ?? statusCodeToCode(statusCode);
    this.isOperational = statusCode < 500;
    this.data = data;

    Object.setPrototypeOf(this, new.target.prototype);
    // oxlint-disable-next-line unicorn/no-useless-error-capture-stack-trace
    Error.captureStackTrace(this, this.constructor);
  }

  get output(): HttpErrorOutput {
    const base: HttpErrorOutput = {
      statusCode: this.statusCode,
      error: STATUS_PHRASES[this.statusCode] ?? "Unknown Error",
      message: this.message,
      code: this.code,
    };

    if (this.data !== undefined && this.data !== null) {
      base.data = this.data;
    }

    return base;
  }
}

function statusCodeToCode(statusCode: number): string {
  const phrase = STATUS_PHRASES[statusCode];
  if (!phrase) return `HTTP_${statusCode}`;
  return phrase.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
}

export const ErrorCode = {
  VALIDATION_ERROR: { code: "VALIDATION_ERROR", status: 400 },
  SESSION_INVALID: { code: "SESSION_INVALID" as const, status: 401 },
  NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  RATE_LIMIT_EXCEEDED: { code: "RATE_LIMIT_EXCEEDED", status: 429 },
  UPLOAD_RATE_LIMIT_EXCEEDED: { code: "UPLOAD_RATE_LIMIT_EXCEEDED", status: 429 },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", status: 500 },
} satisfies Record<string, { code: string; status: number }>;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]["code"];

function createFactory(statusCode: number) {
  return (message?: string, data?: unknown, code?: string): HttpError =>
    new HttpError(statusCode, message, data, code);
}

export const Boom = {
  badRequest: createFactory(400),

  unauthorized: createFactory(401),

  forbidden: createFactory(403),

  notFound: createFactory(404),

  conflict: createFactory(409),

  entityTooLarge: createFactory(413),

  unsupportedMediaType: createFactory(415),

  unprocessable: createFactory(422),

  tooManyRequests: createFactory(429),

  badGateway: createFactory(502),

  unavailable: createFactory(503),

  isHttpError(err: unknown): err is HttpError {
    return err instanceof HttpError;
  },

  boomify(err: unknown, options?: { statusCode?: number; message?: string }): HttpError {
    if (err instanceof HttpError) return err;

    const statusCode = options?.statusCode ?? 500;
    const message =
      options?.message ?? (err instanceof Error ? err.message : "An unexpected error occurred");
    const cause = err instanceof Error ? err : undefined;

    return new HttpError(statusCode, message, undefined, undefined, cause);
  },
} as const;

function fromSqliteConstraint(error: unknown): HttpError | null {
  const message = error instanceof Error ? error.message : String(error);

  const unique = /UNIQUE constraint failed: \w+\.(\w+)/.exec(message);
  if (unique) return Boom.conflict(`A record with this ${unique[1]} already exists`);

  if (/FOREIGN KEY constraint failed/.test(message)) {
    return Boom.badRequest("Cannot perform this operation due to related records");
  }

  const notNull = /NOT NULL constraint failed: \w+\.(\w+)/.exec(message);
  if (notNull) return Boom.badRequest(`${notNull[1]} is required`);

  if (/CHECK constraint failed/.test(message)) return Boom.badRequest("Invalid data provided");

  return null;
}

export function toHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) return error;
  const constraint = fromSqliteConstraint(error);
  if (constraint) return constraint;
  if (error instanceof HTTPException) {
    return Boom.boomify(error, { statusCode: error.status, message: error.message });
  }
  return null;
}

export type ErrorReporter = (error: unknown, context?: Record<string, unknown>) => void;

let reporter: ErrorReporter = () => undefined;

export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try {
    reporter(error, context);
  } catch {}
}
