import { generateKeyPairSync } from "node:crypto";
import { decodeProtectedHeader } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAccessToken } from "@hub/shared";

const pem = () =>
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const user = { id: "6f1c2c8e-8a43-4d8e-9a43-0a8d6e2b1c11", email: "chloe@hub.local", role: "employee", dept: "rh" } as const;

// Chaque test recharge les modules : les clés sont lues une seule fois par processus.
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("clés et jeton d'accès", () => {
  it("signe un jeton vérifiable avec le JWKS publié, qui ne contient aucune partie privée", async () => {
    // Clé écrite sur une ligne avec des \n littéraux, comme dans un fichier .env.
    vi.stubEnv("JWT_PRIVATE_KEY", pem().replace(/\n/g, "\\n"));
    const { getKeys } = await import("./keys");
    const { signAccessToken } = await import("./session");

    const token = await signAccessToken(user);
    const keys = await getKeys();
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "RS256", kid: keys.kid });
    expect(await verifyAccessToken(token, keys.verify)).toEqual({ id: user.id, role: "employee", dept: "rh", token });
    expect(keys.jwks.keys).toHaveLength(1);
    expect(keys.jwks.keys[0]).not.toHaveProperty("d");
    expect(keys.jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
  });

  it("garde l'ancienne clé publique dans le JWKS pendant une rotation", async () => {
    const { createPublicKey } = await import("node:crypto");
    const previous = pem();
    vi.stubEnv("JWT_PRIVATE_KEY", previous);
    const oldToken = await (await import("./session")).signAccessToken(user);

    vi.resetModules();
    vi.stubEnv("JWT_PRIVATE_KEY", pem());
    vi.stubEnv("JWT_PREVIOUS_PUBLIC_KEY", createPublicKey(previous).export({ type: "spki", format: "pem" }).toString());
    const keys = await (await import("./keys")).getKeys();
    expect(keys.jwks.keys).toHaveLength(2);
    expect((await verifyAccessToken(oldToken, keys.verify)).id).toBe(user.id);
  });

  it("accepte un PEM entier encodé en base64", async () => {
    vi.stubEnv("JWT_PRIVATE_KEY", Buffer.from(pem()).toString("base64"));
    const keys = await (await import("./keys")).getKeys();
    expect(keys.jwks.keys).toHaveLength(1);
  });

  it.each([
    ["chemin de fichier", "keys/jwt-private.pem"],
    ["PEM tronqué à sa première ligne", "-----BEGIN PRIVATE KEY-----"],
    ["secret partagé", "un-secret-partage"],
  ])("valeur illisible (%s) : message clair, sans la valeur", async (_, value) => {
    vi.stubEnv("JWT_PRIVATE_KEY", value);
    const err = await (await import("./keys")).getKeys().catch((e: Error) => e);
    expect((err as Error).message).toMatch(/^JWT_PRIVATE_KEY illisible : clé PEM attendue.*pnpm env:init/);
    expect((err as Error).message).not.toContain(value);
  });

  it("refuse de démarrer sans clé", async () => {
    vi.stubEnv("JWT_PRIVATE_KEY", "");
    await expect((await import("./keys")).getKeys()).rejects.toThrow(/JWT_PRIVATE_KEY/);
  });
});
