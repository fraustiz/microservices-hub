// Prépare l'environnement local, sous Linux, macOS ou Windows : `pnpm env:init`. Peut être relancé sans risque.
// 1. Crée apps/<service>/.env depuis .env.example, ou complète un .env existant avec les variables ajoutées
//    depuis à .env.example (avec leurs commentaires). Une valeur déjà présente n'est jamais modifiée.
// 2. Génère la clé privée RSA qui signe les JWT si JWT_PRIVATE_KEY est vide (auth-service uniquement), et signale
//    une clé présente mais illisible (chemin de fichier, PEM tronqué…), sans la remplacer.
// 3. Signale les variables du .env que .env.example ne connaît plus : à supprimer à la main.
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const VARIABLE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Noms des variables d'un .env. Les lignes de suite d'une valeur sur plusieurs lignes (entre guillemets, ou clé PEM
 * jusqu'à « -----END ») sont sautées : un morceau de clé n'est jamais pris pour une variable, donc jamais affiché.
 */
function variables(text) {
  const names = new Set();
  let quoted = false;
  let pem = false;
  for (const line of text.split(/\r?\n/)) {
    if (quoted || pem) {
      if (line.includes("-----END")) pem = false;
      if (line.trimEnd().endsWith('"')) quoted = false;
      continue;
    }
    const match = line.match(VARIABLE);
    if (!match) continue;
    names.add(match[1]);
    const value = match[2].trim();
    quoted = value.startsWith('"') && (value.length === 1 || !value.endsWith('"'));
    pem = value.includes("-----BEGIN") && !value.includes("-----END");
  }
  return names;
}

for (const service of ["auth-service", "business-service", "ai-agent-service"]) {
  const env = `apps/${service}/.env`;
  const example = readFileSync(`apps/${service}/.env.example`, "utf8");
  if (!existsSync(env)) {
    writeFileSync(env, example);
    console.log(`créé : ${env}`);
    continue;
  }

  const content = readFileSync(env, "utf8");
  const present = variables(content);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = [];
  const added = [];
  let comments = [];
  for (const line of example.split(/\r?\n/)) {
    const name = line.match(VARIABLE)?.[1];
    if (!name) {
      comments = line.startsWith("#") ? [...comments, line] : [];
      continue;
    }
    if (!present.has(name)) {
      lines.push(...comments, line);
      added.push(name);
    }
    comments = [];
  }
  if (added.length) {
    const separator = content === "" || content.endsWith("\n") ? "" : eol;
    writeFileSync(env, content + separator + lines.join(eol) + eol);
    console.log(`complété : ${env} (ajout de ${added.join(", ")})`);
  }

  const known = variables(example);
  // Majuscules seulement : un morceau de clé PEM écrite sans guillemets n'est jamais affiché comme « variable ».
  const obsolete = [...present].filter((name) => !known.has(name) && /^[A-Z][A-Z0-9_]*$/.test(name));
  if (obsolete.length) console.log(`plus utilisées, à supprimer à la main de ${env} : ${obsolete.join(", ")}`);
}

/** Valeur de JWT_PRIVATE_KEY, guillemets retirés ; une valeur entre guillemets peut tenir sur plusieurs lignes. */
function privateKeyValue(text) {
  const match = text.match(/^JWT_PRIVATE_KEY=(.*)$/m);
  if (!match) return undefined;
  let value = match[1].trim();
  if (value.startsWith('"') && (value.length === 1 || !value.endsWith('"'))) {
    for (const line of text.slice(match.index + match[0].length).split(/\r?\n/).slice(1)) {
      value += `\n${line}`;
      if (line.trimEnd().endsWith('"')) break;
    }
  }
  return value.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
}

/** Même lecture que auth-service (apps/auth-service/lib/keys.ts) : PEM avec `\n` littéraux, ou PEM en base64. */
function isReadablePrivateKey(value) {
  let pem = value.replace(/\\n/g, "\n").trim();
  if (!pem.startsWith("-----BEGIN")) pem = Buffer.from(pem, "base64").toString("utf8").trim();
  try {
    return createPrivateKey(pem).asymmetricKeyType === "rsa";
  } catch {
    return false;
  }
}

const authEnv = "apps/auth-service/.env";
const emptyKey = /^JWT_PRIVATE_KEY=[ \t]*(\r?)$/m;
const content = readFileSync(authEnv, "utf8");
const currentKey = privateKeyValue(content);
if (emptyKey.test(content)) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, "\\n");
  writeFileSync(authEnv, content.replace(emptyKey, (_, cr) => `JWT_PRIVATE_KEY="${pem}"${cr}`));
  console.log(`clé JWT générée dans ${authEnv}`);
} else if (currentKey !== undefined && !isReadablePrivateKey(currentKey)) {
  console.log(
    `JWT_PRIVATE_KEY de ${authEnv} illisible (clé RSA au format PEM attendue) : auth-service ne démarrera pas. ` +
      "Effacer sa valeur (et ses éventuelles lignes suivantes) pour garder seulement « JWT_PRIVATE_KEY= », puis relancer pnpm env:init.",
  );
}
