import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { calculateJwkThumbprint, createLocalJWKSet, exportJWK, type JWK, type JWTVerifyGetKey } from "jose";

interface Keys {
  /** Clé de signature : n'existe que dans auth-service. */
  privateKey: KeyObject;
  kid: string;
  /** Clés publiques publiées dans le JWKS : la clé courante, plus l'ancienne pendant une rotation. */
  jwks: { keys: JWK[] };
  verify: JWTVerifyGetKey;
}

let keys: Promise<Keys> | undefined;

/** Clés chargées une fois depuis l'environnement. Clé absente ou invalide : le service refuse de démarrer. */
export function getKeys(): Promise<Keys> {
  keys ??= load();
  return keys;
}

/** PEM depuis une variable d'environnement : les retours à la ligne peuvent y être écrits `\n`. */
function pem(name: string): string | undefined {
  return process.env[name]?.replace(/\\n/g, "\n").trim() || undefined;
}

async function publicJwk(key: KeyObject): Promise<JWK> {
  const jwk = await exportJWK(key);
  return { ...jwk, kid: await calculateJwkThumbprint(jwk), alg: "RS256", use: "sig" };
}

async function load(): Promise<Keys> {
  const privatePem = pem("JWT_PRIVATE_KEY");
  if (!privatePem) throw new Error("JWT_PRIVATE_KEY n'est pas défini : lancer `pnpm env:init`");
  const privateKey = createPrivateKey(privatePem);
  if (privateKey.asymmetricKeyType !== "rsa") throw new Error("JWT_PRIVATE_KEY doit être une clé RSA");

  const current = await publicJwk(createPublicKey(privateKey));
  const previousPem = pem("JWT_PREVIOUS_PUBLIC_KEY");
  const jwks = { keys: previousPem ? [current, await publicJwk(createPublicKey(previousPem))] : [current] };
  return { privateKey, kid: current.kid!, jwks, verify: createLocalJWKSet(jwks) };
}
