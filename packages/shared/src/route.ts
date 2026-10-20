import { z } from "zod";
import { ApiError, errorResponse } from "./errors";
import { log } from "./log";
import { formatZodError, getRequestId } from "./request";

export interface RouteContext<P> {
  requestId: string;
  params: P;
}

/**
 * Enveloppe commune des route handlers : `X-Request-Id` sur chaque réponse, format d'erreur commun,
 * et aucune erreur inattendue renvoyée en détail au client (détail dans les journaux uniquement).
 */
export function route<P = Record<string, never>>(handler: (req: Request, ctx: RouteContext<P>) => Promise<Response>) {
  return async (req: Request, { params }: { params: Promise<P> }): Promise<Response> => {
    const requestId = getRequestId(req);
    try {
      const res = await handler(req, { requestId, params: await params });
      res.headers.set("X-Request-Id", requestId);
      return res;
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.code, err.message, requestId);
      if (err instanceof z.ZodError) return errorResponse("BAD_REQUEST", formatZodError(err), requestId);
      log("error", "erreur inattendue", {
        requestId,
        method: req.method,
        path: new URL(req.url).pathname,
        error: err instanceof Error ? err.stack : String(err),
      });
      return errorResponse("INTERNAL", "Erreur interne", requestId);
    }
  };
}
