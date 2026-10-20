import { ApiError, getCookie, route } from "@hub/shared";
import { consumeRefreshToken, REFRESH_TOKEN_COOKIE, sessionResponse } from "@/lib/session";
import { findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Échange le refresh token (usage unique) contre un nouveau jeton d'accès et un nouveau refresh token. */
export const POST = route(async (req) => {
  const refreshToken = getCookie(req, REFRESH_TOKEN_COOKIE);
  if (!refreshToken) throw new ApiError("UNAUTHORIZED", "Session expirée");
  const user = await findUserById(await consumeRefreshToken(refreshToken));
  if (!user) throw new ApiError("UNAUTHORIZED", "Compte introuvable");
  return sessionResponse(user);
});
