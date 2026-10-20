import { describe, expect, it } from "vitest";
import { toTsQuery } from "./documents";

describe("toTsQuery", () => {
  it("relie les termes par OU, sans doublon ni mot d'une lettre", () => {
    expect(toTsQuery("Combien de jours de congés ai-je ?")).toBe("combien | de | jours | congés | ai | je");
  });

  it("ne laisse passer aucune syntaxe tsquery", () => {
    expect(toTsQuery("budget' & !(salaire:*) | <-> drop")).toBe("budget | salaire | drop");
  });

  it("renvoie undefined sans terme exploitable", () => {
    expect(toTsQuery("? ! a")).toBeUndefined();
  });
});
