import { documentRef, NOT_FOUND_ANSWER, type SentenceCheck, type Source, type SourceDocument } from "./prompts";

export interface Sentence {
  /** Texte de la phrase, sans ses références [Dn]. */
  text: string;
  /** Références écrites par le modèle dans la phrase. */
  refs: string[];
}

export interface Verification {
  answer: string;
  sources: Source[];
  removed: { text: string; reason: string }[];
  corrected: { from: string; to: string }[];
  /** « vérifiée » : avis de agent.verify + contrôle des chiffres ; « non vérifiée » : contrôle des chiffres seul. */
  status: "vérifiée" | "non vérifiée";
}

const REFERENCE = /\s*\[(D\d+)\]/g;

/**
 * Découpe une réponse en phrases. Une référence placée après le point (« … RTT. [D1] ») reste avec sa phrase ;
 * on ne coupe que devant une majuscule, un chiffre ou un guillemet (pas dans « 2,08 » ni après « etc. »).
 */
export function splitSentences(answer: string): Sentence[] {
  return answer
    .split(/(?<=[.!?…](?:\s*\[D\d+\])*)\s+(?=[A-ZÀ-ÖØ-Þ0-9«"])/u)
    .map((part) => ({ text: part.replace(REFERENCE, "").trim(), refs: [...part.matchAll(/\[(D\d+)\]/g)].map((m) => m[1]!) }))
    .filter((sentence) => sentence.text.length > 0);
}

/** Nombres d'un texte, la virgule décimale ramenée au point : « 2,08 » → « 2.08 », « 32 000 » → « 32 », « 000 ». */
export function numbersOf(text: string): string[] {
  return (text.replace(/\[D\d+\]/g, "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

/** Contrôle déterministe, indépendant du modèle : tout nombre de la phrase figure dans le document qu'elle cite. */
export function hasOnlyDocumentNumbers(text: string, document: SourceDocument): boolean {
  const available = new Set(numbersOf(`${document.title} ${document.content}`));
  return numbersOf(text).every((n) => available.has(n));
}

/** Ajoute la référence avant le point final : « … RTT [D1]. ». */
function withReference(text: string, ref: string): string {
  const last = text.at(-1) ?? "";
  return /[.!?…]/.test(last) ? `${text.slice(0, -1).trimEnd()} [${ref}]${last}` : `${text} [${ref}]`;
}

/**
 * Étape 3 de la chaîne : chaque phrase n'est gardée que si agent.verify la dit appuyée par un document fourni ET
 * que tous ses nombres figurent dans ce document. Sinon, sa correction est gardée si elle passe le même contrôle,
 * ou la phrase est retirée. C'est le code, pas le modèle, qui écrit les références [Dn] de la réponse finale.
 */
export function applyVerification(
  sentences: Sentence[],
  checks: SentenceCheck[] | undefined,
  documents: SourceDocument[],
): Verification {
  const byRef = new Map(documents.map((doc, i) => [documentRef(i), doc]));
  const kept: { text: string; ref: string }[] = [];
  const removed: Verification["removed"] = [];
  const corrected: Verification["corrected"] = [];

  sentences.forEach((sentence, i) => {
    if (!checks) {
      // Avis du vérificateur illisible : on garde la référence du modèle, sous réserve du contrôle des nombres.
      const ref = sentence.refs.find((r) => byRef.has(r));
      if (ref && hasOnlyDocumentNumbers(sentence.text, byRef.get(ref)!)) kept.push({ text: sentence.text, ref });
      else removed.push({ text: sentence.text, reason: ref ? "chiffre absent du document" : "sans référence" });
      return;
    }
    const check = checks.find((c) => c.id === `S${i + 1}`);
    const ref = check?.source && byRef.has(check.source) ? check.source : undefined;
    const doc = ref ? byRef.get(ref) : undefined;
    if (check?.supported && ref && doc && hasOnlyDocumentNumbers(sentence.text, doc)) {
      kept.push({ text: sentence.text, ref });
      return;
    }
    const correction = check?.correction?.replace(REFERENCE, "").trim();
    if (correction && ref && doc && hasOnlyDocumentNumbers(correction, doc)) {
      kept.push({ text: correction, ref });
      corrected.push({ from: sentence.text, to: correction });
      return;
    }
    const reason = !check
      ? "non évaluée"
      : !doc
        ? "aucun document ne l'appuie"
        : correction
          ? "correction refusée : chiffre absent du document"
          : check.supported
            ? "chiffre absent du document"
            : "non appuyée";
    removed.push({ text: sentence.text, reason });
  });

  const used = new Set(kept.map((k) => k.ref));
  return {
    answer: kept.length > 0 ? kept.map((k) => withReference(k.text, k.ref)).join(" ") : NOT_FOUND_ANSWER,
    sources: documents.map((doc, i) => ({ ref: documentRef(i), id: doc.id, title: doc.title })).filter((s) => used.has(s.ref)),
    removed,
    corrected,
    status: checks ? "vérifiée" : "non vérifiée",
  };
}
