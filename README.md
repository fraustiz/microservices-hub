# MicroServices-Hub

Plateforme d'entreprise en microservices : authentification, règles métier et agent d'IA générative, derrière une API Gateway Traefik.

```
navigateur → Traefik (gateway, seul port exposé)
               ├─ /auth/**  → auth-service      → auth_db
               ├─ /api/**   → business-service  → business_db
               ├─ /agent/** → ai-agent-service  → agent_db, API Mistral
               └─ /         → web (Next.js)
```

**Documentation complète : [docs/README.md](docs/README.md)** (architecture, interconnexion, sécurité, gateway, développement, décisions).

## Démarrage

Prérequis : Node 22, pnpm (`corepack enable`), Docker.

```bash
pnpm install
pnpm hooks                                    # active le hook Git de .githooks
for s in auth-service business-service ai-agent-service; do cp apps/$s/.env.example apps/$s/.env; done
docker compose up --build                     # puis http://localhost
```

Sous Windows (PowerShell), la copie des `.env` s'écrit :

```powershell
foreach ($s in "auth-service", "business-service", "ai-agent-service") { Copy-Item "apps/$s/.env.example" "apps/$s/.env" }
```

`docker compose ps` doit montrer les 8 conteneurs démarrés, et http://localhost afficher la page d'accueil.

## Structure

| Dossier | Contenu |
| --- | --- |
| `apps/web` | Front Next.js |
| `apps/auth-service` | Next.js API seul (auth, JWT) |
| `apps/business-service` | Next.js API seul (données, règles métier) |
| `apps/ai-agent-service` | Next.js API seul (prompts, LLM) |
| `packages/shared` | Code partagé (jamais de données) |
| `infra/traefik` | Configuration de la gateway |
| `docs` | Documentation |
