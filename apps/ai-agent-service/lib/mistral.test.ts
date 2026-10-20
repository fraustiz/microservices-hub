import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@hub/shared";
import { chat } from "./mistral";
import { ASK_PROMPT, SUMMARIZE_PROMPT } from "./prompts";

const messages = [{ role: "user" as const, content: "Bonjour" }];
const completion = (content: unknown) =>
  Response.json({ model: "mistral-small-2506", choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 12, completion_tokens: 5 } });

beforeEach(() => {
  vi.stubEnv("MISTRAL_API_KEY", "cle-de-test");
  vi.stubEnv("MISTRAL_BASE_URL", "http://mistral.test");
  vi.stubEnv("MISTRAL_MODEL", "mistral-small-latest");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chat", () => {
  it("envoie le modèle, les paramètres du prompt et le mode JSON", async () => {
    const fetch = vi.fn().mockResolvedValue(completion('{"answer":"ok","sources":[]}'));
    vi.stubGlobal("fetch", fetch);
    const result = await chat(ASK_PROMPT, messages, "req-1");

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://mistral.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer cle-de-test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      model: "mistral-small-latest",
      messages,
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });
    expect(result).toEqual({ content: '{"answer":"ok","sources":[]}', model: "mistral-small-2506", promptTokens: 12, completionTokens: 5 });
  });

  it("pas de mode JSON pour un prompt en texte libre, contenu en blocs accepté", async () => {
    const fetch = vi.fn().mockResolvedValue(completion([{ type: "text", text: "- a" }, { type: "text", text: "\n- b" }]));
    vi.stubGlobal("fetch", fetch);
    const result = await chat(SUMMARIZE_PROMPT, messages, "req-1");
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).not.toHaveProperty("response_format");
    expect(result.content).toBe("- a\n- b");
  });

  it.each([
    ["clé absente", () => vi.stubEnv("MISTRAL_API_KEY", "")],
    ["quota Mistral (429)", () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })))],
    ["panne (503)", () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })))],
    ["délai dépassé", () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")))],
    ["réponse inattendue", () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [] })))],
  ])("%s : 502 « Service d'IA indisponible »", async (_, setup) => {
    setup();
    const err = await chat(ASK_PROMPT, messages, "req-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "UPSTREAM_ERROR", message: "Service d'IA indisponible" });
  });
});
