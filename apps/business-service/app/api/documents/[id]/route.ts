import { z } from "zod";
import { ApiError, requireAuth, route } from "@hub/shared";
import { getDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  const id = z.uuid().parse(params.id);
  const document = await getDocument(user, id);
  if (!document) throw new ApiError("NOT_FOUND", "Document introuvable");
  return Response.json({ document });
});
