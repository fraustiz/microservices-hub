import { describe, expect, it } from "vitest";
import { NOT_FOUND_ANSWER, type SentenceCheck } from "./prompts";
import { applyVerification, hasOnlyDocumentNumbers, numbersOf, splitSentences } from "./verification";

const conges = {
  id: "id-conges",
  title: "Politique de congés payés",
  content: "Chaque salarié acquiert 25 jours ouvrés de congés payés par an (2,08 jours par mois), plus 10 jours de RTT.",
};
const teletravail = { id: "id-tt", title: "Charte de télétravail", content: "Le télétravail est limité à 2 jours par semaine." };
const docs = [conges, teletravail];
const check = (id: string, source: string | null, supported: boolean, correction: string | null = null): SentenceCheck => ({
  id,
  source,
  supported,
  correction,
});

describe("splitSentences", () => {
  it("garde la référence avec sa phrase, avant ou après le point", () => {
    expect(splitSentences("Vous avez 25 jours. [D1] Le télétravail est limité [D2]. Fin.")).toEqual([
      { text: "Vous avez 25 jours.", refs: ["D1"] },
      { text: "Le télétravail est limité.", refs: ["D2"] },
      { text: "Fin.", refs: [] },
    ]);
  });

  it("ne coupe ni dans un décimal ni avant une minuscule", () => {
    expect(splitSentences("Soit 2,08 jours par mois, etc. pour tous. Ensuite.")).toHaveLength(2);
  });
});

describe("contrôle des nombres", () => {
  it("normalise la virgule décimale et les milliers", () => {
    expect(numbersOf("2,08 jours, 32 000 euros [D1]")).toEqual(["2.08", "32", "000"]);
  });

  it("refuse un nombre absent du document (total calculé)", () => {
    expect(hasOnlyDocumentNumbers("25 jours et 10 RTT", conges)).toBe(true);
    expect(hasOnlyDocumentNumbers("Soit 35 jours au total", conges)).toBe(false);
    expect(hasOnlyDocumentNumbers("Soit 24,96 jours", conges)).toBe(false);
  });
});

describe("applyVerification", () => {
  it("garde les phrases appuyées et écrit lui-même les références", () => {
    const sentences = splitSentences("Vous avez 25 jours de congés. Le télétravail est limité à 2 jours.");
    const result = applyVerification(sentences, [check("S1", "D1", true), check("S2", "D2", true)], docs);
    expect(result.answer).toBe("Vous avez 25 jours de congés [D1]. Le télétravail est limité à 2 jours [D2].");
    expect(result.sources.map((s) => s.ref)).toEqual(["D1", "D2"]);
    expect(result.removed).toEqual([]);
    expect(result.status).toBe("vérifiée");
  });

  it("remplace une phrase non appuyée par sa correction (A15 : total de 35 jours)", () => {
    const sentences = splitSentences("Vous avez au total 35 jours, soit 25 jours de congés et 10 jours de RTT.");
    const result = applyVerification(
      sentences,
      [check("S1", "D1", false, "Vous avez 25 jours ouvrés de congés payés et 10 jours de RTT.")],
      docs,
    );
    expect(result.answer).toBe("Vous avez 25 jours ouvrés de congés payés et 10 jours de RTT [D1].");
    expect(result.corrected).toHaveLength(1);
  });

  it("retire une phrase que le vérificateur dit appuyée mais dont un nombre n'est pas dans le document", () => {
    const sentences = splitSentences("Vous avez 25 jours de congés. Soit 35 jours au total.");
    const result = applyVerification(sentences, [check("S1", "D1", true), check("S2", "D1", true)], docs);
    expect(result.answer).toBe("Vous avez 25 jours de congés [D1].");
    expect(result.removed).toEqual([{ text: "Soit 35 jours au total.", reason: "chiffre absent du document" }]);
  });

  it("retire une correction qui invente elle aussi un nombre, et une source inconnue", () => {
    const sentences = splitSentences("Soit 35 jours au total. Le restaurant ouvre à midi.");
    const result = applyVerification(
      sentences,
      [check("S1", "D1", false, "Soit 35 jours."), check("S2", "D9", true)],
      docs,
    );
    expect(result.answer).toBe(NOT_FOUND_ANSWER);
    expect(result.sources).toEqual([]);
    expect(result.removed.map((r) => r.reason)).toEqual([
      "correction refusée : chiffre absent du document",
      "aucun document ne l'appuie",
    ]);
  });

  it("avis du vérificateur illisible : seul le contrôle des nombres, sur la référence du modèle", () => {
    const sentences = splitSentences("Vous avez 25 jours [D1]. Soit 35 jours au total [D1]. Sans référence.");
    const result = applyVerification(sentences, undefined, docs);
    expect(result.answer).toBe("Vous avez 25 jours [D1].");
    expect(result.status).toBe("non vérifiée");
    expect(result.removed.map((r) => r.reason)).toEqual(["chiffre absent du document", "sans référence"]);
  });

  it("phrase non évaluée par le vérificateur : retirée", () => {
    const result = applyVerification(splitSentences("Phrase un. Phrase deux."), [check("S1", "D1", true)], docs);
    expect(result.removed).toEqual([{ text: "Phrase deux.", reason: "non évaluée" }]);
  });
});
