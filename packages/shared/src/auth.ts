import { createRemoteJWKSet, errors, jwtVerify, type CryptoKey, type JWTVerifyGetKey, type KeyObject } from "jose";
import { z } from "zod";
import { ACCESS_TOKEN_COOKIE, INTERNAL_TIMEOUT_MS, JWT_AUDIENCE, JWT_ISSUER, ROLES, type Role } from "./config";
import { ApiError } from "./errors";
import { log } from "./log";
import { getCookie } from "./request";

/** Utilisateur authentifié. `token` est le JWT reçu, que l'agent IA retransmet tel quel (F5). */
export interface AuthUser {
  id: string;
  role: Role;
  dept: string;
  token: string;
}

export type VerifyKey = CryptoKey | KeyObject | JWTVerifyGetKey;

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(ROLES),
  dept: z.string().min(1),
});

/** Jeton de la requête : `Authorization: Bearer` (appels entre services), sinon cookie `access_token` (navigateur). */
export function extractToken(req: Request): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim() || undefined;
  return getCookie(req, ACCESS_TOKEN_COOKIE);
}

/**
 * Vérifie la signature (RS256 uniquement : bloque `alg: none` et la confusion RS256/HS256),
 * `iss`, `aud`, `exp` (tolérance 30 s) et la forme des claims.
 * Jeton refusé : 401. JWKS injoignable : 502.
 */
export async function verifyAccessToken(token: string, key: VerifyKey): Promise<AuthUser> {
  const options = {
    algorithms: ["RS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    clockTolerance: 30,
    requiredClaims: ["exp", "iat", "jti"],
  };
  try {
    const { payload } =
      typeof key === "function" ? await jwtVerify(token, key, options) : await jwtVerify(token, key, options);
    const claims = claimsSchema.parse(payload);
    return { id: claims.sub, role: claims.role, dept: claims.dept, token };
  } catch (err) {
    if (isKeyServerUnavailable(err)) {
      log("error", "JWKS injoignable", { error: String(err) });
      throw new ApiError("UPSTREAM_ERROR", "Service d'authentification indisponible");
    }
    throw new ApiError("UNAUTHORIZED", "Jeton invalide ou expiré");
  }
}

/** Délai dépassé, réponse non 200 ou connexion refusée en récupérant le JWKS : ce n'est pas la faute du jeton. */
function isKeyServerUnavailable(err: unknown): boolean {
  if (err instanceof errors.JWKSTimeout) return true;
  if (err instanceof errors.JOSEError) return err.code === "ERR_JOSE_GENERIC";
  return err instanceof TypeError;
}

let remoteJwks: JWTVerifyGetKey | undefined;

/** Clé publique d'auth-service (F4) : gardée en cache, redemandée au plus une fois toutes les 30 s si `kid` inconnu. */
function jwks(): JWTVerifyGetKey {
  if (!remoteJwks) {
    const url = process.env.AUTH_JWKS_URL;
    if (!url) throw new Error("AUTH_JWKS_URL n'est pas défini");
    remoteJwks = createRemoteJWKSet(new URL(url), { timeoutDuration: INTERNAL_TIMEOUT_MS, cooldownDuration: 30_000 });
  }
  return remoteJwks;
}

/**
 * Contrôle d'accès de chaque route handler protégé (second contrôle après la gateway, docs/securite.md).
 * `roles` absent : tout utilisateur connecté. `key` : clé locale (auth-service), sinon JWKS d'auth-service.
 */
export async function requireAuth(req: Request, roles?: readonly Role[], key?: VerifyKey): Promise<AuthUser> {
  const token = extractToken(req);
  if (!token) throw new ApiError("UNAUTHORIZED", "Authentification requise");
  const user = await verifyAccessToken(token, key ?? jwks());
  if (roles && !roles.includes(user.role)) throw new ApiError("FORBIDDEN", "Rôle insuffisant");
  return user;
}
