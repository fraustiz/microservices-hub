import { z } from "zod";
import { ApiError, LLM_TIMEOUT_MS, log } from "@hub/shared";
import type { ChatMessage, PromptDefinition } from "./prompts";

export interface ChatResult {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

/** Réponse au format OpenAI (`/v1/chat/completions`), que suit l'API NVIDIA NIM. */
const completion = z.object({
  model: z.string(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

const unavailable = () => new ApiError("UPSTREAM_ERROR", "Service d'IA indisponible");

/**
 * Appel à l'API NVIDIA NIM (F6) : seul échange qui sort de la plateforme. Délai maximal 30 s, aucune relance.
 * Ne reçoit que les messages construits par lib/prompts.ts : jamais de jeton ni d'identifiant d'utilisateur.
 */
export async function chat(prompt: PromptDefinition, messages: ChatMessage[], requestId: string): Promise<ChatResult> {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) {
    log("error", "NIM_API_KEY n'est pas défini", { requestId });
    throw unavailable();
  }
  const baseUrl = process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
  const model = process.env.NIM_MODEL || "mistralai/mistral-nemotron";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    log("error", "NIM injoignable", { requestId, prompt: prompt.id, error: String(err) });
    throw unavailable();
  }

  if (!res.ok) {
    // 401 : clé invalide ; 404 : modèle absent du catalogue ; 410 : modèle en fin de vie ; 429 : limite de la clé
    // atteinte ; 5xx : panne. Le détail reste dans les journaux.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    log("error", "NIM a répondu en erreur", { requestId, prompt: prompt.id, model, status: res.status, detail });
    throw unavailable();
  }

  const parsed = completion.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) {
    log("error", "réponse NIM inattendue", { requestId, prompt: prompt.id, model });
    throw unavailable();
  }
  return {
    // Les modèles de raisonnement du catalogue NIM peuvent préfixer leur réponse par <think>…</think>.
    content: (parsed.data.choices[0]!.message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    model: parsed.data.model,
    promptTokens: parsed.data.usage?.prompt_tokens,
    completionTokens: parsed.data.usage?.completion_tokens,
  };
}
