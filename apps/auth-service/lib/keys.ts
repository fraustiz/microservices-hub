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

/** PEM depuis une variable d'environnement : retours à la ligne écrits `\n`, ou PEM entier encodé en base64. */
function pem(name: string): string | undefined {
  const value = process.env[name]?.replace(/\\n/g, "\n").trim();
  if (!value || value.startsWith("-----BEGIN")) return value || undefined;
  const decoded = Buffer.from(value, "base64").toString("utf8").trim();
  return decoded.startsWith("-----BEGIN") ? decoded : value;
}

/**
 * Lit une clé et remplace l'erreur d'OpenSSL (« DECODER routines::unsupported ») par un message qui dit quoi faire.
 * La valeur n'apparaît jamais dans le message : c'est un secret.
 */
function readKey(name: string, value: string, read: (pem: string) => KeyObject, hint = ""): KeyObject {
  try {
    return read(value);
  } catch {
    throw new Error(
      `${name} illisible : clé PEM attendue (« -----BEGIN … KEY----- », retours à la ligne écrits \\n, ou PEM entier en base64)${hint}`,
    );
  }
}

async function publicJwk(key: KeyObject): Promise<JWK> {
  const jwk = await exportJWK(key);
  return { ...jwk, kid: await calculateJwkThumbprint(jwk), alg: "RS256", use: "sig" };
}

async function load(): Promise<Keys> {
  const privatePem = pem("JWT_PRIVATE_KEY");
  if (!privatePem) throw new Error("JWT_PRIVATE_KEY n'est pas défini : lancer `pnpm env:init`");
  const privateKey = readKey(
    "JWT_PRIVATE_KEY",
    privatePem,
    createPrivateKey,
    ". Pour en générer une : vider JWT_PRIVATE_KEY dans apps/auth-service/.env puis lancer `pnpm env:init`",
  );
  if (privateKey.asymmetricKeyType !== "rsa") throw new Error("JWT_PRIVATE_KEY doit être une clé RSA");

  const current = await publicJwk(createPublicKey(privateKey));
  const previousPem = pem("JWT_PREVIOUS_PUBLIC_KEY");
  const previous = previousPem && readKey("JWT_PREVIOUS_PUBLIC_KEY", previousPem, createPublicKey);
  const jwks = { keys: previous ? [current, await publicJwk(previous)] : [current] };
  return { privateKey, kid: current.kid!, jwks, verify: createLocalJWKSet(jwks) };
}
