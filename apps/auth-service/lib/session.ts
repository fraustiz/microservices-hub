import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { ACCESS_TOKEN_COOKIE, ApiError, JWT_AUDIENCE, JWT_ISSUER, log } from "@hub/shared";
import { db } from "./db";
import { getKeys } from "./keys";
import type { User } from "./users";

export const ACCESS_TOKEN_TTL = 15 * 60;
export const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60;
export const REFRESH_TOKEN_COOKIE = "refresh_token";

/** JWT RS256 de 15 minutes. Claims : docs/securite.md. */
export async function signAccessToken(user: User): Promise<string> {
  const { privateKey, kid } = await getKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: user.role, dept: user.dept })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .setJti(randomUUID())
    .sign(privateKey);
}

/** Le refresh token est opaque : seule son empreinte SHA-256 est stockée, une fuite de la base ne le révèle pas. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db()`insert into refresh_tokens (user_id, token_hash, expires_at)
             values (${userId}, ${hashToken(token)}, now() + make_interval(secs => ${REFRESH_TOKEN_TTL}))`;
  return token;
}

/**
 * Consomme un refresh token (usage unique) et renvoie l'utilisateur.
 * Un jeton déjà utilisé qui revient signale un vol : toutes les sessions de l'utilisateur sont révoquées.
 */
export async function consumeRefreshToken(token: string): Promise<string> {
  const hash = hashToken(token);
  const [used] = await db()<{ user_id: string }[]>`
    update refresh_tokens set revoked_at = now()
    where token_hash = ${hash} and revoked_at is null and expires_at > now()
    returning user_id`;
  if (used) return used.user_id;

  const [known] = await db()<{ user_id: string; revoked_at: Date | null }[]>`
    select user_id, revoked_at from refresh_tokens where token_hash = ${hash}`;
  if (known?.revoked_at) {
    await db()`update refresh_tokens set revoked_at = now() where user_id = ${known.user_id} and revoked_at is null`;
    log("warn", "refresh token réutilisé : sessions révoquées", { userId: known.user_id });
  }
  throw new ApiError("UNAUTHORIZED", "Session expirée");
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await db()`update refresh_tokens set revoked_at = now() where token_hash = ${hashToken(token)} and revoked_at is null`;
}

/**
 * HttpOnly (illisible par JavaScript), SameSite=Strict (pas envoyé depuis un autre site), Secure derrière HTTPS.
 * Le refresh token est limité à `Path=/auth` : il n'est jamais envoyé à /api ni à /agent.
 */
function cookie(name: string, value: string, maxAge: number, path: string): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

/** Réponse de connexion ou de renouvellement : `{ user }` et les deux cookies de session. */
export async function sessionResponse(user: User): Promise<Response> {
  const headers = new Headers();
  headers.append("Set-Cookie", cookie(ACCESS_TOKEN_COOKIE, await signAccessToken(user), ACCESS_TOKEN_TTL, "/"));
  headers.append(
    "Set-Cookie",
    cookie(REFRESH_TOKEN_COOKIE, await issueRefreshToken(user.id), REFRESH_TOKEN_TTL, "/auth"),
  );
  return Response.json({ user }, { headers });
}

export function clearSessionResponse(): Response {
  const headers = new Headers();
  headers.append("Set-Cookie", cookie(ACCESS_TOKEN_COOKIE, "", 0, "/"));
  headers.append("Set-Cookie", cookie(REFRESH_TOKEN_COOKIE, "", 0, "/auth"));
  return new Response(null, { status: 204, headers });
}
