import { ApiError, requireAuth, route } from "@hub/shared";
import { getKeys } from "@/lib/keys";
import { findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { id } = await requireAuth(req, undefined, (await getKeys()).verify);
  const user = await findUserById(id);
  if (!user) throw new ApiError("UNAUTHORIZED", "Compte introuvable");
  return Response.json({ user });
});
