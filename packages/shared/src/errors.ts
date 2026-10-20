/** Codes du format d'erreur commun et leur statut HTTP (docs/interconnexion.md, section 6). */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_ERROR: 502,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

/** Erreur prévue : `route()` la traduit en réponse au format commun. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** `{ "error": { "code", "message", "requestId" } }`, avec le statut HTTP du code. */
export function errorResponse(code: ErrorCode, message: string, requestId: string): Response {
  return Response.json(
    { error: { code, message, requestId } },
    { status: ERROR_STATUS[code], headers: { "X-Request-Id": requestId } },
  );
}
