import { log } from "@hub/shared";
import { db } from "./db";
import type { PromptDefinition, Source } from "./prompts";

/** Trace de la chaîne de prompts (alias de type : sérialisable tel quel en jsonb). */
export type ChainTrace = {
  search?: { version: string; keywords: string[] };
  verify?: {
    version: string;
    status: string;
    removed: { text: string; reason: string }[];
    corrected: { from: string; to: string }[];
  };
  calls: { prompt: string; promptTokens: number | null; completionTokens: number | null }[];
};

export interface Exchange {
  userId: string;
  kind: "ask" | "summarize";
  input: string;
  output: string;
  sources: Source[];
  prompt: PromptDefinition;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  chain?: ChainTrace;
}

/** Historique des échanges, avec la version du prompt utilisée (traçabilité, docs/prompt-book.md). */
export async function saveExchange(exchange: Exchange, requestId: string): Promise<void> {
  const sql = db();
  try {
    await sql`
      insert into exchanges (user_id, kind, input, output, sources, prompt_id, prompt_version, model,
                             prompt_tokens, completion_tokens, latency_ms, chain)
      values (${exchange.userId}, ${exchange.kind}, ${exchange.input}, ${exchange.output}, ${sql.json(exchange.sources)},
              ${exchange.prompt.id}, ${exchange.prompt.version}, ${exchange.model ?? null},
              ${exchange.promptTokens ?? null}, ${exchange.completionTokens ?? null}, ${exchange.latencyMs},
              ${exchange.chain ? sql.json(exchange.chain) : null})`;
  } catch (err) {
    // L'historique est secondaire : son échec ne prive pas l'utilisateur de sa réponse.
    log("error", "échec d'enregistrement de l'historique", { requestId, error: String(err) });
  }
}

export async function listExchanges(userId: string, limit: number) {
  return db()`
    select id, kind, input, output, sources, created_at as "createdAt"
    from exchanges where user_id = ${userId}
    order by created_at desc
    limit ${limit}`;
}
