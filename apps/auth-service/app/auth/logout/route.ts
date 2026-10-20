import { getCookie, route } from "@hub/shared";
import { clearSessionResponse, REFRESH_TOKEN_COOKIE, revokeRefreshToken } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Révoque le refresh token et vide les deux cookies. Fonctionne aussi avec un jeton d'accès expiré. */
export const POST = route(async (req) => {
  const refreshToken = getCookie(req, REFRESH_TOKEN_COOKIE);
  if (refreshToken) await revokeRefreshToken(refreshToken);
  return clearSessionResponse();
});
