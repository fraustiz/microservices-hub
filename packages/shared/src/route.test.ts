import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "./errors";
import { parseBody } from "./request";
import { route } from "./route";

const ctx = { params: Promise.resolve({}) };

describe("route", () => {
  it("renvoie une ApiError au format commun, avec le X-Request-Id reçu", async () => {
    const handler = route(async () => {
      throw new ApiError("FORBIDDEN", "Rôle insuffisant");
    });
    const res = await handler(new Request("http://test/", { headers: { "x-request-id": "abc-123" } }), ctx);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-request-id")).toBe("abc-123");
    expect(await res.json()).toEqual({ error: { code: "FORBIDDEN", message: "Rôle insuffisant", requestId: "abc-123" } });
  });

  it("traduit une erreur de validation en 400 avec un message en français", async () => {
    const handler = route(async (req) => {
      await parseBody(req, z.object({ question: z.string().min(1) }));
      return new Response(null, { status: 204 });
    });
    const res = await handler(new Request("http://test/", { method: "POST", body: '{"question":""}' }), ctx);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(/^question : /);
    expect(body.error.message).toMatch(/caractère/);
  });

  it("400 si le corps n'est pas du JSON", async () => {
    const handler = route(async (req) => {
      await parseBody(req, z.object({}));
      return new Response(null, { status: 204 });
    });
    const res = await handler(new Request("http://test/", { method: "POST", body: "{" }), ctx);
    expect(res.status).toBe(400);
  });

  it("masque le détail d'une erreur inattendue et génère un X-Request-Id si l'en-tête reçu est invalide", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = route(async () => {
      throw new Error("mot de passe de la base: secret");
    });
    const res = await handler(new Request("http://test/", { headers: { "x-request-id": "<script>" } }), ctx);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.message).toBe("Erreur interne");
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
