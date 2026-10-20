import { z } from "zod";
import { ApiError, INTERNAL_TIMEOUT_MS, log, type AuthUser } from "@hub/shared";
import type { SourceDocument } from "./prompts";

const document = z.object({ id: z.string(), title: z.string(), content: z.string() });

/**
 * Appel à business-service (F5) avec le JWT de l'utilisateur : l'agent ne lit que ce que l'utilisateur a le droit
 * de lire. Délai maximal 3 s, aucune relance. Les erreurs sont traduites (docs/interconnexion.md, section 6).
 */
async function call(path: string, user: AuthUser, requestId: string): Promise<unknown> {
  const baseUrl = process.env.BUSINESS_SERVICE_URL;
  if (!baseUrl) throw new Error("BUSINESS_SERVICE_URL n'est pas défini");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${user.token}`, "X-Request-Id": requestId, Accept: "application/json" },
      signal: AbortSignal.timeout(INTERNAL_TIMEOUT_MS),
    });
  } catch (err) {
    log("error", "business-service injoignable", { requestId, path, error: String(err) });
    throw new ApiError("UPSTREAM_ERROR", "Service métier indisponible");
  }

  if (res.ok) return res.json();
  if (res.status === 401) throw new ApiError("UNAUTHORIZED", "Jeton invalide ou expiré");
  if (res.status === 403) throw new ApiError("FORBIDDEN", "Rôle insuffisant");
  if (res.status === 404) throw new ApiError("NOT_FOUND", "Document introuvable");
  log("error", "business-service a répondu en erreur", { requestId, path, status: res.status });
  throw new ApiError("UPSTREAM_ERROR", "Service métier indisponible");
}

/** Documents les plus pertinents pour la recherche (mots-clés puis question), parmi ceux que l'utilisateur peut lire. */
export async function searchDocuments(user: AuthUser, query: string, requestId: string): Promise<SourceDocument[]> {
  // business-service limite `q` à 200 caractères : les mots-clés de agent.search passent en premier.
  const params = new URLSearchParams({ q: query.slice(0, 200), limit: "5" });
  const body = z.object({ documents: z.array(document) }).safeParse(await call(`/api/documents?${params}`, user, requestId));
  if (!body.success) throw new ApiError("UPSTREAM_ERROR", "Service métier indisponible");
  return body.data.documents;
}

export async function getDocument(user: AuthUser, id: string, requestId: string): Promise<SourceDocument> {
  const body = z.object({ document }).safeParse(await call(`/api/documents/${encodeURIComponent(id)}`, user, requestId));
  if (!body.success) throw new ApiError("UPSTREAM_ERROR", "Service métier indisponible");
  return body.data.document;
}
