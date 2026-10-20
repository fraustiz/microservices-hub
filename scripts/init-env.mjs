// Prépare l'environnement local, sous Linux, macOS ou Windows : `pnpm env:init`.
// 1. Crée apps/<service>/.env depuis .env.example (n'écrase jamais un .env existant).
// 2. Génère la clé privée RSA qui signe les JWT si JWT_PRIVATE_KEY est vide (auth-service uniquement).
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

for (const service of ["auth-service", "business-service", "ai-agent-service"]) {
  const env = `apps/${service}/.env`;
  if (existsSync(env)) continue;
  copyFileSync(`apps/${service}/.env.example`, env);
  console.log(`créé : ${env}`);
}

const authEnv = "apps/auth-service/.env";
const emptyKey = /^JWT_PRIVATE_KEY=[ \t]*\r?$/m;
const content = readFileSync(authEnv, "utf8");
if (emptyKey.test(content)) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, "\\n");
  writeFileSync(authEnv, content.replace(emptyKey, () => `JWT_PRIVATE_KEY="${pem}"`));
  console.log(`clé JWT générée dans ${authEnv}`);
}
