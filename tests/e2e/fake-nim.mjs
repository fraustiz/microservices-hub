// Faux serveur de l'API NVIDIA NIM (POST /v1/chat/completions, format OpenAI), sans dépendance.
// Répond comme NIM et garde les requêtes reçues (GET /__requests) pour que les tests vérifient
// ce qui serait parti chez le fournisseur : documents autorisés uniquement, aucun jeton.
import { createServer } from "node:http";

const requests = [];

function completion(content) {
  return {
    id: `fake-${requests.length}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mistralai/mistral-nemotron",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

function reply(body) {
  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const docs = [...user.matchAll(/<document (?:ref="(D\d+)" )?title="([^"]*)">/g)].map((m) => ({ ref: m[1], title: m[2] }));
  if (system.startsWith("Tu résumes")) {
    return `- Résumé factice de « ${docs[0]?.title} ».\n- Deuxième point.\n- Troisième point.`;
  }
  const first = docs[0];
  // Sans mode JSON côté API, un modèle entoure parfois l'objet d'un bloc de code : l'agent doit l'extraire.
  const json = JSON.stringify({ answer: `D'après « ${first.title} », voici la réponse [${first.ref}].`, sources: [first.ref] });
  return "```json\n" + json + "\n```";
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/__requests") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(requests));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw);
    requests.push({ authorization: req.headers.authorization, body });
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" }).end('{"message":"Unauthorized"}');
    } else if (JSON.stringify(body).includes("PANNE")) {
      // Mot magique des tests : simule une panne du fournisseur.
      res.writeHead(503, { "Content-Type": "application/json" }).end('{"message":"Service unavailable"}');
    } else {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(completion(reply(body))));
    }
  });
}).listen(8080, () => console.log("faux NIM sur :8080"));
