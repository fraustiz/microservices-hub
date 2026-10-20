import { z } from "zod";
import { parseBody, requireAuth, route } from "@hub/shared";
import { summarize } from "@/lib/agent";

export const dynamic = "force-dynamic";

const body = z.object({ documentId: z.uuid() });

export const POST = route(async (req, { requestId }) => {
  const user = await requireAuth(req);
  const { documentId } = await parseBody(req, body);
  return Response.json(await summarize(user, documentId, requestId));
});
