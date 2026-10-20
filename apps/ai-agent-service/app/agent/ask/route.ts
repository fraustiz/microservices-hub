import { z } from "zod";
import { parseBody, requireAuth, route } from "@hub/shared";
import { ask } from "@/lib/agent";

export const dynamic = "force-dynamic";

const body = z.object({ question: z.string().trim().min(1).max(1000) });

export const POST = route(async (req, { requestId }) => {
  const user = await requireAuth(req);
  const { question } = await parseBody(req, body);
  return Response.json(await ask(user, question, requestId));
});
