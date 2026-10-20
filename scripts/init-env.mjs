// Prépare l'environnement local, sous Linux, macOS ou Windows : `pnpm env:init`. Peut être relancé sans risque.
// 1. Crée apps/<service>/.env depuis .env.example, ou complète un .env existant avec les variables ajoutées
//    depuis à .env.example (avec leurs commentaires). Une valeur déjà présente n'est jamais modifiée.
// 2. Génère la clé privée RSA qui signe les JWT si JWT_PRIVATE_KEY est vide (auth-service uniquement).
// 3. Signale les variables du .env que .env.example ne connaît plus : à supprimer à la main.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const VARIABLE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const variables = (text) => new Set(text.split(/\r?\n/).flatMap((line) => line.match(VARIABLE)?.[1] ?? []));

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
  const obsolete = [...present].filter((name) => !known.has(name));
  if (obsolete.length) console.log(`plus utilisées, à supprimer à la main de ${env} : ${obsolete.join(", ")}`);
}

const authEnv = "apps/auth-service/.env";
const emptyKey = /^JWT_PRIVATE_KEY=[ \t]*(\r?)$/m;
const content = readFileSync(authEnv, "utf8");
if (emptyKey.test(content)) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, "\\n");
  writeFileSync(authEnv, content.replace(emptyKey, (_, cr) => `JWT_PRIVATE_KEY="${pem}"${cr}`));
  console.log(`clé JWT générée dans ${authEnv}`);
}
