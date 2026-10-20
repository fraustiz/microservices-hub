import { z } from "zod";
import { ApiError, LLM_TIMEOUT_MS, log } from "@hub/shared";
import type { ChatMessage, PromptDefinition } from "./prompts";

export interface ChatResult {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

const completion = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        message: z.object({
          // Chaîne pour les modèles de chat ; tableau de blocs pour certains modèles récents.
          content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

const unavailable = () => new ApiError("UPSTREAM_ERROR", "Service d'IA indisponible");

/**
 * Appel à l'API Mistral (F6) : seul échange qui sort de la plateforme. Délai maximal 30 s, aucune relance.
 * Ne reçoit que les messages construits par lib/prompts.ts : jamais de jeton ni d'identifiant d'utilisateur.
 */
export async function chat(prompt: PromptDefinition, messages: ChatMessage[], requestId: string): Promise<ChatResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    log("error", "MISTRAL_API_KEY n'est pas défini", { requestId });
    throw unavailable();
  }
  const baseUrl = process.env.MISTRAL_BASE_URL || "https://api.mistral.ai";
  const model = process.env.MISTRAL_MODEL || "mistral-small-latest";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        ...(prompt.json && { response_format: { type: "json_object" } }),
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    log("error", "Mistral injoignable", { requestId, prompt: prompt.id, error: String(err) });
    throw unavailable();
  }

  if (!res.ok) {
    // 401 : clé invalide ; 429 : quota Mistral atteint ; 5xx : panne. Le détail reste dans les journaux.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    log("error", "Mistral a répondu en erreur", { requestId, prompt: prompt.id, status: res.status, detail });
    throw unavailable();
  }

  const parsed = completion.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) {
    log("error", "réponse Mistral inattendue", { requestId, prompt: prompt.id });
    throw unavailable();
  }
  const { content } = parsed.data.choices[0]!.message;
  return {
    content: typeof content === "string" ? content : content.map((block) => block.text ?? "").join(""),
    model: parsed.data.model,
    promptTokens: parsed.data.usage?.prompt_tokens,
    completionTokens: parsed.data.usage?.completion_tokens,
  };
}
