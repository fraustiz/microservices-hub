import { z } from "zod";
import { parseBody, requireAuth, route } from "@hub/shared";
import { deleteRule, ruleInput, updateRule } from "@/lib/rules";

export const dynamic = "force-dynamic";

export const PUT = route<{ id: string }>(async (req, { params }) => {
  await requireAuth(req, ["admin"]);
  const id = z.uuid().parse(params.id);
  return Response.json({ rule: await updateRule(id, await parseBody(req, ruleInput)) });
});

export const DELETE = route<{ id: string }>(async (req, { params }) => {
  await requireAuth(req, ["admin"]);
  await deleteRule(z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
