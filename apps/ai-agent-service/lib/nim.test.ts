import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@hub/shared";
import { chat } from "./nim";
import { ASK_PROMPT, SUMMARIZE_PROMPT } from "./prompts";

const messages = [{ role: "user" as const, content: "Bonjour" }];
const completion = (content: string | null) =>
  Response.json({
    model: "mistralai/mistral-nemotron",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 5 },
  });

beforeEach(() => {
  vi.stubEnv("NIM_API_KEY", "nvapi-cle-de-test");
  vi.stubEnv("NIM_BASE_URL", "http://nim.test/v1");
  vi.stubEnv("NIM_MODEL", "mistralai/mistral-nemotron");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chat", () => {
  it("envoie le modèle et les paramètres du prompt au format OpenAI", async () => {
    const fetch = vi.fn().mockResolvedValue(completion('{"answer":"ok","sources":[]}'));
    vi.stubGlobal("fetch", fetch);
    const result = await chat(ASK_PROMPT, messages, "req-1");

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://nim.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer nvapi-cle-de-test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      model: "mistralai/mistral-nemotron",
      messages,
      temperature: 0.1,
      max_tokens: 600,
      stream: false,
    });
    expect(result).toEqual({
      content: '{"answer":"ok","sources":[]}',
      model: "mistralai/mistral-nemotron",
      promptTokens: 12,
      completionTokens: 5,
    });
  });

  it("utilise l'API hébergée de NVIDIA par défaut", async () => {
    vi.stubEnv("NIM_BASE_URL", "");
    vi.stubEnv("NIM_MODEL", "");
    const fetch = vi.fn().mockResolvedValue(completion("- a"));
    vi.stubGlobal("fetch", fetch);
    await chat(SUMMARIZE_PROMPT, messages, "req-1");
    expect(fetch.mock.calls[0]![0]).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(JSON.parse(fetch.mock.calls[0]![1].body).model).toBe("mistralai/mistral-nemotron");
  });

  it("retire le raisonnement <think> des modèles qui en produisent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("<think>\nJe cherche…\n</think>\n- a\n- b")));
    expect((await chat(SUMMARIZE_PROMPT, messages, "req-1")).content).toBe("- a\n- b");
  });

  it.each([
    ["clé absente", () => vi.stubEnv("NIM_API_KEY", "")],
    ["limite de la clé (429)", () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Too Many Requests", { status: 429 })))],
    ["modèle inconnu (404)", () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })))],
    ["modèle en fin de vie (410)", () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Gone", { status: 410 })))],
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
