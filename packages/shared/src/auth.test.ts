import { generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { requireAuth, verifyAccessToken } from "./auth";
import { JWT_AUDIENCE, JWT_ISSUER } from "./config";
import { ApiError } from "./errors";

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair("RS256"));
});

const claims = { role: "employee", dept: "rh" };

function sign(overrides: { iss?: string; aud?: string; exp?: string | number; payload?: object } = {}) {
  return new SignJWT({ ...claims, ...overrides.payload })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("user-1")
    .setIssuer(overrides.iss ?? JWT_ISSUER)
    .setAudience(overrides.aud ?? JWT_AUDIENCE)
    .setIssuedAt()
    .setJti("jti-1")
    .setExpirationTime(overrides.exp ?? "15m")
    .sign(privateKey);
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return (err as ApiError).code;
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("verifyAccessToken", () => {
  it("accepte un jeton RS256 valide", async () => {
    const token = await sign();
    expect(await verifyAccessToken(token, publicKey)).toEqual({ id: "user-1", ...claims, token });
  });

  it("refuse un jeton expiré au-delà de la tolérance de 30 s", async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    expect(await errorCode(verifyAccessToken(await sign({ exp }), publicKey))).toBe("UNAUTHORIZED");
  });

  it("refuse un autre émetteur ou une autre audience", async () => {
    expect(await errorCode(verifyAccessToken(await sign({ iss: "autre" }), publicKey))).toBe("UNAUTHORIZED");
    expect(await errorCode(verifyAccessToken(await sign({ aud: "autre" }), publicKey))).toBe("UNAUTHORIZED");
  });

  it("refuse alg: none", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { ...claims, sub: "user-1", iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: now, exp: now + 900, jti: "x" };
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
    expect(await errorCode(verifyAccessToken(token, publicKey))).toBe("UNAUTHORIZED");
  });

  it("refuse un jeton HS256 (confusion d'algorithme)", async () => {
    const token = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setJti("x")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("secret-partage-devine"));
    expect(await errorCode(verifyAccessToken(token, publicKey))).toBe("UNAUTHORIZED");
  });

  it("refuse un rôle inconnu", async () => {
    expect(await errorCode(verifyAccessToken(await sign({ payload: { role: "root" } }), publicKey))).toBe(
      "UNAUTHORIZED",
    );
  });

  it("refuse un jeton signé par une autre clé", async () => {
    const other = await generateKeyPair("RS256");
    expect(await errorCode(verifyAccessToken(await sign(), other.publicKey))).toBe("UNAUTHORIZED");
  });
});

describe("requireAuth", () => {
  const request = (headers: Record<string, string>) => new Request("http://test/api", { headers });

  it("lit le jeton dans le cookie access_token", async () => {
    const token = await sign();
    const user = await requireAuth(request({ cookie: `theme=dark; access_token=${token}` }), undefined, publicKey);
    expect(user.id).toBe("user-1");
  });

  it("préfère Authorization: Bearer au cookie", async () => {
    const token = await sign();
    const user = await requireAuth(
      request({ authorization: `Bearer ${token}`, cookie: "access_token=invalide" }),
      undefined,
      publicKey,
    );
    expect(user.token).toBe(token);
  });

  it("401 sans jeton, 403 si le rôle est insuffisant", async () => {
    expect(await errorCode(requireAuth(request({}), undefined, publicKey))).toBe("UNAUTHORIZED");
    const token = await sign();
    expect(await errorCode(requireAuth(request({ authorization: `Bearer ${token}` }), ["admin"], publicKey))).toBe(
      "FORBIDDEN",
    );
  });
});
