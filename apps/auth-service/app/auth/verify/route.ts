import { requireAuth, route } from "@hub/shared";
import { getKeys } from "@/lib/keys";

export const dynamic = "force-dynamic";

/**
 * Route interne appelée par la gateway (ForwardAuth, F2). 200 : la gateway transmet la requête avec ces en-têtes.
 * 401 : renvoyé tel quel au client. Non routée par la gateway, donc injoignable depuis l'extérieur.
 */
export const GET = route(async (req) => {
  const user = await requireAuth(req, undefined, (await getKeys()).verify);
  return new Response(null, {
    status: 200,
    headers: { "X-User-Id": user.id, "X-User-Role": user.role, "X-User-Dept": user.dept },
  });
});
