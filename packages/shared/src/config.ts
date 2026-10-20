/** Constantes communes à tous les services. Aucun secret ici. */
export const SERVICES = ["web", "auth-service", "business-service", "ai-agent-service"] as const;

/** Rôles, du moins privilégié au plus privilégié. */
export const ROLES = ["employee", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Rang d'un rôle (1 = employee) : un rôle de rang supérieur a au moins les droits des rangs inférieurs. */
export function roleRank(role: Role): number {
  return ROLES.indexOf(role) + 1;
}

/** Claims `iss` et `aud` des jetons d'accès (docs/securite.md). */
export const JWT_ISSUER = "microservices-hub-auth";
export const JWT_AUDIENCE = "microservices-hub";

export const ACCESS_TOKEN_COOKIE = "access_token";

/** Délais maximaux des appels sortants (docs/interconnexion.md). */
export const INTERNAL_TIMEOUT_MS = 3_000;
export const LLM_TIMEOUT_MS = 30_000;
