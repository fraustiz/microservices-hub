import { z } from "zod";
import { parseQuery, requireAuth, route } from "@hub/shared";
import { listExchanges } from "@/lib/history";

export const dynamic = "force-dynamic";

const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/** Derniers échanges de l'utilisateur connecté, et de lui seul. */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const { limit } = parseQuery(req, query);
  return Response.json({ exchanges: await listExchanges(user.id, limit) });
});
