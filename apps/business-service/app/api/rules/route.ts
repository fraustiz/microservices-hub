import { parseBody, requireAuth, route } from "@hub/shared";
import { createRule, listRules, ruleInput } from "@/lib/rules";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireAuth(req, ["admin"]);
  return Response.json({ rules: await listRules() });
});

export const POST = route(async (req) => {
  await requireAuth(req, ["admin"]);
  const rule = await createRule(await parseBody(req, ruleInput));
  return Response.json({ rule }, { status: 201 });
});
