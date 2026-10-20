import { z } from "zod";
import { parseQuery, requireAuth, route } from "@hub/shared";
import { searchDocuments } from "@/lib/documents";

export const dynamic = "force-dynamic";

const query = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

/** Appelée par le navigateur (via la gateway) ou par ai-agent-service (F5) : même filtrage dans les deux cas. */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const { q, limit } = parseQuery(req, query);
  return Response.json({ documents: await searchDocuments(user, q, limit) });
});
