import { errorResponse, getRequestId } from "@hub/shared";

export const dynamic = "force-dynamic";

/**
 * Corps des 429 de la gateway (middleware `rate-limit-json`, infra/traefik/dynamic.yml) : le rate limiting de
 * Traefik répond en texte brut, remplacé ici par le format d'erreur commun.
 */
export function GET(req: Request) {
  const res = errorResponse("RATE_LIMITED", "Trop de requêtes : réessayez dans une minute", getRequestId(req));
  res.headers.set("Retry-After", "60");
  return res;
}
