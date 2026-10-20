import { route } from "@hub/shared";
import { getKeys } from "@/lib/keys";

export const dynamic = "force-dynamic";

/** Clés publiques (F4) : permettent de vérifier un jeton, jamais d'en signer. Route interne. */
export const GET = route(async () => {
  return Response.json((await getKeys()).jwks, { headers: { "Cache-Control": "public, max-age=300" } });
});
