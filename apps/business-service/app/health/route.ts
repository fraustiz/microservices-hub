import { healthResponse } from "@hub/shared";

export const dynamic = "force-dynamic";

export function GET() {
  return healthResponse("business-service");
}
