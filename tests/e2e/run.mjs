// Tests de bout en bout, à travers la gateway, sur la pile Docker lancée avec docker-compose.e2e.yml.
// Vérifie les contrats de docs/interconnexion.md, le contrôle d'accès, CORS, le rate limiting et
// l'intégration du LLM (faux serveur NVIDIA NIM : on contrôle ce qui serait parti chez le fournisseur).
// Usage : pnpm test:e2e   (variables : GATEWAY_URL, FAKE_NIM_URL, SEED_PASSWORD)

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost";
const FAKE_NIM = process.env.FAKE_NIM_URL ?? "http://127.0.0.1:18080";
const PASSWORD = process.env.SEED_PASSWORD ?? "hub-demo-2026";
const NOT_FOUND_ANSWER = "Je ne trouve pas cette information dans les documents auxquels vous avez accès.";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ÉCHEC  ${name}\n        ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${what} : attendu ${e}, reçu ${a}`);
}

/** Client HTTP avec un « bocal à cookies » qui respecte l'attribut Path, comme un navigateur. */
class Client {
  cookies = new Map();

  async request(path, { method = "GET", body, headers = {} } = {}) {
    const cookie = [...this.cookies.values()]
      .filter((c) => path.startsWith(c.path))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const res = await fetch(GATEWAY + path, {
      method,
      headers: { ...(cookie && { cookie }), ...(body && { "content-type": "application/json" }), ...headers },
      body: body && JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";").map((part) => part.trim());
      const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      const attr = (key) => attributes.find((a) => a.toLowerCase().startsWith(`${key}=`))?.split("=")[1];
      if (attr("max-age") === "0") this.cookies.delete(name);
      else this.cookies.set(name, { name, value, path: attr("path") ?? "/" });
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, json, text, setCookies: res.headers.getSetCookie() };
  }
}

/** Connexion. Le login est limité à 5 requêtes/min par IP : si la gateway répond 429, on attend un jeton (12 s). */
async function login(email, password = PASSWORD) {
  const client = new Client();
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await client.request("/auth/login", { method: "POST", body: { email, password } });
    if (res.status !== 429) return { client, res };
    await sleep(13_000);
  }
  throw new Error(`connexion de ${email} toujours limitée`);
}

async function llmRequests() {
  return (await fetch(`${FAKE_NIM}/__requests`)).json();
}

async function waitFor(what, probe, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await sleep(2_000);
  }
  throw new Error(`${what} : pas prêt après ${timeoutMs / 1000} s`);
}

const anonymous = new Client();
console.log(`Gateway : ${GATEWAY}`);
await waitFor("auth-service", async () => (await anonymous.request("/auth/me")).json?.error?.code === "UNAUTHORIZED");

console.log("\nGateway et routes internes");
await check("le front répond sur /", async () => {
  const res = await anonymous.request("/");
  equal(res.status, 200, "statut");
  assert(res.text.includes("MicroServices-Hub"), "page d'accueil attendue");
  equal(res.headers.get("x-frame-options"), "DENY", "X-Frame-Options");
});
await check("sans jeton, /api et /agent sont refusés par la gateway (401, format commun)", async () => {
  for (const path of ["/api/documents", "/agent/history", "/auth/me"]) {
    const res = await anonymous.request(path);
    equal(res.status, 401, `${path} statut`);
    equal(Object.keys(res.json.error).sort(), ["code", "message", "requestId"], `${path} format`);
  }
});
await check("/auth/verify et /.well-known/jwks.json ne sont pas exposés", async () => {
  equal((await anonymous.request("/auth/verify")).status, 404, "/auth/verify");
  equal((await anonymous.request("/.well-known/jwks.json")).status, 404, "/.well-known/jwks.json");
});
await check("un jeton forgé (alg: none) est refusé", async () => {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const forged = `${b64({ alg: "none" })}.${b64({ sub: "x", role: "admin", dept: "direction", iss: "microservices-hub-auth", aud: "microservices-hub", iat: now, exp: now + 900, jti: "x" })}.`;
  const res = await anonymous.request("/api/rules", { headers: { authorization: `Bearer ${forged}` } });
  equal(res.status, 401, "statut");
});

console.log("\nauth-service");
await check("mauvais mot de passe et email inconnu : même réponse 401", async () => {
  const wrong = await login("chloe@hub.local", "mauvais");
  const unknown = await login("personne@hub.local", "mauvais");
  equal([wrong.res.status, unknown.res.status], [401, 401], "statuts");
  equal(wrong.res.json.error.message, unknown.res.json.error.message, "messages");
});

const chloe = await login("chloe@hub.local");
const bruno = await login("bruno@hub.local");
const alice = await login("alice@hub.local");
const david = await login("david@hub.local");

await check("connexion : cookies HttpOnly, SameSite=Strict ; refresh token limité à /auth", async () => {
  equal(chloe.res.status, 200, "statut");
  equal(chloe.res.json.user, { ...chloe.res.json.user, email: "chloe@hub.local", role: "employee", dept: "rh" }, "user");
  const [access, refresh] = ["access_token", "refresh_token"].map((n) => chloe.res.setCookies.find((c) => c.startsWith(`${n}=`)));
  assert(/HttpOnly/.test(access) && /SameSite=Strict/.test(access) && /Path=\/;/.test(access) && /Max-Age=900/.test(access), access);
  assert(/HttpOnly/.test(refresh) && /SameSite=Strict/.test(refresh) && /Path=\/auth;/.test(refresh), refresh);
  assert(!("passwordHash" in chloe.res.json.user), "aucune empreinte de mot de passe");
});
await check("/auth/me renvoie l'utilisateur connecté", async () => {
  equal((await chloe.client.request("/auth/me")).json.user.email, "chloe@hub.local", "email");
});

console.log("\nbusiness-service : filtrage par rôle et département");
const docs = async (user) => (await user.client.request("/api/documents?limit=20")).json.documents;
await check("alice (admin) 10, bruno (manager rh) 7, chloe (employee rh) 5, david (employee tech) 5", async () => {
  equal(
    [(await docs(alice)).length, (await docs(bruno)).length, (await docs(chloe)).length, (await docs(david)).length],
    [10, 7, 5, 5],
    "nombre de documents",
  );
});
await check("des en-têtes X-User-* forgés par le client n'élèvent pas les droits", async () => {
  const res = await chloe.client.request("/api/documents?limit=20", { headers: { "x-user-role": "admin", "x-user-dept": "direction" } });
  equal(res.json.documents.length, 5, "documents de chloe");
});
await check("recherche plein texte (q) et paramètres validés", async () => {
  const res = await chloe.client.request("/api/documents?q=conges&limit=1");
  equal(res.json.documents[0]?.title, "Politique de congés payés", "premier résultat");
  const bad = await chloe.client.request("/api/documents?limit=500");
  equal([bad.status, bad.json.error.code], [400, "BAD_REQUEST"], "limit invalide");
});
const secret = (await docs(alice)).find((d) => d.title === "Grille salariale 2026");
await check("un document non autorisé répond 404 (son existence n'est pas révélée)", async () => {
  equal((await chloe.client.request(`/api/documents/${secret.id}`)).status, 404, "chloe");
  equal((await bruno.client.request(`/api/documents/${secret.id}`)).status, 200, "bruno");
});
await check("/api/rules : 403 pour un employé, CRUD pour un admin", async () => {
  equal((await chloe.client.request("/api/rules")).status, 403, "chloe");
  equal((await alice.client.request("/api/rules")).json.rules.length, 1, "règles initiales");
  const created = await alice.client.request("/api/rules", { method: "POST", body: { dept: "tech", minRole: "manager", description: "test e2e" } });
  equal(created.status, 201, "création");
  const dup = await alice.client.request("/api/rules", { method: "POST", body: { dept: "tech", minRole: "manager" } });
  equal(dup.status, 409, "doublon");
  const updated = await alice.client.request(`/api/rules/${created.json.rule.id}`, { method: "PUT", body: { dept: "tech", minRole: "admin" } });
  equal(updated.json.rule.minRole, "admin", "mise à jour");
  equal((await alice.client.request(`/api/rules/${created.json.rule.id}`, { method: "DELETE" })).status, 204, "suppression");
});

console.log("\nai-agent-service : intégration du LLM (faux NVIDIA NIM)");
await waitFor("ai-agent-service", async () => (await bruno.client.request("/agent/history")).status === 200);
const before = (await llmRequests()).length;
await check("POST /agent/ask : réponse, sources vérifiées, X-Request-Id propagé", async () => {
  const res = await chloe.client.request("/agent/ask", {
    method: "POST",
    body: { question: "Combien de jours de congés ai-je par an ?" },
    headers: { "x-request-id": "e2e-ask-1" },
  });
  equal(res.status, 200, "statut");
  equal(res.headers.get("x-request-id"), "e2e-ask-1", "X-Request-Id");
  equal(res.json.sources[0]?.title, "Politique de congés payés", "source");
  assert(res.json.answer.includes("[D1]"), "citation attendue dans la réponse");
  assert(!res.json.answer.includes("```"), "objet JSON extrait du bloc de code");
});
await check("la chaîne envoyée à NIM : search, ask, verify ; documents délimités ; aucun jeton", async () => {
  const sent = (await llmRequests()).slice(before);
  const system = (r) => r.body.messages[0].content;
  equal(sent.length, 3, "trois appels au LLM");
  assert(system(sent[0]).startsWith("Tu prépares une recherche"), "étape 1 : agent.search");
  assert(system(sent[1]).startsWith("Tu es l'assistant documentaire"), "étape 2 : agent.ask");
  assert(system(sent[2]).startsWith("Tu vérifies"), "étape 3 : agent.verify");
  assert(!sent[0].body.messages[1].content.includes("<document"), "aucun document à l'étape de recherche");
  const { authorization, body } = sent[1];
  equal(authorization, "Bearer nvapi-cle-factice-e2e", "clé API NIM");
  equal(
    [body.model, body.temperature, body.max_tokens, body.stream, body.chat_template_kwargs],
    ["nvidia/nemotron-3.5-super-vl-120b-a12b", 0.1, 600, false, { enable_thinking: false }],
    "paramètres de agent.ask",
  );
  equal(body.messages.map((m) => m.role), ["system", "user"], "rôles");
  assert(/^<documents>\n<document ref="D1"/.test(body.messages[1].content), "documents délimités (ask)");
  assert(/<phrases>\n<phrase id="S1">/.test(sent[2].body.messages[1].content), "phrases délimitées (verify)");
  assert(sent.every((r) => r.body.chat_template_kwargs?.enable_thinking === false), "raisonnement désactivé partout");
  const payload = JSON.stringify(sent);
  assert(!payload.includes(chloe.client.cookies.get("access_token").value), "le JWT ne part jamais chez le fournisseur");
  assert(!payload.includes("chloe@hub.local"), "aucun identifiant d'utilisateur");
});
await check("le LLM ne reçoit que les documents autorisés pour l'utilisateur", async () => {
  const start = (await llmRequests()).length;
  await chloe.client.request("/agent/ask", { method: "POST", body: { question: "Quelle est la grille salariale des managers ?" } });
  const payload = JSON.stringify((await llmRequests()).slice(start));
  assert(!payload.includes("Grille salariale 2026") && !payload.includes("52 000"), "document confidentiel envoyé au LLM");
});
await check("aucun document pertinent : réponse fixe, sans rédaction ni vérification", async () => {
  const start = (await llmRequests()).length;
  const res = await chloe.client.request("/agent/ask", { method: "POST", body: { question: "xylophone zeppelin" } });
  equal([res.json.answer, res.json.sources, res.json.removed], [NOT_FOUND_ANSWER, [], 0], "réponse");
  const sent = (await llmRequests()).slice(start);
  equal(sent.length, 1, "un seul appel au LLM");
  assert(sent[0].body.messages[0].content.startsWith("Tu prépares une recherche"), "seulement agent.search");
});
await check("recherche : un synonyme proposé par agent.search trouve le document (vacances → congés)", async () => {
  const res = await bruno.client.request("/agent/ask", { method: "POST", body: { question: "Combien de vacances ?" } });
  equal(res.json.sources.map((s) => s.title), ["Politique de congés payés"], "sources");
});
await check("vérification : un chiffre absent des documents est retiré, même si le vérificateur l'accepte", async () => {
  const res = await bruno.client.request("/agent/ask", { method: "POST", body: { question: "Combien de jours de congés au TOTAL ?" } });
  equal(res.status, 200, "statut");
  assert(!res.json.answer.includes("999"), `chiffre inventé encore présent : ${res.json.answer}`);
  equal(res.json.removed, 1, "phrases retirées");
  assert(/\[D1\]\.$/.test(res.json.answer), `référence écrite par le code : ${res.json.answer}`);
});
await check("NIM en panne : 502 UPSTREAM_ERROR « Service d'IA indisponible »", async () => {
  const res = await chloe.client.request("/agent/ask", { method: "POST", body: { question: "congés PANNE" } });
  equal([res.status, res.json.error.code, res.json.error.message], [502, "UPSTREAM_ERROR", "Service d'IA indisponible"], "erreur");
});
await check("POST /agent/summarize : 200 sur un document autorisé, 404 sinon", async () => {
  const allowed = (await docs(chloe))[0];
  const res = await chloe.client.request("/agent/summarize", { method: "POST", body: { documentId: allowed.id } });
  equal([res.status, res.json.source.id], [200, allowed.id], "résumé");
  assert(res.json.summary.startsWith("- "), "puces attendues");
  const denied = await chloe.client.request("/agent/summarize", { method: "POST", body: { documentId: secret.id } });
  equal([denied.status, denied.json.error.code], [404, "NOT_FOUND"], "document interdit");
});
await check("validation : question vide → 400", async () => {
  const res = await chloe.client.request("/agent/ask", { method: "POST", body: { question: "  " } });
  equal([res.status, res.json.error.code], [400, "BAD_REQUEST"], "erreur");
});
await check("GET /agent/history : uniquement les échanges de l'utilisateur", async () => {
  const mine = (await chloe.client.request("/agent/history")).json.exchanges;
  assert(mine.length >= 3, `au moins 3 échanges, reçu ${mine.length}`);
  equal((await alice.client.request("/agent/history")).json.exchanges.length, 0, "historique d'alice");
});

console.log("\nCORS");
await check("origine autorisée : requête préliminaire acceptée, avec cookies", async () => {
  const res = await anonymous.request("/api/documents", {
    method: "OPTIONS",
    headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
  });
  assert(res.status < 300, `statut ${res.status}`);
  equal(res.headers.get("access-control-allow-origin"), "http://localhost:3000", "Allow-Origin");
  equal(res.headers.get("access-control-allow-credentials"), "true", "Allow-Credentials");
});
await check("origine inconnue : aucun en-tête CORS (le navigateur bloque)", async () => {
  const res = await chloe.client.request("/api/documents", { headers: { origin: "https://evil.example" } });
  equal(res.headers.get("access-control-allow-origin"), null, "Allow-Origin");
});

console.log("\nRate limiting");
await check("agent : 10 requêtes/min par utilisateur, 429 au format commun, les autres utilisateurs non affectés", async () => {
  const statuses = [];
  let limited;
  for (let i = 0; i < 12; i++) {
    const res = await david.client.request("/agent/history");
    statuses.push(res.status);
    limited ??= res.status === 429 ? res : undefined;
  }
  assert(limited, `aucun 429 : ${statuses.join(",")}`);
  equal([limited.json.error.code, limited.headers.get("retry-after")], ["RATE_LIMITED", "60"], "429");
  equal((await bruno.client.request("/agent/history")).status, 200, "bruno");
});
await check("login : 5 requêtes/min par IP, puis 429", async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await new Client().request("/auth/login", { method: "POST", body: { email: "x@hub.local", password: "x" } })).status);
  }
  assert(statuses.includes(429), `aucun 429 : ${statuses.join(",")}`);
});

console.log("\nSession : refresh token et déconnexion");
await check("refresh : nouveau couple de jetons ; un refresh token rejoué révoque la session", async () => {
  const stolen = chloe.client.cookies.get("refresh_token").value;
  const refreshed = await chloe.client.request("/auth/refresh", { method: "POST" });
  equal(refreshed.status, 200, "renouvellement");
  assert(chloe.client.cookies.get("refresh_token").value !== stolen, "refresh token renouvelé");
  const replay = new Client();
  replay.cookies.set("refresh_token", { name: "refresh_token", value: stolen, path: "/auth" });
  equal((await replay.request("/auth/refresh", { method: "POST" })).status, 401, "rejeu");
  equal((await chloe.client.request("/auth/refresh", { method: "POST" })).status, 401, "session révoquée après rejeu");
});
await check("logout : 204, cookies vidés, refresh token révoqué", async () => {
  const token = bruno.client.cookies.get("refresh_token").value;
  const res = await bruno.client.request("/auth/logout", { method: "POST" });
  equal(res.status, 204, "statut");
  assert(res.setCookies.every((c) => /Max-Age=0/.test(c)), "cookies vidés");
  const reuse = new Client();
  reuse.cookies.set("refresh_token", { name: "refresh_token", value: token, path: "/auth" });
  equal((await reuse.request("/auth/refresh", { method: "POST" })).status, 401, "refresh après logout");
});

console.log(failures ? `\n${failures} échec(s)` : "\nTous les tests de bout en bout passent.");
process.exit(failures ? 1 : 0);
