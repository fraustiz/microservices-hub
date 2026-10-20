import { z } from "zod";
import { ApiError } from "./errors";

// Messages de validation en français, pour tous les services (même instance de zod).
z.config(z.locales.fr());

const REQUEST_ID = /^[\w.-]{1,64}$/;

/** `X-Request-Id` reçu s'il est bien formé, sinon un nouvel UUID. */
export function getRequestId(req: Request): string {
  const id = req.headers.get("x-request-id");
  return id && REQUEST_ID.test(id) ? id : crypto.randomUUID();
}

export function getCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || undefined;
  }
  return undefined;
}

/** Lit et valide le corps JSON. Corps illisible ou invalide : 400 `BAD_REQUEST`. */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("BAD_REQUEST", "Corps JSON invalide");
  }
  return schema.parse(body);
}

/** Valide les paramètres de l'URL (`?q=...&limit=...`). */
export function parseQuery<T>(req: Request, schema: z.ZodType<T>): T {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

export function formatZodError(err: z.ZodError): string {
  return err.issues.map((issue) => `${issue.path.join(".") || "corps"} : ${issue.message}`).join(" ; ");
}
