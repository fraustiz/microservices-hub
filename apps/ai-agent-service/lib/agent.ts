import { log, type AuthUser } from "@hub/shared";
import { getDocument, searchDocuments } from "./business";
import { saveExchange, type ChainTrace } from "./history";
import { chat, type ChatResult } from "./nim";
import {
  ASK_PROMPT,
  buildAskMessages,
  buildSearchMessages,
  buildSummarizeMessages,
  buildVerifyMessages,
  NOT_FOUND_ANSWER,
  parseAskOutput,
  parseSearchOutput,
  parseSummarizeOutput,
  parseVerifyOutput,
  SEARCH_PROMPT,
  SUMMARIZE_PROMPT,
  VERIFY_PROMPT,
  type ChatMessage,
  type PromptDefinition,
  type Source,
} from "./prompts";
import { applyVerification, splitSentences } from "./verification";

const sum = (values: (number | undefined)[]) =>
  values.every((v) => v === undefined) ? undefined : values.reduce<number>((total, v) => total + (v ?? 0), 0);

/**
 * Chaîne de prompts de `POST /agent/ask` (docs/prompt-book.md, section 4) :
 * 1. agent.search : mots-clés et synonymes → documents autorisés (F5) ;
 * 2. agent.ask : réponse à partir de ces documents ;
 * 3. agent.verify : chaque phrase confrontée aux documents, puis contrôle des nombres par le code.
 * Aucun document : réponse fixe, sans les étapes 2 et 3. Réponse « introuvable » : pas d'étape 3.
 */
export async function ask(user: AuthUser, question: string, requestId: string) {
  const started = Date.now();
  const calls: ChatResult[] = [];
  const chain: ChainTrace = { calls: [] };
  const llm = async (prompt: PromptDefinition, messages: ChatMessage[]) => {
    const result = await chat(prompt, messages, requestId);
    calls.push(result);
    chain.calls.push({ prompt: prompt.id, promptTokens: result.promptTokens ?? null, completionTokens: result.completionTokens ?? null });
    return result;
  };

  const finish = async (answer: string, sources: Source[], removed: number) => {
    await saveExchange(
      {
        userId: user.id,
        kind: "ask",
        input: question,
        output: answer,
        sources,
        prompt: ASK_PROMPT,
        model: calls.at(-1)?.model,
        promptTokens: sum(calls.map((c) => c.promptTokens)),
        completionTokens: sum(calls.map((c) => c.completionTokens)),
        latencyMs: Date.now() - started,
        chain,
      },
      requestId,
    );
    return { answer, sources, removed };
  };

  // 1. Recherche : la question et ses synonymes (« vacances » → « congés »).
  const keywords = parseSearchOutput((await llm(SEARCH_PROMPT, buildSearchMessages(question))).content);
  chain.search = { version: SEARCH_PROMPT.version, keywords };
  const documents = await searchDocuments(user, [...keywords, question].join(" "), requestId);
  // Aucun document autorisé ne correspond : rien à envoyer au modèle, rien qu'il puisse inventer.
  if (documents.length === 0) return finish(NOT_FOUND_ANSWER, [], 0);

  // 2. Réponse.
  const draft = parseAskOutput((await llm(ASK_PROMPT, buildAskMessages(question, documents))).content, documents);
  if (draft.answer === NOT_FOUND_ANSWER) return finish(draft.answer, [], 0);

  // 3. Vérification : seules les phrases appuyées par un document, avec des nombres présents dans ce document.
  const sentences = splitSentences(draft.answer);
  const checks = parseVerifyOutput((await llm(VERIFY_PROMPT, buildVerifyMessages(sentences.map((s) => s.text), documents))).content);
  const verified = applyVerification(sentences, checks, documents);
  chain.verify = { version: VERIFY_PROMPT.version, status: verified.status, removed: verified.removed, corrected: verified.corrected };
  if (verified.removed.length > 0 || verified.corrected.length > 0 || !checks) {
    log("warn", "réponse modifiée par la vérification", {
      requestId,
      status: verified.status,
      removed: verified.removed.length,
      corrected: verified.corrected.length,
    });
  }
  return finish(verified.answer, verified.sources, verified.removed.length);
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
