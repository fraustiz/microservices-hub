import type { AuthUser } from "@hub/shared";
import { getDocument, searchDocuments } from "./business";
import { saveExchange } from "./history";
import { chat } from "./nim";
import {
  ASK_PROMPT,
  buildAskMessages,
  buildSummarizeMessages,
  NOT_FOUND_ANSWER,
  parseAskOutput,
  parseSummarizeOutput,
  SUMMARIZE_PROMPT,
  type Source,
} from "./prompts";

/** Question → documents autorisés (F5) → LLM via NVIDIA NIM (F6) → réponse et sources vérifiées. */
export async function ask(user: AuthUser, question: string, requestId: string) {
  const started = Date.now();
  const documents = await searchDocuments(user, question, requestId);

  // Aucun document autorisé ne correspond : réponse fixe, sans appel au LLM (rien à lui envoyer, rien à inventer).
  if (documents.length === 0) {
    const result = { answer: NOT_FOUND_ANSWER, sources: [] as Source[] };
    await saveExchange(
      { userId: user.id, kind: "ask", input: question, output: result.answer, sources: [], prompt: ASK_PROMPT, latencyMs: Date.now() - started },
      requestId,
    );
    return result;
  }

  const completion = await chat(ASK_PROMPT, buildAskMessages(question, documents), requestId);
  const result = parseAskOutput(completion.content, documents);
  await saveExchange(
    {
      userId: user.id,
      kind: "ask",
      input: question,
      output: result.answer,
      sources: result.sources,
      prompt: ASK_PROMPT,
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      latencyMs: Date.now() - started,
    },
    requestId,
  );
  return result;
}

/** Résumé d'un document que l'utilisateur a le droit de lire. */
export async function summarize(user: AuthUser, documentId: string, requestId: string) {
  const started = Date.now();
  const document = await getDocument(user, documentId, requestId);
  const completion = await chat(SUMMARIZE_PROMPT, buildSummarizeMessages(document), requestId);
  const summary = parseSummarizeOutput(completion.content);
  const source = { ref: "D1", id: document.id, title: document.title };
  await saveExchange(
    {
      userId: user.id,
      kind: "summarize",
      input: document.id,
      output: summary,
      sources: [source],
      prompt: SUMMARIZE_PROMPT,
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      latencyMs: Date.now() - started,
    },
    requestId,
  );
  return { summary, source: { id: document.id, title: document.title } };
}
