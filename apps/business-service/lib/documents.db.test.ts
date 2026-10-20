import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@hub/shared";

/**
 * Test sur une vraie base PostgreSQL jetable (jamais celle de dev) :
 *   TEST_DATABASE_URL=postgresql://business:business@localhost:55432/business_db pnpm test
 * Ignoré si la variable est absente.
 */
const url = process.env.TEST_DATABASE_URL;

const user = (role: AuthUser["role"], dept: string): AuthUser => ({ id: "u", role, dept, token: "" });
const alice = user("admin", "direction");
const bruno = user("manager", "rh");
const chloe = user("employee", "rh");
const david = user("employee", "tech");

describe.skipIf(!url)("visibilité des documents (base réelle)", () => {
  let mod: typeof import("./documents");
  let rules: typeof import("./rules");
  let db: typeof import("./db");

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url!);
    db = await import("./db");
    await db.db().unsafe("drop schema public cascade; create schema public");
    await db.migrate();
    await db.migrate(); // idempotent
    await db.seed();
    mod = await import("./documents");
    rules = await import("./rules");
  });

  afterAll(async () => {
    await db?.db().end();
  });

  const titles = async (u: AuthUser, q?: string) => (await mod.searchDocuments(u, q, 20)).map((d) => d.title).sort();

  it("applique rôle, département et règles d'accès", async () => {
    expect(await titles(alice)).toHaveLength(10);
    expect(await titles(bruno)).toHaveLength(7);
    expect(await titles(chloe)).toHaveLength(5);
    expect(await titles(david)).toHaveLength(5);
    expect(await titles(bruno)).toContain("Budget 2026 par département"); // règle finance ≥ manager
    expect(await titles(chloe)).not.toContain("Grille salariale 2026"); // min_role manager
    expect(await titles(david)).toContain("Guide d'astreinte");
    expect(await titles(chloe)).not.toContain("Guide d'astreinte"); // autre département
  });

  it("recherche plein texte sans accents, classée par pertinence", async () => {
    const [first] = await mod.searchDocuments(chloe, "Combien de jours de conges ai-je ?", 5);
    expect(first?.title).toBe("Politique de congés payés");
    expect(await titles(chloe, "salariale")).toEqual([]);
    expect(await titles(bruno, "grille salariale")).toContain("Grille salariale 2026");
  });

  it("un document non autorisé est introuvable", async () => {
    const [secret] = await mod.searchDocuments(alice, "réorganisation", 1);
    expect(secret?.title).toBe("Projet de réorganisation");
    expect(await mod.getDocument(bruno, secret!.id)).toBeUndefined();
    expect((await mod.getDocument(alice, secret!.id))?.title).toBe("Projet de réorganisation");
  });

  it("une règle d'accès créée par un admin ouvre un département", async () => {
    expect(await titles(david)).not.toContain("Procédure de recrutement");
    const rule = await rules.createRule({ dept: "rh", minRole: "employee", description: "" });
    expect(await titles(david)).toContain("Procédure de recrutement");
    expect(await titles(david)).not.toContain("Grille salariale 2026"); // min_role du document toujours appliqué
    await expect(rules.createRule({ dept: "rh", minRole: "employee", description: "" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await rules.deleteRule(rule.id);
    expect(await titles(david)).not.toContain("Procédure de recrutement");
  });
});
